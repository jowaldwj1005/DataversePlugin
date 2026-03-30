/**
 * Dataverse Toolkit - Shared API Client
 *
 * Clean, fluent interface for the Dataverse Web API. Every request is proxied
 * through the background service worker (via chrome.runtime.sendMessage) so
 * callers in the side panel, popup, or devtools never hit CORS issues.
 *
 * Usage:
 *   import { DataverseClient, QueryBuilder } from './api-client.js';
 *   const client = new DataverseClient();
 *   const accounts = await client.get('accounts', { $select: 'name', $top: 10 });
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MESSAGE_TYPES = Object.freeze({
  API_REQUEST: 'API_REQUEST',
  GET_ENV: 'GET_ENV',
  GET_TOKEN: 'GET_TOKEN',
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Send a message to the background service worker and return its response.
 * @param {string} type
 * @param {any} payload
 * @returns {Promise<any>}
 */
function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Parse a Dataverse error response into a structured error object.
 * Dataverse errors follow the OData error format:
 *   { "error": { "code": "0x80040265", "message": "...", "innererror": { ... } } }
 */
function parseDataverseError(responseData, status) {
  const err = new Error();
  err.name = 'DataverseError';
  err.status = status;

  if (responseData?.error) {
    const odata = responseData.error;
    err.code = odata.code || `HTTP_${status}`;
    err.message = odata.message || `Request failed with status ${status}`;
    err.innererror = odata.innererror || null;

    // Attempt to surface the most useful inner message
    if (odata.innererror?.message && odata.innererror.message !== odata.message) {
      err.details = odata.innererror.message;
    }
  } else if (typeof responseData === 'string') {
    err.code = `HTTP_${status}`;
    err.message = responseData;
  } else {
    err.code = `HTTP_${status}`;
    err.message = `Request failed with status ${status}`;
  }

  return err;
}

/**
 * Build an OData query string from an options object.
 * Supports: $select, $filter, $expand, $orderby, $top, $count, $skip, $apply, fetchXml
 */
function buildQueryString(options = {}) {
  const params = new URLSearchParams();
  const oDataKeys = ['$select', '$filter', '$expand', '$orderby', '$top', '$count', '$skip', '$apply'];

  for (const key of oDataKeys) {
    // Allow callers to omit the $ prefix for convenience
    const value = options[key] ?? options[key.slice(1)];
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  if (options.fetchXml) {
    params.set('fetchXml', encodeURIComponent(options.fetchXml));
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Normalize an entity ID — strip braces and lower-case.
 */
function normalizeId(id) {
  return id.replace(/[{}]/g, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Request / response interceptors
// ---------------------------------------------------------------------------

/** @type {Array<(req: {method:string, url:string, headers?:object, body?:any}) => void>} */
const requestInterceptors = [];

/** @type {Array<(res: any) => void>} */
const responseInterceptors = [];

// ---------------------------------------------------------------------------
// QueryBuilder — fluent OData query construction
// ---------------------------------------------------------------------------

export class QueryBuilder {
  #entitySet;
  #parts = {};

  constructor(entitySet) {
    this.#entitySet = entitySet;
  }

  select(...columns) {
    this.#parts.$select = columns.flat().join(',');
    return this;
  }

  filter(expression) {
    this.#parts.$filter = expression;
    return this;
  }

  expand(expression) {
    this.#parts.$expand = expression;
    return this;
  }

  orderBy(expression) {
    this.#parts.$orderby = expression;
    return this;
  }

  top(n) {
    this.#parts.$top = n;
    return this;
  }

  count(include = true) {
    this.#parts.$count = include;
    return this;
  }

  skip(n) {
    this.#parts.$skip = n;
    return this;
  }

  /**
   * Execute the built query using the provided client.
   * @param {DataverseClient} client
   */
  async execute(client) {
    return client.get(this.#entitySet, this.#parts);
  }
}

// ---------------------------------------------------------------------------
// DataverseClient
// ---------------------------------------------------------------------------

export class DataverseClient {
  // -- Interceptor registration -------------------------------------------

  /**
   * Register a request interceptor. Called before every request.
   * @param {(req: object) => void} fn
   */
  onRequest(fn) {
    requestInterceptors.push(fn);
  }

  /**
   * Register a response interceptor. Called after every response.
   * @param {(res: object) => void} fn
   */
  onResponse(fn) {
    responseInterceptors.push(fn);
  }

  // -- Core request method ------------------------------------------------

  /**
   * Low-level request method. All other methods delegate here.
   * @param {string} method  HTTP method
   * @param {string} url     Relative or absolute URL
   * @param {object} [options]
   * @param {object} [options.headers]  Extra headers
   * @param {any}    [options.body]     Request body
   * @returns {Promise<any>}  Response data
   */
  /**
   * Like request() but always resolves (never throws) with the full envelope:
   * { ok, status, statusText, headers, data }.
   * Use this when the caller needs status codes and headers (e.g. Request Builder).
   */
  async requestRaw(method, url, { headers, body } = {}) {
    const reqDef = { method, url, headers, body };
    for (const fn of requestInterceptors) {
      try { fn(reqDef); } catch { /* ignore */ }
    }
    try {
      const response = await sendMessage(MESSAGE_TYPES.API_REQUEST, reqDef);
      return {
        ok: response.ok ?? response.success ?? false,
        status: response.status ?? 0,
        statusText: response.statusText ?? '',
        headers: response.headers ?? {},
        data: response.data ?? null,
        error: response.error ?? null,
      };
    } catch (err) {
      return { ok: false, status: 0, statusText: 'Network Error', headers: {}, data: null, error: err.message };
    }
  }

  async request(method, url, { headers, body } = {}) {
    const reqDef = { method, url, headers, body };

    // Run request interceptors
    for (const fn of requestInterceptors) {
      try { fn(reqDef); } catch { /* interceptors must not break requests */ }
    }

    const response = await sendMessage(MESSAGE_TYPES.API_REQUEST, reqDef);

    // Run response interceptors
    for (const fn of responseInterceptors) {
      try { fn(response); } catch { /* ignore */ }
    }

    if (!response.success) {
      // Prefer the human-readable error string from the background worker
      if (response.error) {
        const err = new Error(response.error);
        err.status = response.status ?? 0;
        err.code = `HTTP_${response.status ?? 0}`;
        throw err;
      }
      throw parseDataverseError(response.data ?? null, response.status ?? 0);
    }

    if (!response.ok) {
      throw parseDataverseError(response.data, response.status);
    }

    return response.data;
  }

  // -- CRUD operations ----------------------------------------------------

  /**
   * GET a collection of entities.
   * @param {string} entitySet  e.g. "accounts", "contacts"
   * @param {object} [options]  OData query options ($select, $filter, etc.)
   * @returns {Promise<{ value: any[], '@odata.count'?: number, '@odata.nextLink'?: string }>}
   */
  async get(entitySet, options = {}) {
    const qs = buildQueryString(options);
    return this.request('GET', `${entitySet}${qs}`);
  }

  /**
   * GET a single entity by ID.
   * @param {string} entitySet
   * @param {string} id
   * @param {object} [options]
   */
  async getById(entitySet, id, options = {}) {
    const qs = buildQueryString(options);
    return this.request('GET', `${entitySet}(${normalizeId(id)})${qs}`);
  }

  /**
   * POST — create a new entity record.
   * @param {string} entitySet
   * @param {object} data
   * @returns {Promise<any>}  Response (often empty with OData-EntityId header)
   */
  async create(entitySet, data) {
    return this.request('POST', entitySet, {
      body: data,
      headers: { Prefer: 'return=representation' },
    });
  }

  /**
   * PATCH — update an existing entity record.
   * @param {string} entitySet
   * @param {string} id
   * @param {object} data
   * @param {boolean} [upsert=false]  If true, creates the record if it doesn't exist.
   */
  async update(entitySet, id, data, upsert = false) {
    const headers = {};
    if (!upsert) {
      headers['If-Match'] = '*'; // prevent upsert
    }
    return this.request('PATCH', `${entitySet}(${normalizeId(id)})`, {
      body: data,
      headers,
    });
  }

  /**
   * DELETE an entity record.
   * @param {string} entitySet
   * @param {string} id
   */
  async delete(entitySet, id) {
    return this.request('DELETE', `${entitySet}(${normalizeId(id)})`);
  }

  // -- Relationships ------------------------------------------------------

  /**
   * Associate two records via a navigation property.
   * @param {string} entitySet       e.g. "accounts"
   * @param {string} id              Source record ID
   * @param {string} navProperty     e.g. "primarycontactid"
   * @param {string} targetEntitySet e.g. "contacts"
   * @param {string} targetId        Target record ID
   */
  async associate(entitySet, id, navProperty, targetEntitySet, targetId) {
    const env = await this.getEnvironment();
    const baseUrl = `${env.url}/api/data/${env.apiVersion}`;
    return this.request('POST', `${entitySet}(${normalizeId(id)})/${navProperty}/$ref`, {
      body: { '@odata.id': `${baseUrl}/${targetEntitySet}(${normalizeId(targetId)})` },
    });
  }

  /**
   * Disassociate two records.
   * @param {string} entitySet
   * @param {string} id
   * @param {string} navProperty
   * @param {string} [targetId]  Required for collection-valued navigation properties
   */
  async disassociate(entitySet, id, navProperty, targetId) {
    let url = `${entitySet}(${normalizeId(id)})/${navProperty}/$ref`;
    if (targetId) {
      const env = await this.getEnvironment();
      const baseUrl = `${env.url}/api/data/${env.apiVersion}`;
      url += `?$id=${baseUrl}/${navProperty}(${normalizeId(targetId)})`;
    }
    return this.request('DELETE', url);
  }

  // -- Batch requests -----------------------------------------------------

  /**
   * Execute a $batch request.
   *
   * @param {Array<Array<{ method: string, url: string, headers?: object, body?: any }>>} changeSets
   *   Array of change sets. Each change set is an array of operations that
   *   will be executed atomically.
   * @returns {Promise<any>}
   */
  async executeBatch(changeSets) {
    const batchBoundary = `batch_${crypto.randomUUID()}`;
    const parts = [];

    for (const changeSet of changeSets) {
      const csBoundary = `changeset_${crypto.randomUUID()}`;
      let csPart = `--${batchBoundary}\r\nContent-Type: multipart/mixed; boundary=${csBoundary}\r\n\r\n`;

      for (let i = 0; i < changeSet.length; i++) {
        const op = changeSet[i];
        csPart += `--${csBoundary}\r\n`;
        csPart += 'Content-Type: application/http\r\n';
        csPart += `Content-Transfer-Encoding: binary\r\n`;
        csPart += `Content-ID: ${i + 1}\r\n\r\n`;
        csPart += `${op.method} ${op.url} HTTP/1.1\r\n`;

        const opHeaders = {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
          ...op.headers,
        };
        for (const [k, v] of Object.entries(opHeaders)) {
          csPart += `${k}: ${v}\r\n`;
        }
        csPart += '\r\n';
        if (op.body) {
          csPart += typeof op.body === 'string' ? op.body : JSON.stringify(op.body);
        }
        csPart += '\r\n';
      }

      csPart += `--${csBoundary}--\r\n`;
      parts.push(csPart);
    }

    const batchBody = parts.join('') + `--${batchBoundary}--\r\n`;

    return this.request('POST', '$batch', {
      headers: {
        'Content-Type': `multipart/mixed; boundary=${batchBoundary}`,
        Accept: 'application/json',
      },
      body: batchBody,
    });
  }

  // -- Actions & Functions ------------------------------------------------

  /**
   * Execute an unbound or bound action.
   * @param {string} name        Fully qualified action name (e.g. "Microsoft.Dynamics.CRM.WinOpportunity")
   * @param {object} [params]    Action parameters
   * @param {{ entitySet: string, id: string }} [bound]  If bound, the target entity
   */
  async executeAction(name, params = {}, bound) {
    const url = bound
      ? `${bound.entitySet}(${normalizeId(bound.id)})/${name}`
      : name;
    return this.request('POST', url, { body: params });
  }

  /**
   * Execute an unbound or bound function.
   * @param {string} name        Fully qualified function name
   * @param {object} [params]    Function parameters (appended to URL)
   * @param {{ entitySet: string, id: string }} [bound]  If bound, the target entity
   */
  async executeFunction(name, params = {}, bound) {
    const paramParts = Object.entries(params).map(([k, v]) => {
      const val = typeof v === 'string' ? `'${v}'` : String(v);
      return `${k}=${val}`;
    });
    const paramString = paramParts.length > 0 ? `(${paramParts.join(',')})` : '()';

    const url = bound
      ? `${bound.entitySet}(${normalizeId(bound.id)})/${name}${paramString}`
      : `${name}${paramString}`;
    return this.request('GET', url);
  }

  // -- FetchXML -----------------------------------------------------------

  /**
   * Execute a FetchXML query.
   * @param {string} entitySet  The entity set matching the FetchXML <entity> element
   * @param {string} fetchXml   The FetchXML string
   */
  async fetchXml(entitySet, fetchXml) {
    return this.request('GET', `${entitySet}?fetchXml=${encodeURIComponent(fetchXml)}`);
  }

  // -- Metadata -----------------------------------------------------------

  /**
   * Retrieve entity definitions (all or for a specific logical name).
   * @param {string} [entityLogicalName]
   */
  async getMetadata(entityLogicalName) {
    if (entityLogicalName) {
      return this.request('GET', `EntityDefinitions(LogicalName='${entityLogicalName}')`);
    }
    return this.request('GET', 'EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,LogicalCollectionName');
  }

  /**
   * Retrieve attribute metadata for an entity.
   * @param {string} entityLogicalName
   */
  async getAttributeMetadata(entityLogicalName) {
    return this.request('GET', `EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes`);
  }

  /**
   * Retrieve relationship metadata for an entity.
   * @param {string} entityLogicalName
   */
  async getRelationshipMetadata(entityLogicalName) {
    const [oneToMany, manyToOne, manyToMany] = await Promise.all([
      this.request('GET', `EntityDefinitions(LogicalName='${entityLogicalName}')/OneToManyRelationships`),
      this.request('GET', `EntityDefinitions(LogicalName='${entityLogicalName}')/ManyToOneRelationships`),
      this.request('GET', `EntityDefinitions(LogicalName='${entityLogicalName}')/ManyToManyRelationships`),
    ]);
    return {
      oneToMany: oneToMany?.value ?? [],
      manyToOne: manyToOne?.value ?? [],
      manyToMany: manyToMany?.value ?? [],
    };
  }

  /**
   * Retrieve all global option sets.
   */
  async getGlobalOptionSets() {
    return this.request('GET', 'GlobalOptionSetDefinitions');
  }

  /**
   * WhoAmI — quick connectivity & identity check.
   */
  async whoAmI() {
    return this.request('GET', 'WhoAmI()');
  }

  // -- Environment helper -------------------------------------------------

  /**
   * Get the currently active environment info from the background worker.
   * @returns {Promise<{ url: string, orgId: string, orgName: string, apiVersion: string }>}
   */
  async getEnvironment() {
    const response = await sendMessage(MESSAGE_TYPES.GET_ENV);
    if (!response.success) throw new Error(response.error);
    return response.env;
  }

  // -- Fluent query builder shorthand ------------------------------------

  /**
   * Start building a query with the fluent QueryBuilder.
   * @param {string} entitySet
   * @returns {QueryBuilder}
   */
  query(entitySet) {
    return new QueryBuilder(entitySet);
  }
}

// Default singleton instance
export const dataverse = new DataverseClient();
export default dataverse;

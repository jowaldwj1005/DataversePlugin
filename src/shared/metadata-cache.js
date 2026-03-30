/**
 * Dataverse Toolkit - Metadata Cache
 *
 * Caches entity definitions, attribute metadata, relationship metadata, and
 * global option sets in chrome.storage.local, namespaced per Dataverse
 * environment. Supports TTL-based expiration, lazy loading, and bulk prefetch.
 *
 * Usage:
 *   import { MetadataCache } from './metadata-cache.js';
 *   const cache = new MetadataCache();
 *   const entityDef = await cache.getEntityDef('account');
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MESSAGE_TYPES = Object.freeze({
  GET_METADATA_CACHE: 'GET_METADATA_CACHE',
  SET_METADATA_CACHE: 'SET_METADATA_CACHE',
  CLEAR_CACHE: 'CLEAR_CACHE',
  API_REQUEST: 'API_REQUEST',
  GET_ENV: 'GET_ENV',
});

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

const CACHE_KEYS = Object.freeze({
  ENTITY_LIST: 'entityList',
  ENTITY_DEF: (name) => `entityDef_${name}`,
  ATTRIBUTES: (name) => `attributes_${name}`,
  RELATIONSHIPS: (name) => `relationships_${name}`,
  GLOBAL_OPTION_SETS: 'globalOptionSets',
  OPTION_SET: (name) => `optionSet_${name}`,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Simple event emitter mixin
// ---------------------------------------------------------------------------

class EventEmitter {
  #listeners = new Map();

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} fn
   * @returns {() => void} Unsubscribe function
   */
  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
    return () => this.#listeners.get(event)?.delete(fn);
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param  {...any} args
   */
  emit(event, ...args) {
    const fns = this.#listeners.get(event);
    if (fns) {
      for (const fn of fns) {
        try { fn(...args); } catch { /* listeners must not break the emitter */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// In-flight request deduplication
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<any>>} */
const inFlight = new Map();

/**
 * Deduplicate concurrent requests for the same key. If a fetch for the given
 * key is already in progress, the existing promise is returned instead of
 * kicking off a second request.
 */
function dedup(key, fetchFn) {
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = fetchFn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// MetadataCache
// ---------------------------------------------------------------------------

export class MetadataCache extends EventEmitter {
  #ttl;

  /**
   * @param {{ ttl?: number }} [options]
   */
  constructor({ ttl = DEFAULT_TTL_MS } = {}) {
    super();
    this.#ttl = ttl;
  }

  // -- Low-level cache operations -----------------------------------------

  /**
   * Retrieve a value from the cache (via background worker).
   * Returns null if the entry is missing or expired.
   * @param {string} key
   * @returns {Promise<any | null>}
   */
  async get(key) {
    const response = await sendMessage(MESSAGE_TYPES.GET_METADATA_CACHE, { key });
    return response.success ? response.value : null;
  }

  /**
   * Store a value in the cache (via background worker).
   * @param {string} key
   * @param {any} value
   * @param {number} [ttl]  Override default TTL for this entry
   */
  async set(key, value, ttl) {
    await sendMessage(MESSAGE_TYPES.SET_METADATA_CACHE, { key, value, ttl: ttl ?? this.#ttl });
    this.emit('update', { key, value });
  }

  /**
   * Remove a single cache entry.
   * @param {string} key
   */
  async invalidate(key) {
    await this.set(key, null, 0);
    this.emit('invalidate', { key });
  }

  /**
   * Remove all cached metadata for the current environment.
   */
  async invalidateAll() {
    await sendMessage(MESSAGE_TYPES.CLEAR_CACHE);
    this.emit('invalidateAll');
  }

  // -- High-level metadata accessors (lazy-loading) -----------------------

  /**
   * Get the full entity definition for a given logical name.
   * Fetches from the API on first access, then returns cached.
   * @param {string} logicalName  e.g. "account"
   */
  async getEntityDef(logicalName) {
    const key = CACHE_KEYS.ENTITY_DEF(logicalName);
    return dedup(key, async () => {
      const cached = await this.get(key);
      if (cached) return cached;

      const data = await this.#apiGet(`EntityDefinitions(LogicalName='${logicalName}')`);
      await this.set(key, data);
      return data;
    });
  }

  /**
   * Get attribute metadata for an entity.
   * @param {string} logicalName
   */
  async getAttributes(logicalName) {
    const key = CACHE_KEYS.ATTRIBUTES(logicalName);
    return dedup(key, async () => {
      const cached = await this.get(key);
      if (cached) return cached;

      const data = await this.#apiGet(`EntityDefinitions(LogicalName='${logicalName}')/Attributes`);
      const result = data?.value ?? data;
      await this.set(key, result);
      return result;
    });
  }

  /**
   * Get relationship metadata for an entity (one-to-many, many-to-one,
   * and many-to-many combined).
   * @param {string} logicalName
   */
  async getRelationships(logicalName) {
    const key = CACHE_KEYS.RELATIONSHIPS(logicalName);
    return dedup(key, async () => {
      const cached = await this.get(key);
      if (cached) return cached;

      const [otm, mto, mtm] = await Promise.all([
        this.#apiGet(`EntityDefinitions(LogicalName='${logicalName}')/OneToManyRelationships`),
        this.#apiGet(`EntityDefinitions(LogicalName='${logicalName}')/ManyToOneRelationships`),
        this.#apiGet(`EntityDefinitions(LogicalName='${logicalName}')/ManyToManyRelationships`),
      ]);

      const result = {
        oneToMany: otm?.value ?? [],
        manyToOne: mto?.value ?? [],
        manyToMany: mtm?.value ?? [],
      };

      await this.set(key, result);
      return result;
    });
  }

  /**
   * Get a global option set definition by name.
   * @param {string} name
   */
  async getOptionSet(name) {
    const key = CACHE_KEYS.OPTION_SET(name);
    return dedup(key, async () => {
      const cached = await this.get(key);
      if (cached) return cached;

      const data = await this.#apiGet(`GlobalOptionSetDefinitions(Name='${name}')`);
      await this.set(key, data);
      return data;
    });
  }

  /**
   * Get the full list of entity definitions (lightweight — only key columns).
   */
  async getEntityList() {
    const key = CACHE_KEYS.ENTITY_LIST;
    return dedup(key, async () => {
      const cached = await this.get(key);
      if (cached) return cached;

      const data = await this.#apiGet(
        'EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,LogicalCollectionName',
      );
      const result = data?.value ?? data;
      await this.set(key, result);
      return result;
    });
  }

  /**
   * Get all global option sets.
   */
  async getGlobalOptionSets() {
    const key = CACHE_KEYS.GLOBAL_OPTION_SETS;
    return dedup(key, async () => {
      const cached = await this.get(key);
      if (cached) return cached;

      const data = await this.#apiGet('GlobalOptionSetDefinitions');
      const result = data?.value ?? data;
      await this.set(key, result);
      return result;
    });
  }

  // -- Bulk prefetch ------------------------------------------------------

  /**
   * Prefetch metadata for a list of entity logical names so subsequent
   * calls return instantly from cache.
   *
   * @param {string[]} entityLogicalNames
   * @param {{ includeAttributes?: boolean, includeRelationships?: boolean }} [options]
   */
  async prefetch(entityLogicalNames, { includeAttributes = true, includeRelationships = false } = {}) {
    const promises = [];

    // Always fetch entity list
    promises.push(this.getEntityList());

    for (const name of entityLogicalNames) {
      promises.push(this.getEntityDef(name));
      if (includeAttributes) promises.push(this.getAttributes(name));
      if (includeRelationships) promises.push(this.getRelationships(name));
    }

    await Promise.allSettled(promises);
    this.emit('prefetchComplete', { entities: entityLogicalNames });
  }

  // -- Private helpers ----------------------------------------------------

  /**
   * Execute a GET request against the Dataverse Web API via the background
   * service worker.
   * @param {string} url  Relative API URL
   * @returns {Promise<any>}
   */
  async #apiGet(url) {
    const response = await sendMessage(MESSAGE_TYPES.API_REQUEST, {
      method: 'GET',
      url,
    });

    if (!response.success || !response.ok) {
      const msg = response.error || response.data?.error?.message || `Metadata request failed: ${url}`;
      throw new Error(msg);
    }

    return response.data;
  }
}

// Default singleton
export const metadataCache = new MetadataCache();
export default metadataCache;

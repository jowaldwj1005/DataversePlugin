/**
 * Dataverse Toolkit - FetchXML Builder Module
 *
 * Visual FetchXML query builder with side-by-side raw XML editing,
 * bidirectional sync, execution, and code generation.
 *
 * @module FetchXmlBuilder
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_OPERATORS = Object.freeze([
  { value: 'eq', label: 'Equals', requiresValue: true },
  { value: 'ne', label: 'Not Equals', requiresValue: true },
  { value: 'gt', label: 'Greater Than', requiresValue: true },
  { value: 'lt', label: 'Less Than', requiresValue: true },
  { value: 'ge', label: 'Greater or Equal', requiresValue: true },
  { value: 'le', label: 'Less or Equal', requiresValue: true },
  { value: 'like', label: 'Like', requiresValue: true },
  { value: 'not-like', label: 'Not Like', requiresValue: true },
  { value: 'in', label: 'In', requiresValue: true },
  { value: 'not-in', label: 'Not In', requiresValue: true },
  { value: 'between', label: 'Between', requiresValue: true },
  { value: 'not-between', label: 'Not Between', requiresValue: true },
  { value: 'null', label: 'Is Null', requiresValue: false },
  { value: 'not-null', label: 'Is Not Null', requiresValue: false },
  { value: 'eq-userid', label: 'Equals Current User', requiresValue: false },
  { value: 'ne-userid', label: 'Not Equals Current User', requiresValue: false },
  { value: 'eq-businessid', label: 'Equals Current Business Unit', requiresValue: false },
  { value: 'today', label: 'Today', requiresValue: false },
  { value: 'yesterday', label: 'Yesterday', requiresValue: false },
  { value: 'tomorrow', label: 'Tomorrow', requiresValue: false },
  { value: 'last-x-days', label: 'Last X Days', requiresValue: true },
  { value: 'next-x-days', label: 'Next X Days', requiresValue: true },
  { value: 'last-x-hours', label: 'Last X Hours', requiresValue: true },
  { value: 'next-x-hours', label: 'Next X Hours', requiresValue: true },
  { value: 'contains', label: 'Contains', requiresValue: true },
  { value: 'not-contain', label: 'Does Not Contain', requiresValue: true },
  { value: 'begins-with', label: 'Begins With', requiresValue: true },
  { value: 'not-begin-with', label: 'Does Not Begin With', requiresValue: true },
  { value: 'ends-with', label: 'Ends With', requiresValue: true },
  { value: 'not-end-with', label: 'Does Not End With', requiresValue: true },
]);

const AGGREGATE_FUNCTIONS = Object.freeze([
  'count', 'sum', 'avg', 'min', 'max', 'countcolumn',
]);

const LINK_TYPES = Object.freeze(['inner', 'outer']);

const MAX_QUERY_HISTORY = 20;

const TEMPLATE_QUERIES = Object.freeze([
  {
    name: 'All Active Records',
    description: 'Retrieves all active records for the selected entity',
    buildFetch: (entityName) => ({
      entity: entityName,
      attributes: [],
      allAttributes: true,
      filters: {
        type: 'and',
        conditions: [{ attribute: 'statecode', operator: 'eq', value: '0' }],
        filters: [],
      },
      orders: [],
      linkEntities: [],
      top: 50,
      distinct: false,
      noLock: false,
      aggregate: false,
      page: null,
      pagingCookie: null,
    }),
  },
  {
    name: 'My Records',
    description: 'Records owned by the current user',
    buildFetch: (entityName) => ({
      entity: entityName,
      attributes: [],
      allAttributes: true,
      filters: {
        type: 'and',
        conditions: [{ attribute: 'ownerid', operator: 'eq-userid', value: '' }],
        filters: [],
      },
      orders: [{ attribute: 'createdon', descending: true }],
      linkEntities: [],
      top: 50,
      distinct: false,
      noLock: false,
      aggregate: false,
      page: null,
      pagingCookie: null,
    }),
  },
  {
    name: 'Created Today',
    description: 'Records created today',
    buildFetch: (entityName) => ({
      entity: entityName,
      attributes: [],
      allAttributes: true,
      filters: {
        type: 'and',
        conditions: [{ attribute: 'createdon', operator: 'today', value: '' }],
        filters: [],
      },
      orders: [{ attribute: 'createdon', descending: true }],
      linkEntities: [],
      top: 100,
      distinct: false,
      noLock: false,
      aggregate: false,
      page: null,
      pagingCookie: null,
    }),
  },
  {
    name: 'Modified Last 7 Days',
    description: 'Records modified in the last 7 days',
    buildFetch: (entityName) => ({
      entity: entityName,
      attributes: [],
      allAttributes: true,
      filters: {
        type: 'and',
        conditions: [{ attribute: 'modifiedon', operator: 'last-x-days', value: '7' }],
        filters: [],
      },
      orders: [{ attribute: 'modifiedon', descending: true }],
      linkEntities: [],
      top: 100,
      distinct: false,
      noLock: false,
      aggregate: false,
      page: null,
      pagingCookie: null,
    }),
  },
  {
    name: 'Record Count',
    description: 'Count of all records for the entity',
    buildFetch: (entityName) => ({
      entity: entityName,
      attributes: [{ name: `${entityName}id`, alias: 'record_count', aggregate: 'count' }],
      allAttributes: false,
      filters: { type: 'and', conditions: [], filters: [] },
      orders: [],
      linkEntities: [],
      top: null,
      distinct: false,
      noLock: false,
      aggregate: true,
      page: null,
      pagingCookie: null,
    }),
  },
]);

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function xmlEscape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function uid() {
  return Math.random().toString(36).substring(2, 10);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function prettifyXml(xml, indent = '  ') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return xml;

  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(doc);

  let formatted = '';
  let depth = 0;
  const lines = raw.replace(/></g, '>\n<').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('</')) {
      depth = Math.max(depth - 1, 0);
    }
    formatted += indent.repeat(depth) + trimmed + '\n';
    if (trimmed.endsWith('/>') || trimmed.startsWith('<?')) {
      // no depth change
    } else if (trimmed.startsWith('</')) {
      // already decremented
    } else if (trimmed.startsWith('<') && !trimmed.startsWith('<!')) {
      depth++;
    }
  }

  return formatted.trim();
}

function highlightXml(xml) {
  return xml
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="xml-tag">$2</span>')
    .replace(/([\w-]+)(\s*=\s*)/g, '<span class="xml-attr">$1</span>$2')
    .replace(/"([^"]*)"/g, '"<span class="xml-value">$1</span>"')
    .replace(/'([^']*)'/g, "'<span class=\"xml-value\">$1</span>'");
}

// ---------------------------------------------------------------------------
// FetchXML Model
// ---------------------------------------------------------------------------

function createEmptyModel() {
  return {
    entity: '',
    attributes: [],
    allAttributes: false,
    filters: {
      type: 'and',
      conditions: [],
      filters: [],
    },
    orders: [],
    linkEntities: [],
    top: null,
    page: null,
    pageSize: null,
    pagingCookie: null,
    distinct: false,
    noLock: false,
    aggregate: false,
  };
}

/**
 * @typedef {Object} FetchModel
 * @property {string} entity
 * @property {Array<{name:string, alias?:string, aggregate?:string, groupby?:boolean}>} attributes
 * @property {boolean} allAttributes
 * @property {FilterGroup} filters
 * @property {Array<{attribute:string, descending:boolean}>} orders
 * @property {LinkEntityModel[]} linkEntities
 * @property {number|null} top
 * @property {number|null} page
 * @property {number|null} pageSize
 * @property {string|null} pagingCookie
 * @property {boolean} distinct
 * @property {boolean} noLock
 * @property {boolean} aggregate
 */

/**
 * @typedef {Object} FilterGroup
 * @property {'and'|'or'} type
 * @property {Array<{attribute:string, operator:string, value:string}>} conditions
 * @property {FilterGroup[]} filters
 */

/**
 * @typedef {Object} LinkEntityModel
 * @property {string} name
 * @property {string} from
 * @property {string} to
 * @property {string} linkType
 * @property {string} alias
 * @property {Array<{name:string, alias?:string}>} attributes
 * @property {boolean} allAttributes
 * @property {FilterGroup} filters
 * @property {Array<{attribute:string, descending:boolean}>} orders
 * @property {LinkEntityModel[]} linkEntities
 */

// ---------------------------------------------------------------------------
// Model → XML Serialisation
// ---------------------------------------------------------------------------

function modelToXml(model) {
  const lines = [];
  const fetchAttrs = [];
  if (model.top) fetchAttrs.push(`top="${xmlEscape(String(model.top))}"`);
  if (model.page) fetchAttrs.push(`page="${xmlEscape(String(model.page))}"`);
  if (model.pageSize) fetchAttrs.push(`count="${xmlEscape(String(model.pageSize))}"`);
  if (model.pagingCookie) fetchAttrs.push(`paging-cookie="${xmlEscape(model.pagingCookie)}"`);
  if (model.distinct) fetchAttrs.push('distinct="true"');
  if (model.noLock) fetchAttrs.push('no-lock="true"');
  if (model.aggregate) fetchAttrs.push('aggregate="true"');
  lines.push(`<fetch${fetchAttrs.length ? ' ' + fetchAttrs.join(' ') : ''}>`);

  if (model.entity) {
    lines.push(`  <entity name="${xmlEscape(model.entity)}">`);
    if (model.allAttributes) {
      lines.push('    <all-attributes />');
    } else {
      for (const attr of model.attributes) {
        const parts = [`name="${xmlEscape(attr.name)}"`];
        if (attr.alias) parts.push(`alias="${xmlEscape(attr.alias)}"`);
        if (attr.aggregate) parts.push(`aggregate="${xmlEscape(attr.aggregate)}"`);
        if (attr.groupby) parts.push('groupby="true"');
        lines.push(`    <attribute ${parts.join(' ')} />`);
      }
    }
    serialiseFilter(model.filters, lines, 4);
    for (const ord of model.orders) {
      lines.push(`    <order attribute="${xmlEscape(ord.attribute)}" descending="${ord.descending}" />`);
    }
    for (const le of model.linkEntities) {
      serialiseLinkEntity(le, lines, 4);
    }
    lines.push('  </entity>');
  }

  lines.push('</fetch>');
  return lines.join('\n');
}

function serialiseFilter(filter, lines, depth) {
  if (!filter) return;
  const hasConditions = filter.conditions && filter.conditions.length > 0;
  const hasSubFilters = filter.filters && filter.filters.length > 0;
  if (!hasConditions && !hasSubFilters) return;

  const pad = ' '.repeat(depth);
  lines.push(`${pad}<filter type="${filter.type}">`);

  for (const cond of (filter.conditions || [])) {
    const op = FETCH_OPERATORS.find(o => o.value === cond.operator);
    const needsValue = op ? op.requiresValue : true;

    if (cond.operator === 'in' || cond.operator === 'not-in') {
      lines.push(`${pad}  <condition attribute="${xmlEscape(cond.attribute)}" operator="${xmlEscape(cond.operator)}">`);
      const values = String(cond.value).split(',').map(v => v.trim());
      for (const v of values) {
        lines.push(`${pad}    <value>${xmlEscape(v)}</value>`);
      }
      lines.push(`${pad}  </condition>`);
    } else if (cond.operator === 'between' || cond.operator === 'not-between') {
      lines.push(`${pad}  <condition attribute="${xmlEscape(cond.attribute)}" operator="${xmlEscape(cond.operator)}">`);
      const values = String(cond.value).split(',').map(v => v.trim());
      for (const v of values.slice(0, 2)) {
        lines.push(`${pad}    <value>${xmlEscape(v)}</value>`);
      }
      lines.push(`${pad}  </condition>`);
    } else if (needsValue && cond.value !== '' && cond.value != null) {
      lines.push(`${pad}  <condition attribute="${xmlEscape(cond.attribute)}" operator="${xmlEscape(cond.operator)}" value="${xmlEscape(cond.value)}" />`);
    } else {
      lines.push(`${pad}  <condition attribute="${xmlEscape(cond.attribute)}" operator="${xmlEscape(cond.operator)}" />`);
    }
  }

  for (const sub of (filter.filters || [])) {
    serialiseFilter(sub, lines, depth + 2);
  }
  lines.push(`${pad}</filter>`);
}

function serialiseLinkEntity(le, lines, depth) {
  const pad = ' '.repeat(depth);
  const attrs = [
    `name="${xmlEscape(le.name)}"`,
    `from="${xmlEscape(le.from)}"`,
    `to="${xmlEscape(le.to)}"`,
    `link-type="${xmlEscape(le.linkType || 'inner')}"`,
  ];
  if (le.alias) attrs.push(`alias="${xmlEscape(le.alias)}"`);
  lines.push(`${pad}<link-entity ${attrs.join(' ')}>`);

  if (le.allAttributes) {
    lines.push(`${pad}  <all-attributes />`);
  } else {
    for (const attr of (le.attributes || [])) {
      const parts = [`name="${xmlEscape(attr.name)}"`];
      if (attr.alias) parts.push(`alias="${xmlEscape(attr.alias)}"`);
      lines.push(`${pad}  <attribute ${parts.join(' ')} />`);
    }
  }

  serialiseFilter(le.filters, lines, depth + 2);
  for (const ord of (le.orders || [])) {
    lines.push(`${pad}  <order attribute="${xmlEscape(ord.attribute)}" descending="${ord.descending}" />`);
  }
  for (const nested of (le.linkEntities || [])) {
    serialiseLinkEntity(nested, lines, depth + 2);
  }
  lines.push(`${pad}</link-entity>`);
}

// ---------------------------------------------------------------------------
// Model → XML Parsing
// ---------------------------------------------------------------------------

function xmlToModel(xml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      return { model: null, error: parseError.textContent || 'Invalid XML' };
    }
    const fetchEl = doc.querySelector('fetch');
    if (!fetchEl) return { model: null, error: 'No <fetch> element found' };

    const model = createEmptyModel();
    model.top = fetchEl.getAttribute('top') ? parseInt(fetchEl.getAttribute('top'), 10) : null;
    model.page = fetchEl.getAttribute('page') ? parseInt(fetchEl.getAttribute('page'), 10) : null;
    model.pageSize = fetchEl.getAttribute('count') ? parseInt(fetchEl.getAttribute('count'), 10) : null;
    model.pagingCookie = fetchEl.getAttribute('paging-cookie') || null;
    model.distinct = fetchEl.getAttribute('distinct') === 'true';
    model.noLock = fetchEl.getAttribute('no-lock') === 'true';
    model.aggregate = fetchEl.getAttribute('aggregate') === 'true';

    const entityEl = fetchEl.querySelector(':scope > entity');
    if (entityEl) {
      model.entity = entityEl.getAttribute('name') || '';
      parseEntityContent(entityEl, model);
    }
    return { model, error: null };
  } catch (err) {
    return { model: null, error: err.message };
  }
}

function parseEntityContent(el, target) {
  if (el.querySelector(':scope > all-attributes')) target.allAttributes = true;
  target.attributes = [];
  for (const attrEl of el.querySelectorAll(':scope > attribute')) {
    const attr = { name: attrEl.getAttribute('name') || '' };
    if (attrEl.getAttribute('alias')) attr.alias = attrEl.getAttribute('alias');
    if (attrEl.getAttribute('aggregate')) attr.aggregate = attrEl.getAttribute('aggregate');
    if (attrEl.getAttribute('groupby') === 'true') attr.groupby = true;
    target.attributes.push(attr);
  }
  const filterEl = el.querySelector(':scope > filter');
  target.filters = filterEl ? parseFilter(filterEl) : { type: 'and', conditions: [], filters: [] };
  target.orders = [];
  for (const orderEl of el.querySelectorAll(':scope > order')) {
    target.orders.push({
      attribute: orderEl.getAttribute('attribute') || '',
      descending: orderEl.getAttribute('descending') === 'true',
    });
  }
  target.linkEntities = [];
  for (const leEl of el.querySelectorAll(':scope > link-entity')) {
    target.linkEntities.push(parseLinkEntity(leEl));
  }
}

function parseFilter(filterEl) {
  const group = { type: filterEl.getAttribute('type') || 'and', conditions: [], filters: [] };
  for (const condEl of filterEl.querySelectorAll(':scope > condition')) {
    const cond = {
      attribute: condEl.getAttribute('attribute') || '',
      operator: condEl.getAttribute('operator') || 'eq',
      value: condEl.getAttribute('value') || '',
    };
    const valueEls = condEl.querySelectorAll(':scope > value');
    if (valueEls.length > 0) {
      cond.value = Array.from(valueEls).map(v => v.textContent || '').join(', ');
    }
    group.conditions.push(cond);
  }
  for (const subFilterEl of filterEl.querySelectorAll(':scope > filter')) {
    group.filters.push(parseFilter(subFilterEl));
  }
  return group;
}

function parseLinkEntity(leEl) {
  const le = {
    name: leEl.getAttribute('name') || '',
    from: leEl.getAttribute('from') || '',
    to: leEl.getAttribute('to') || '',
    linkType: leEl.getAttribute('link-type') || 'inner',
    alias: leEl.getAttribute('alias') || '',
    attributes: [],
    allAttributes: false,
    filters: { type: 'and', conditions: [], filters: [] },
    orders: [],
    linkEntities: [],
  };
  parseEntityContent(leEl, le);
  return le;
}

// ---------------------------------------------------------------------------
// Code Generation
// ---------------------------------------------------------------------------

function buildFetchUrl(baseUrl, entitySetName, fetchXml) {
  return `${baseUrl}/${entitySetName}?fetchXml=${encodeURIComponent(fetchXml)}`;
}

function generateCSharp(fetchXml) {
  const escaped = fetchXml.replace(/"/g, '""');
  return `// Using IOrganizationService
var fetchXml = @"${escaped}";

var fetchExpression = new FetchExpression(fetchXml);
EntityCollection results = service.RetrieveMultiple(fetchExpression);

foreach (Entity entity in results.Entities)
{
    Console.WriteLine(entity.Id);
}`;
}

function generateJavaScript(fetchXml, entitySetName) {
  const escaped = fetchXml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `// Using Xrm.WebApi
const fetchXml = \`${escaped}\`;

const encodedFetchXml = encodeURIComponent(fetchXml);

Xrm.WebApi.retrieveMultipleRecords("${entitySetName}", \`?fetchXml=\${encodedFetchXml}\`).then(
  function success(results) {
    console.log("Retrieved " + results.entities.length + " records");
    for (const entity of results.entities) {
      console.log(entity);
    }
  },
  function error(err) {
    console.error("Error: " + err.message);
  }
);`;
}

/**
 * Generate Power Automate flow steps from a visual query model.
 *
 * Returns a string containing:
 *  1. The raw FetchXML (to store in a variable)
 *  2. An HTTP action definition that calls the Dataverse Web API
 *  3. A Parse JSON action definition with a schema derived from the selected columns
 *
 * @param {Object} model        - FetchModel from the visual builder
 * @param {string} entitySetName
 * @param {string} baseUrl      - Org URL, e.g. https://org.crm.dynamics.com
 * @param {Array}  attrs        - AttributeMetadata[] for the entity (used to map types)
 * @returns {string}
 */
function generatePowerAutomate(model, entitySetName, baseUrl, attrs) {
  const xml = modelToXml(model);

  // Map Dataverse attribute types to JSON Schema primitive types
  const toJsonType = (dvType) => {
    switch (dvType) {
      case 'Integer': case 'BigInt': case 'Decimal': case 'Double': case 'Money':
        return 'number';
      case 'Boolean':
        return 'boolean';
      default:
        return 'string';
    }
  };

  // Build the properties object for the Parse JSON schema
  const selectedNames = model.allAttributes
    ? attrs.map(a => a.LogicalName)
    : (model.attributes || []).map(a => a.name).filter(Boolean);

  const itemProperties = { '@odata.etag': { type: 'string' } };
  for (const name of selectedNames) {
    const meta = attrs.find(a => a.LogicalName === name);
    itemProperties[name] = { type: toJsonType(meta?.AttributeType) };
  }

  // Also include any lookup _xxx_value fields that Dataverse auto-adds
  for (const name of selectedNames) {
    const meta = attrs.find(a => a.LogicalName === name);
    if (meta?.AttributeType === 'Lookup' || meta?.AttributeType === 'Owner' || meta?.AttributeType === 'Customer') {
      itemProperties[`_${name}_value`] = { type: 'string' };
    }
  }

  const apiUrl = `${baseUrl}/api/data/v9.2/${entitySetName}`;

  const httpAction = {
    type: 'Http',
    inputs: {
      method: 'GET',
      uri: `${apiUrl}?fetchXml=@{encodeUriComponent(variables('FetchXml'))}`,
      authentication: {
        type: 'ActiveDirectoryOAuth',
        tenant: "@variables('TenantId')",
        audience: baseUrl || 'https://<org>.crm.dynamics.com',
        clientId: "@variables('ClientId')",
        secret: "@variables('ClientSecret')",
      },
      headers: {
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        Prefer: 'odata.include-annotations="*"',
      },
    },
  };

  const parseJsonAction = {
    type: 'ParseJson',
    inputs: {
      content: "@body('HTTP')",
      schema: {
        type: 'object',
        properties: {
          '@odata.context': { type: 'string' },
          value: {
            type: 'array',
            items: { type: 'object', properties: itemProperties },
          },
        },
      },
    },
  };

  return [
    '// ── Step 0: Initialize variable ───────────────────────────────────────',
    '// Add an "Initialize variable" action named FetchXml with this value:',
    xml,
    '',
    '// ── Step 1: HTTP action ────────────────────────────────────────────────',
    '// Paste this into the HTTP action\'s "Code view" (rename action to "HTTP")',
    JSON.stringify(httpAction, null, 2),
    '',
    '// ── Step 2: Parse JSON action ─────────────────────────────────────────',
    '// Paste this schema into the Parse JSON "Code view"',
    JSON.stringify(parseJsonAction, null, 2),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// OData Serialiser
// ---------------------------------------------------------------------------

function modelToOData(model, entitySetName) {
  const parts = [];

  if (!model.allAttributes && model.attributes.length > 0) {
    const cols = model.attributes.map(a => a.name).filter(Boolean);
    if (cols.length) parts.push(`$select=${cols.join(',')}`);
  }

  const filterStr = _buildODataFilter(model.filters);
  if (filterStr) parts.push(`$filter=${filterStr}`);

  if (model.orders.length > 0) {
    parts.push(`$orderby=${model.orders.map(o => `${o.attribute} ${o.descending ? 'desc' : 'asc'}`).join(',')}`);
  }

  if (model.top) parts.push(`$top=${model.top}`);

  const expands = [];
  for (const le of (model.linkEntities || [])) {
    const navProp = le._relMeta?.navigationProp;
    if (!navProp) continue;
    if (!le.allAttributes && le.attributes.length > 0) {
      const cols = le.attributes.map(a => a.name).filter(Boolean).join(',');
      expands.push(cols ? `${navProp}($select=${cols})` : navProp);
    } else {
      expands.push(navProp);
    }
  }
  if (expands.length) parts.push(`$expand=${expands.join(',')}`);

  return `${entitySetName}${parts.length ? '?' + parts.join('&') : ''}`;
}

function _buildODataFilter(group) {
  if (!group) return '';
  const parts = [];
  for (const cond of (group.conditions || [])) {
    const s = _condToOData(cond);
    if (s) parts.push(s);
  }
  for (const sub of (group.filters || [])) {
    const s = _buildODataFilter(sub);
    if (s) parts.push(`(${s})`);
  }
  if (!parts.length) return '';
  return parts.join(` ${group.type} `);
}

function _condToOData(cond) {
  const { attribute: attr, operator: op, value: val } = cond;
  if (!attr) return '';
  switch (op) {
    case 'eq': return `${attr} eq ${val !== '' ? `'${val}'` : 'null'}`;
    case 'ne': return `${attr} ne ${val !== '' ? `'${val}'` : 'null'}`;
    case 'gt': return `${attr} gt ${val}`;
    case 'lt': return `${attr} lt ${val}`;
    case 'ge': return `${attr} ge ${val}`;
    case 'le': return `${attr} le ${val}`;
    case 'null': return `${attr} eq null`;
    case 'not-null': return `${attr} ne null`;
    case 'like':
    case 'contains': return `contains(${attr},'${val}')`;
    case 'not-like':
    case 'not-contain': return `not contains(${attr},'${val}')`;
    case 'begins-with': return `startswith(${attr},'${val}')`;
    case 'not-begin-with': return `not startswith(${attr},'${val}')`;
    case 'ends-with': return `endswith(${attr},'${val}')`;
    case 'not-end-with': return `not endswith(${attr},'${val}')`;
    case 'in': {
      const vals = String(val).split(',').map(v => v.trim()).filter(Boolean);
      return vals.length ? `${attr} in (${vals.map(v => `'${v}'`).join(',')})` : '';
    }
    case 'not-in': {
      const vals = String(val).split(',').map(v => v.trim()).filter(Boolean);
      return vals.length ? `not (${attr} in (${vals.map(v => `'${v}'`).join(',')}))` : '';
    }
    case 'between': {
      const [a, b] = String(val).split(',').map(v => v.trim());
      return a && b ? `(${attr} ge ${a} and ${attr} le ${b})` : '';
    }
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// FetchXmlBuilder Class – Visual Node-Card Query Builder
// ---------------------------------------------------------------------------

export class FetchXmlBuilder {
  /**
   * @param {HTMLElement} container
   * @param {Object} apiClient
   * @param {Object} metadataCache  - exposes getEntities(), getAttributes(n), getRelationships(n), getOptionSet(n,a)
   */
  constructor(container, apiClient, metadataCache) {
    this.container = container;
    this.api = apiClient;
    this.cache = metadataCache;
    this.model = createEmptyModel();
    this._outputMode = 'fetchxml';
    this._entities = [];
    this._attrCache = new Map();
    this._syncing = false;
    this._canvas = null;
    this._rawTextarea = null;
    this._resultsPanel = null;
    this._entityInput = null;
    this._autocompleteList = null;
    this._execBtn = null;
    this._topInput = null;
    this._debouncedSync = debounce(() => this._syncModelToRaw(), 200);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async render() {
    this.container.innerHTML = '';
    this.container.classList.add('qb-container');

    const loading = document.createElement('div');
    loading.className = 'qb-loading';
    loading.textContent = 'Loading entities\u2026';
    this.container.appendChild(loading);

    await this._loadEntities();
    loading.remove();
    this._buildLayout();
  }

  loadXml(xml) {
    const { model, error } = xmlToModel(xml);
    if (model) {
      this.model = model;
      if (this._entityInput) this._entityInput.value = model.entity;
      this._renderCards();
      this._syncModelToRaw();
    } else {
      this._showNotification(`XML parse error: ${error}`, 'error');
    }
  }

  getXml() { return modelToXml(this.model); }
  getModel() { return { ...this.model }; }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  _buildLayout() {
    this.container.innerHTML = '';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'qb-toolbar';
    this._buildEntityPicker(toolbar);

    const tmplBtn = this._createButton('Templates', 'qb-btn qb-btn-secondary', () => this._showTemplateMenu(tmplBtn));
    toolbar.appendChild(tmplBtn);

    const tabs = document.createElement('div');
    tabs.className = 'qb-output-tabs';
    const fxBtn = document.createElement('button');
    fxBtn.className = 'qb-tab-btn' + (this._outputMode === 'fetchxml' ? ' active' : '');
    fxBtn.textContent = 'FetchXML';
    fxBtn.addEventListener('click', () => {
      this._outputMode = 'fetchxml';
      fxBtn.classList.add('active');
      odBtn.classList.remove('active');
      if (this._rawTextarea) this._rawTextarea.readOnly = false;
      this._syncModelToRaw();
    });
    const odBtn = document.createElement('button');
    odBtn.className = 'qb-tab-btn' + (this._outputMode === 'odata' ? ' active' : '');
    odBtn.textContent = 'OData';
    odBtn.addEventListener('click', () => {
      this._outputMode = 'odata';
      odBtn.classList.add('active');
      fxBtn.classList.remove('active');
      if (this._rawTextarea) this._rawTextarea.readOnly = true;
      this._syncModelToRaw();
    });
    tabs.append(fxBtn, odBtn);
    toolbar.appendChild(tabs);

    const execBtn = this._createButton('\u25B6 Execute', 'qb-btn qb-btn-primary', () => this._executeQuery());
    execBtn.title = 'Ctrl+Enter';
    this._execBtn = execBtn;
    toolbar.appendChild(execBtn);

    const clearBtn = this._createButton('Clear', 'qb-btn qb-btn-secondary', () => {
      this.model = createEmptyModel();
      if (this._entityInput) this._entityInput.value = '';
      if (this._topInput) this._topInput.value = '';
      this._renderCards();
      this._syncModelToRaw();
      if (this._resultsPanel) this._resultsPanel.style.display = 'none';
    });
    toolbar.appendChild(clearBtn);

    const copyXmlBtn = this._createButton('Copy XML', 'qb-btn qb-btn-outline', () => {
      const err = this._validateModel(this.model);
      if (err) { this._showNotification(err, 'error'); return; }
      this._copyToClipboard(prettifyXml(modelToXml(this.model)));
    });
    const copyOdBtn = this._createButton('Copy OData', 'qb-btn qb-btn-outline', () => {
      const err = this._validateModel(this.model);
      if (err) { this._showNotification(err, 'error'); return; }
      const ent = this._entities.find(e => e.LogicalName === this.model.entity);
      this._copyToClipboard(modelToOData(this.model, ent?.EntitySetName || `${this.model.entity}s`));
    });

    const codeBtn = this._createButton('\u276F\_ Code', 'qb-btn qb-btn-secondary', () => this._showCodeGenMenu(codeBtn));
    codeBtn.title = 'Generate code (C#, JavaScript, Power Automate)';

    toolbar.append(copyXmlBtn, copyOdBtn, codeBtn);
    this.container.appendChild(toolbar);

    // Canvas
    const canvas = document.createElement('div');
    canvas.className = 'qb-canvas';
    this._canvas = canvas;
    this.container.appendChild(canvas);

    // Options bar
    this._buildOptionsBar();

    // Raw panel
    this._buildRawPanel();

    // Results panel
    const results = document.createElement('div');
    results.className = 'qb-results-panel';
    results.style.display = 'none';
    this._resultsPanel = results;
    this.container.appendChild(results);

    this._renderCards();
    this._syncModelToRaw();
  }

  // -------------------------------------------------------------------------
  // Entity picker
  // -------------------------------------------------------------------------

  _buildEntityPicker(toolbar) {
    const wrap = document.createElement('div');
    wrap.className = 'qb-entity-picker';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'qb-input qb-entity-input';
    input.placeholder = 'Select entity\u2026';
    input.value = this.model.entity;
    input.autocomplete = 'off';
    this._entityInput = input;

    const list = document.createElement('div');
    list.className = 'qb-autocomplete-list';
    list.style.display = 'none';
    this._autocompleteList = list;

    input.addEventListener('input', () => this._showAutocomplete(input.value));
    input.addEventListener('focus', () => this._showAutocomplete(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._hideAutocomplete();
      if (e.key === 'Enter') {
        const first = list.querySelector('.qb-autocomplete-item');
        if (first) first.click();
      }
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) this._hideAutocomplete();
    }, { capture: true });

    wrap.append(input, list);
    toolbar.appendChild(wrap);
  }

  _showAutocomplete(query) {
    const list = this._autocompleteList;
    if (!list) return;
    const q = (query || '').toLowerCase();
    const filtered = this._entities.filter(e => {
      const name = e.LogicalName.toLowerCase();
      const disp = (e.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase();
      return !q || name.includes(q) || disp.includes(q);
    }).slice(0, 60);

    list.innerHTML = '';
    for (const ent of filtered) {
      const item = document.createElement('div');
      item.className = 'qb-autocomplete-item';
      const disp = ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName;
      item.textContent = disp !== ent.LogicalName ? `${disp} (${ent.LogicalName})` : ent.LogicalName;
      item.dataset.value = ent.LogicalName;
      item.addEventListener('mousedown', (e) => { e.preventDefault(); this._selectEntity(ent.LogicalName); });
      list.appendChild(item);
    }
    list.style.display = filtered.length ? 'block' : 'none';
  }

  _hideAutocomplete() {
    if (this._autocompleteList) this._autocompleteList.style.display = 'none';
  }

  async _selectEntity(entityName) {
    this._hideAutocomplete();
    if (this._entityInput) this._entityInput.value = entityName;
    this.model = createEmptyModel();
    this.model.entity = entityName;
    this.model.top = 50;
    if (this._topInput) this._topInput.value = '50';
    await this._loadAttributes(entityName);
    this._renderCards();
    this._syncModelToRaw();
  }

  // -------------------------------------------------------------------------
  // Cards
  // -------------------------------------------------------------------------

  _renderCards() {
    if (!this._canvas) return;
    this._canvas.innerHTML = '';

    if (!this.model.entity) {
      const hint = document.createElement('div');
      hint.className = 'qb-canvas-hint';
      hint.textContent = 'Select an entity above to start building your query.';
      this._canvas.appendChild(hint);
      return;
    }

    this._canvas.appendChild(this._renderEntityCard(this.model, true, null));

    for (const le of this.model.linkEntities) {
      this._canvas.appendChild(this._renderEntityCard(le, false, this.model));
    }

    const addCard = document.createElement('div');
    addCard.className = 'qb-card qb-card-add';
    addCard.title = 'Add a related table';
    addCard.innerHTML = '<div class="qb-add-card-inner">\uFF0B<br>Related<br>Table</div>';
    addCard.addEventListener('click', () => this._showRelationshipPicker(this.model));
    this._canvas.appendChild(addCard);
  }

  _renderEntityCard(entityModel, isRoot, parentModel) {
    const card = document.createElement('div');
    card.className = `qb-card ${isRoot ? 'qb-card-root' : 'qb-card-linked'}`;

    // Header
    const header = document.createElement('div');
    header.className = 'qb-card-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'qb-card-title-wrap';

    const entityName = isRoot ? (entityModel.entity || '') : (entityModel.name || '');
    const entDef = this._entities.find(e => e.LogicalName === entityName);
    const displayName = entDef?.DisplayName?.UserLocalizedLabel?.Label || entityName;

    const titleEl = document.createElement('span');
    titleEl.className = 'qb-card-title';
    titleEl.textContent = displayName;
    titleEl.title = entityName;

    titleWrap.appendChild(titleEl);

    if (!isRoot) {
      const joinType = entityModel._relMeta?.joinType || '';
      const badge = document.createElement('span');
      badge.className = 'qb-rel-badge';
      badge.textContent = joinType === 'ManyToOne' ? 'N:1' : joinType === 'OneToMany' ? '1:N' : 'N:N';
      titleWrap.appendChild(badge);
    }

    header.appendChild(titleWrap);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'qb-card-actions';

    if (isRoot) {
      const addRelBtn = document.createElement('button');
      addRelBtn.className = 'qb-add-link-btn';
      addRelBtn.textContent = '+ Related';
      addRelBtn.title = 'Add related table';
      addRelBtn.addEventListener('click', () => this._showRelationshipPicker(entityModel));
      actionsEl.appendChild(addRelBtn);
    } else {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'qb-remove-card-btn';
      removeBtn.textContent = '\u00D7';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        const idx = this.model.linkEntities.indexOf(entityModel);
        if (idx !== -1) this.model.linkEntities.splice(idx, 1);
        this._renderCards();
        this._debouncedSync();
      });
      actionsEl.appendChild(removeBtn);
    }
    header.appendChild(actionsEl);
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'qb-card-body';

    const attrs = this._attrCache.get(entityName) || [];
    this._renderColumnsSection(body, entityModel, attrs);
    this._renderFiltersSection(body, entityModel, entityName, attrs);
    this._renderSortsSection(body, entityModel, attrs);
    card.appendChild(body);

    // Lazy-load attrs if missing
    if (!this._attrCache.has(entityName) && entityName) {
      this._loadAttributes(entityName).then(() => {
        const fresh = this._attrCache.get(entityName) || [];
        if (fresh.length) {
          body.innerHTML = '';
          this._renderColumnsSection(body, entityModel, fresh);
          this._renderFiltersSection(body, entityModel, entityName, fresh);
          this._renderSortsSection(body, entityModel, fresh);
        }
      });
    }

    return card;
  }

  // -------------------------------------------------------------------------
  // Columns section
  // -------------------------------------------------------------------------

  _renderColumnsSection(body, entityModel, attrs) {
    const section = document.createElement('details');
    section.className = 'qb-section qb-section-columns';
    section.open = true;

    const summary = document.createElement('summary');
    summary.className = 'qb-section-title';
    const updateSummary = () => {
      summary.textContent = `Columns (${entityModel.allAttributes ? 'All' : entityModel.attributes.length})`;
    };
    updateSummary();
    section.appendChild(summary);

    // All-attributes toggle
    const allLabel = document.createElement('label');
    allLabel.className = 'qb-checkbox-label qb-all-attrs';
    const allCheck = document.createElement('input');
    allCheck.type = 'checkbox';
    allCheck.checked = entityModel.allAttributes;
    allLabel.append(allCheck, '\u00A0All columns');
    section.appendChild(allLabel);

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'qb-col-search';
    search.placeholder = 'Filter columns\u2026';
    section.appendChild(search);

    const colList = document.createElement('div');
    colList.className = 'qb-col-list';
    colList.style.display = entityModel.allAttributes ? 'none' : '';

    allCheck.addEventListener('change', () => {
      entityModel.allAttributes = allCheck.checked;
      colList.style.display = allCheck.checked ? 'none' : '';
      updateSummary();
      this._debouncedSync();
    });

    const selectedNames = new Set(entityModel.attributes.map(a => a.name));

    for (const attr of attrs) {
      const name = attr.LogicalName || attr.logicalName || '';
      if (!name) continue;

      const item = document.createElement('label');
      item.className = 'qb-col-item';
      item.dataset.name = name;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedNames.has(name);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!entityModel.attributes.find(a => a.name === name)) {
            entityModel.attributes.push({ name });
          }
        } else {
          const i = entityModel.attributes.findIndex(a => a.name === name);
          if (i !== -1) entityModel.attributes.splice(i, 1);
        }
        updateSummary();
        this._debouncedSync();
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'qb-col-name';
      const disp = attr.DisplayName?.UserLocalizedLabel?.Label;
      nameSpan.textContent = disp && disp !== name ? `${disp} (${name})` : name;

      item.append(cb, nameSpan, this._createTypeBadge(attr.AttributeType || ''));
      colList.appendChild(item);
    }

    section.appendChild(colList);

    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      for (const item of colList.querySelectorAll('.qb-col-item')) {
        item.style.display = !q || item.dataset.name.includes(q) ? '' : 'none';
      }
    });

    body.appendChild(section);
  }

  // -------------------------------------------------------------------------
  // Filters section
  // -------------------------------------------------------------------------

  _renderFiltersSection(body, entityModel, entityName, attrs) {
    const section = document.createElement('details');
    section.className = 'qb-section qb-section-filters';
    const hasConds = (this._countConditions(entityModel.filters) > 0);
    section.open = hasConds;

    const summary = document.createElement('summary');
    summary.className = 'qb-section-title';
    const updateSummary = () => {
      summary.textContent = `Filters (${this._countConditions(entityModel.filters)})`;
    };
    updateSummary();
    section.appendChild(summary);

    if (!entityModel.filters) {
      entityModel.filters = { type: 'and', conditions: [], filters: [] };
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'qb-filter-group';
    this._renderFilterGroup(groupEl, entityModel.filters, entityName, attrs, 0, () => {
      updateSummary();
      this._debouncedSync();
    });
    section.appendChild(groupEl);
    body.appendChild(section);
  }

  _countConditions(group) {
    if (!group) return 0;
    return (group.conditions?.length || 0) +
      (group.filters || []).reduce((s, g) => s + this._countConditions(g), 0);
  }

  _renderFilterGroup(groupEl, filterGroup, entityName, attrs, depth, onChange) {
    groupEl.innerHTML = '';

    const typeRow = document.createElement('div');
    typeRow.className = 'qb-filter-type-row';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'qb-select qb-select-sm';
    typeSelect.innerHTML = '<option value="and">AND</option><option value="or">OR</option>';
    typeSelect.value = filterGroup.type;
    typeSelect.addEventListener('change', () => { filterGroup.type = typeSelect.value; onChange(); });

    const addCondBtn = this._createButton('+ Condition', 'qb-btn qb-btn-xs qb-btn-outline', () => {
      filterGroup.conditions.push({ attribute: '', operator: 'eq', value: '' });
      this._renderFilterGroup(groupEl, filterGroup, entityName, attrs, depth, onChange);
      onChange();
    });
    const addGroupBtn = this._createButton('+ Group', 'qb-btn qb-btn-xs qb-btn-outline', () => {
      filterGroup.filters.push({ type: 'and', conditions: [], filters: [] });
      this._renderFilterGroup(groupEl, filterGroup, entityName, attrs, depth, onChange);
      onChange();
    });

    typeRow.append(typeSelect, addCondBtn, addGroupBtn);
    groupEl.appendChild(typeRow);

    for (let i = 0; i < filterGroup.conditions.length; i++) {
      const row = this._renderConditionRow(
        filterGroup, filterGroup.conditions[i], i, entityName, attrs,
        () => { this._renderFilterGroup(groupEl, filterGroup, entityName, attrs, depth, onChange); onChange(); }
      );
      groupEl.appendChild(row);
    }

    for (let i = 0; i < (filterGroup.filters || []).length; i++) {
      const subGroup = filterGroup.filters[i];
      const subWrap = document.createElement('div');
      subWrap.className = 'qb-filter-subgroup';

      const removeGroupBtn = this._createButton('\u00D7 group', 'qb-btn qb-btn-xs qb-btn-danger', () => {
        filterGroup.filters.splice(i, 1);
        this._renderFilterGroup(groupEl, filterGroup, entityName, attrs, depth, onChange);
        onChange();
      });
      subWrap.appendChild(removeGroupBtn);

      const subGroupEl = document.createElement('div');
      subGroupEl.className = 'qb-filter-group qb-filter-group-nested';
      this._renderFilterGroup(subGroupEl, subGroup, entityName, attrs, depth + 1, onChange);
      subWrap.appendChild(subGroupEl);
      groupEl.appendChild(subWrap);
    }
  }

  _renderConditionRow(filterGroup, cond, index, entityName, attrs, onRemove) {
    const row = document.createElement('div');
    row.className = 'qb-filter-row';

    // Attribute select
    const attrSelect = document.createElement('select');
    attrSelect.className = 'qb-select qb-attr-select';
    attrSelect.innerHTML = '<option value="">-- Attribute --</option>';
    for (const a of attrs) {
      const name = a.LogicalName || a.logicalName || '';
      const disp = a.DisplayName?.UserLocalizedLabel?.Label || name;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = disp !== name ? `${disp} (${name})` : name;
      if (name === cond.attribute) opt.selected = true;
      attrSelect.appendChild(opt);
    }

    // Operator select
    const opSelect = document.createElement('select');
    opSelect.className = 'qb-select qb-op-select';

    // Value wrapper
    const valWrap = document.createElement('div');
    valWrap.className = 'qb-val-wrap';

    const getAttrType = () => {
      const a = attrs.find(x => (x.LogicalName || x.logicalName) === cond.attribute);
      return a?.AttributeType || '';
    };

    const rebuildOperators = () => {
      const t = getAttrType();
      opSelect.innerHTML = '';
      let ops = FETCH_OPERATORS;
      if (['Picklist', 'Status', 'State', 'Boolean'].includes(t)) {
        ops = FETCH_OPERATORS.filter(o => ['eq','ne','null','not-null','in','not-in'].includes(o.value));
      } else if (['Integer','BigInt','Decimal','Double','Money'].includes(t)) {
        ops = FETCH_OPERATORS.filter(o => ['eq','ne','gt','lt','ge','le','null','not-null','between','not-between','in','not-in'].includes(o.value));
      } else if (t === 'DateTime') {
        ops = FETCH_OPERATORS.filter(o => ['eq','ne','gt','lt','ge','le','null','not-null','today','yesterday','tomorrow','last-x-days','next-x-days','last-x-hours','next-x-hours'].includes(o.value));
      } else if (['Lookup','Owner','Customer','Uniqueidentifier'].includes(t)) {
        ops = FETCH_OPERATORS.filter(o => ['eq','ne','null','not-null','in','not-in'].includes(o.value));
      } else if (t === 'String' || t === 'Memo') {
        ops = FETCH_OPERATORS.filter(o => ['eq','ne','like','not-like','null','not-null','contains','not-contain','begins-with','not-begin-with','ends-with','not-end-with'].includes(o.value));
      }
      for (const op of ops) {
        const opt = document.createElement('option');
        opt.value = op.value;
        opt.textContent = op.label;
        if (op.value === cond.operator) opt.selected = true;
        opSelect.appendChild(opt);
      }
      if (!opSelect.value && ops.length) {
        cond.operator = ops[0].value;
        opSelect.value = cond.operator;
      }
    };

    const rebuildValueInput = async () => {
      valWrap.innerHTML = '';
      const opMeta = FETCH_OPERATORS.find(o => o.value === cond.operator);
      if (!opMeta?.requiresValue) return;

      const t = getAttrType();
      const isPicklist = ['Picklist', 'Status', 'State'].includes(t);
      const isMulti = ['in','not-in'].includes(cond.operator);

      if (isPicklist && cond.attribute) {
        const loadingSpan = document.createElement('span');
        loadingSpan.className = 'qb-val-loading';
        loadingSpan.textContent = '\u2026';
        valWrap.appendChild(loadingSpan);
        try {
          const options = await this.cache.getOptionSet(entityName, cond.attribute);
          loadingSpan.remove();
          if (isMulti) {
            const sel = document.createElement('select');
            sel.className = 'qb-select qb-val-select';
            sel.multiple = true;
            sel.size = Math.min(options.length + 1, 4);
            for (const opt of options) {
              const lbl = opt.Label?.UserLocalizedLabel?.Label || String(opt.Value);
              const o = document.createElement('option');
              o.value = String(opt.Value);
              o.textContent = `${lbl} (${opt.Value})`;
              if (cond.value.split(',').map(v => v.trim()).includes(String(opt.Value))) o.selected = true;
              sel.appendChild(o);
            }
            sel.addEventListener('change', () => {
              cond.value = Array.from(sel.selectedOptions).map(o => o.value).join(',');
              this._debouncedSync();
            });
            valWrap.appendChild(sel);
          } else {
            const sel = document.createElement('select');
            sel.className = 'qb-select qb-val-select';
            sel.innerHTML = '<option value="">-- Value --</option>';
            for (const opt of options) {
              const lbl = opt.Label?.UserLocalizedLabel?.Label || String(opt.Value);
              const o = document.createElement('option');
              o.value = String(opt.Value);
              o.textContent = `${lbl} (${opt.Value})`;
              if (String(opt.Value) === cond.value) o.selected = true;
              sel.appendChild(o);
            }
            sel.addEventListener('change', () => { cond.value = sel.value; this._debouncedSync(); });
            valWrap.appendChild(sel);
          }
        } catch {
          loadingSpan.remove();
          this._appendTextInput(valWrap, cond);
        }
      } else if (t === 'Boolean' && cond.attribute) {
        const sel = document.createElement('select');
        sel.className = 'qb-select qb-val-select';
        sel.innerHTML = '<option value="1">True</option><option value="0">False</option>';
        sel.value = cond.value;
        sel.addEventListener('change', () => { cond.value = sel.value; this._debouncedSync(); });
        valWrap.appendChild(sel);
      } else if (t === 'DateTime' && !['last-x-days','next-x-days','last-x-hours','next-x-hours'].includes(cond.operator)) {
        const inp = document.createElement('input');
        inp.type = 'date';
        inp.className = 'qb-input qb-val-input';
        inp.value = cond.value;
        inp.addEventListener('change', () => { cond.value = inp.value; this._debouncedSync(); });
        valWrap.appendChild(inp);
      } else if (['between','not-between'].includes(cond.operator)) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'qb-input qb-val-input';
        inp.placeholder = 'val1, val2';
        inp.value = cond.value;
        inp.addEventListener('input', () => { cond.value = inp.value; this._debouncedSync(); });
        valWrap.appendChild(inp);
      } else {
        const numTypes = ['Integer','BigInt','Decimal','Double','Money'];
        this._appendTextInput(valWrap, cond, numTypes.includes(t) ? 'number' : 'text');
      }
    };

    attrSelect.addEventListener('change', () => {
      cond.attribute = attrSelect.value;
      cond.value = '';
      rebuildOperators();
      rebuildValueInput();
      this._debouncedSync();
    });

    opSelect.addEventListener('change', () => {
      cond.operator = opSelect.value;
      cond.value = '';
      rebuildValueInput();
      this._debouncedSync();
    });

    const removeBtn = this._createButton('\u00D7', 'qb-btn qb-btn-xs qb-btn-danger', () => {
      filterGroup.conditions.splice(index, 1);
      onRemove();
    });

    rebuildOperators();
    rebuildValueInput();

    row.append(attrSelect, opSelect, valWrap, removeBtn);
    return row;
  }

  _appendTextInput(container, cond, type = 'text') {
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'qb-input qb-val-input';
    inp.value = cond.value;
    inp.placeholder = type === 'number' ? '#' : 'value';
    inp.addEventListener('input', () => { cond.value = inp.value; this._debouncedSync(); });
    container.appendChild(inp);
  }

  // -------------------------------------------------------------------------
  // Sorts section
  // -------------------------------------------------------------------------

  _renderSortsSection(body, entityModel, attrs) {
    const section = document.createElement('details');
    section.className = 'qb-section qb-section-sorts';

    const summary = document.createElement('summary');
    summary.className = 'qb-section-title';

    const list = document.createElement('div');
    list.className = 'qb-sort-list';

    const refresh = () => {
      list.innerHTML = '';
      summary.textContent = `Sort (${entityModel.orders.length})`;

      for (let i = 0; i < entityModel.orders.length; i++) {
        const ord = entityModel.orders[i];
        const row = document.createElement('div');
        row.className = 'qb-sort-row';

        const sel = document.createElement('select');
        sel.className = 'qb-select qb-attr-select';
        sel.innerHTML = '<option value="">-- Attribute --</option>';
        for (const a of attrs) {
          const name = a.LogicalName || a.logicalName || '';
          const disp = a.DisplayName?.UserLocalizedLabel?.Label || name;
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = disp !== name ? `${disp} (${name})` : name;
          if (name === ord.attribute) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => { ord.attribute = sel.value; this._debouncedSync(); });

        const dirBtn = document.createElement('button');
        dirBtn.className = 'qb-btn qb-btn-xs qb-btn-outline qb-sort-dir';
        dirBtn.textContent = ord.descending ? 'DESC' : 'ASC';
        dirBtn.addEventListener('click', () => {
          ord.descending = !ord.descending;
          dirBtn.textContent = ord.descending ? 'DESC' : 'ASC';
          this._debouncedSync();
        });

        const removeBtn = this._createButton('\u00D7', 'qb-btn qb-btn-xs qb-btn-danger', () => {
          entityModel.orders.splice(i, 1);
          refresh();
          this._debouncedSync();
        });

        row.append(sel, dirBtn, removeBtn);
        list.appendChild(row);
      }

      list.appendChild(this._createButton('+ Sort', 'qb-btn qb-btn-xs qb-btn-outline', () => {
        entityModel.orders.push({ attribute: '', descending: false });
        refresh();
      }));
    };

    refresh();
    section.appendChild(summary);
    section.appendChild(list);
    body.appendChild(section);
  }

  // -------------------------------------------------------------------------
  // Options bar
  // -------------------------------------------------------------------------

  _buildOptionsBar() {
    const bar = document.createElement('div');
    bar.className = 'qb-options-bar';

    const topLabel = document.createElement('label');
    topLabel.className = 'qb-option-label';
    topLabel.textContent = 'Top:\u00A0';
    const topInput = document.createElement('input');
    topInput.type = 'number';
    topInput.className = 'qb-input qb-input-xs';
    topInput.min = 1;
    topInput.max = 5000;
    topInput.value = this.model.top || '';
    topInput.placeholder = 'all';
    topInput.addEventListener('change', () => {
      this.model.top = topInput.value ? parseInt(topInput.value, 10) : null;
      this._debouncedSync();
    });
    topLabel.appendChild(topInput);
    this._topInput = topInput;

    const mk = (label, getter, setter) => {
      const lbl = document.createElement('label');
      lbl.className = 'qb-option-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = getter();
      cb.addEventListener('change', () => { setter(cb.checked); this._debouncedSync(); });
      lbl.append(cb, '\u00A0' + label);
      return lbl;
    };

    bar.append(
      topLabel,
      mk('Distinct', () => this.model.distinct, v => { this.model.distinct = v; }),
      mk('No Lock', () => this.model.noLock, v => { this.model.noLock = v; }),
      mk('Aggregate', () => this.model.aggregate, v => { this.model.aggregate = v; }),
    );
    this.container.appendChild(bar);
  }

  // -------------------------------------------------------------------------
  // Raw panel
  // -------------------------------------------------------------------------

  _buildRawPanel() {
    const panel = document.createElement('details');
    panel.className = 'qb-raw-panel';

    const summary = document.createElement('summary');
    summary.className = 'qb-raw-summary';
    summary.textContent = 'XML / OData';
    panel.appendChild(summary);

    const toolbar = document.createElement('div');
    toolbar.className = 'qb-raw-toolbar';

    const formatBtn = this._createButton('Format', 'qb-btn qb-btn-xs qb-btn-outline', () => {
      if (this._rawTextarea && this._outputMode === 'fetchxml') {
        this._rawTextarea.value = prettifyXml(this._rawTextarea.value);
      }
    });
    const applyBtn = this._createButton('Apply', 'qb-btn qb-btn-xs qb-btn-primary', () => {
      if (this._outputMode === 'fetchxml') this._syncRawToModel();
    });
    toolbar.append(formatBtn, applyBtn);
    panel.appendChild(toolbar);

    const textarea = document.createElement('textarea');
    textarea.className = 'qb-raw-editor';
    textarea.spellcheck = false;
    textarea.wrap = 'off';
    textarea.readOnly = this._outputMode === 'odata';
    this._rawTextarea = textarea;

    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this._executeQuery();
      }
    });

    panel.appendChild(textarea);
    this.container.appendChild(panel);
  }

  // -------------------------------------------------------------------------
  // Template menu
  // -------------------------------------------------------------------------

  _showTemplateMenu(anchor) {
    const existing = document.getElementById('qb-template-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'qb-template-menu';
    menu.className = 'qb-dropdown-menu';

    for (const tmpl of TEMPLATE_QUERIES) {
      const item = document.createElement('div');
      item.className = 'qb-dropdown-item';
      item.textContent = tmpl.name;
      item.title = tmpl.description;
      item.addEventListener('click', () => {
        menu.remove();
        const entityName = this.model.entity;
        if (!entityName) { this._showNotification('Select an entity first', 'warning'); return; }
        this.model = tmpl.buildFetch(entityName);
        if (this._topInput) this._topInput.value = this.model.top || '';
        this._renderCards();
        this._syncModelToRaw();
      });
      menu.appendChild(item);
    }

    const rect = anchor.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    menu.style.top = `${rect.bottom - containerRect.top}px`;
    menu.style.left = `${rect.left - containerRect.left}px`;
    this.container.style.position = 'relative';
    this.container.appendChild(menu);

    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }

  // -------------------------------------------------------------------------
  // Code generation menu + modal
  // -------------------------------------------------------------------------

  _showCodeGenMenu(anchor) {
    const existing = document.getElementById('qb-code-menu');
    if (existing) { existing.remove(); return; }

    if (!this.model.entity) {
      this._showNotification('Select an entity first', 'warning');
      return;
    }

    const menu = document.createElement('div');
    menu.id = 'qb-code-menu';
    menu.className = 'qb-dropdown-menu';

    const items = [
      {
        label: 'C# \u2014 FetchExpression',
        generate: () => generateCSharp(modelToXml(this.model)),
      },
      {
        label: 'JavaScript \u2014 Xrm.WebApi',
        generate: () => {
          const ent = this._entities.find(e => e.LogicalName === this.model.entity);
          return generateJavaScript(modelToXml(this.model), ent?.EntitySetName || `${this.model.entity}s`);
        },
      },
      {
        label: 'Power Automate \u2014 HTTP + Parse JSON',
        generate: async () => {
          const err = this._validateModel(this.model);
          if (err) { this._showNotification(err, 'error'); return null; }
          const ent = this._entities.find(e => e.LogicalName === this.model.entity);
          const entitySetName = ent?.EntitySetName || `${this.model.entity}s`;
          let baseUrl = '';
          try {
            const env = await this.api.getEnvironment();
            baseUrl = env?.url || '';
          } catch { /* leave empty */ }
          const attrs = this._attrCache.get(this.model.entity) || [];
          return generatePowerAutomate(this.model, entitySetName, baseUrl, attrs);
        },
      },
    ];

    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'qb-dropdown-item';
      div.textContent = item.label;
      div.addEventListener('click', async () => {
        menu.remove();
        try {
          const code = await item.generate();
          if (code != null) this._showCodeModal(item.label, code);
        } catch (err) {
          this._showNotification(`Code generation failed: ${err.message}`, 'error');
        }
      });
      menu.appendChild(div);
    }

    const rect = anchor.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    menu.style.top = `${rect.bottom - containerRect.top}px`;
    menu.style.left = `${rect.left - containerRect.left}px`;
    this.container.style.position = 'relative';
    this.container.appendChild(menu);

    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }

  _showCodeModal(title, code) {
    document.getElementById('qb-code-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'qb-code-modal';
    overlay.className = 'qb-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'qb-modal qb-code-modal';

    const header = document.createElement('div');
    header.className = 'qb-modal-header';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'qb-modal-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.append(titleSpan, closeBtn);

    const pre = document.createElement('pre');
    pre.className = 'qb-code-block';
    pre.textContent = code;

    const footer = document.createElement('div');
    footer.className = 'qb-modal-footer';
    const copyBtn = this._createButton('Copy to Clipboard', 'qb-btn qb-btn-primary', () => {
      this._copyToClipboard(code);
      this._showNotification('Copied to clipboard', 'success');
    });
    footer.appendChild(copyBtn);

    modal.append(header, pre, footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // -------------------------------------------------------------------------
  // Relationship picker
  // -------------------------------------------------------------------------

  async _showRelationshipPicker(entityModel) {
    const entityName = entityModel.entity || entityModel.name || '';
    if (!entityName) { this._showNotification('Select an entity first', 'warning'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'qb-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'qb-modal';

    const mhdr = document.createElement('div');
    mhdr.className = 'qb-modal-header';
    mhdr.innerHTML = `<span>Add related table for <strong>${entityName}</strong></span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'qb-modal-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => overlay.remove());
    mhdr.appendChild(closeBtn);

    const mbody = document.createElement('div');
    mbody.className = 'qb-modal-body';
    mbody.textContent = 'Loading relationships\u2026';

    modal.append(mhdr, mbody);
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    try {
      const rels = await this.cache.getRelationships(entityName);
      mbody.innerHTML = '';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'qb-input';
      searchInput.placeholder = 'Filter\u2026';
      mbody.appendChild(searchInput);

      const sections = [
        {
          label: 'Many-to-One (N:1 \u2014 lookup from this entity)',
          items: rels.ManyToOne,
          joinType: 'ManyToOne',
          badge: 'N:1',
          getLabel: r => `${r.ReferencedEntity} via ${r.ReferencingAttribute}`,
          targetEntity: r => r.ReferencedEntity,
          from: r => r.ReferencingAttribute,
          to: r => r.ReferencedAttribute,
          navProp: r => r.ReferencedEntityNavigationPropertyName,
          linkType: 'inner',
        },
        {
          label: 'One-to-Many (1:N \u2014 child records referencing this entity)',
          items: rels.OneToMany,
          joinType: 'OneToMany',
          badge: '1:N',
          getLabel: r => `${r.ReferencingEntity} via ${r.ReferencingAttribute}`,
          targetEntity: r => r.ReferencingEntity,
          from: r => r.ReferencingAttribute,
          to: r => r.ReferencedAttribute,
          navProp: r => r.ReferencingEntityNavigationPropertyName,
          linkType: 'outer',
        },
        {
          label: 'Many-to-Many (N:N)',
          items: rels.ManyToMany,
          joinType: 'ManyToMany',
          badge: 'N:N',
          getLabel: r => {
            const other = r.Entity1LogicalName === entityName ? r.Entity2LogicalName : r.Entity1LogicalName;
            return `${other} via ${r.IntersectEntityName}`;
          },
          targetEntity: r => r.Entity1LogicalName === entityName ? r.Entity2LogicalName : r.Entity1LogicalName,
          from: r => r.Entity1LogicalName === entityName ? r.Entity1LogicalName + 'id' : r.Entity2LogicalName + 'id',
          to: r => entityName + 'id',
          navProp: r => r.SchemaName,
          linkType: 'inner',
        },
      ];

      const allItems = [];

      for (const sec of sections) {
        if (!sec.items.length) continue;

        const secEl = document.createElement('div');
        secEl.className = 'qb-rel-section';

        const secTitle = document.createElement('div');
        secTitle.className = 'qb-rel-section-title';
        secTitle.textContent = `${sec.label} (${sec.items.length})`;
        secEl.appendChild(secTitle);

        for (const rel of sec.items) {
          const item = document.createElement('div');
          item.className = 'qb-rel-item';
          item.dataset.search = (sec.getLabel(rel) + ' ' + rel.SchemaName).toLowerCase();

          const badge = document.createElement('span');
          badge.className = 'qb-rel-badge';
          badge.textContent = sec.badge;

          const lbl = document.createElement('span');
          lbl.className = 'qb-rel-label';
          lbl.textContent = sec.getLabel(rel);

          const schema = document.createElement('span');
          schema.className = 'qb-rel-schema';
          schema.textContent = rel.SchemaName;

          item.append(badge, lbl, schema);
          item.addEventListener('click', () => {
            const newLink = {
              name: sec.targetEntity(rel),
              from: sec.from(rel),
              to: sec.to(rel),
              linkType: sec.linkType,
              alias: `${sec.targetEntity(rel)}_${uid()}`.substring(0, 20),
              attributes: [],
              allAttributes: false,
              filters: { type: 'and', conditions: [], filters: [] },
              orders: [],
              linkEntities: [],
              _relMeta: {
                schemaName: rel.SchemaName,
                joinType: sec.joinType,
                navigationProp: sec.navProp(rel),
                displayLabel: sec.getLabel(rel),
              },
            };
            entityModel.linkEntities.push(newLink);
            this._loadAttributes(newLink.name);
            this._renderCards();
            this._debouncedSync();
            overlay.remove();
          });

          secEl.appendChild(item);
          allItems.push(item);
        }
        mbody.appendChild(secEl);
      }

      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        for (const item of allItems) {
          item.style.display = !q || item.dataset.search.includes(q) ? '' : 'none';
        }
      });

    } catch (err) {
      mbody.textContent = `Error loading relationships: ${err.message}`;
    }
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  _syncModelToRaw() {
    if (this._syncing || !this._rawTextarea) return;
    if (this._outputMode === 'fetchxml') {
      this._rawTextarea.value = prettifyXml(modelToXml(this.model));
      this._rawTextarea.readOnly = false;
    } else {
      const ent = this._entities.find(e => e.LogicalName === this.model.entity);
      const entitySetName = ent?.EntitySetName || (this.model.entity ? `${this.model.entity}s` : '');
      this._rawTextarea.value = entitySetName
        ? modelToOData(this.model, entitySetName)
        : '(no entity selected)';
      this._rawTextarea.readOnly = true;
    }
  }

  _syncRawToModel() {
    if (!this._rawTextarea || this._outputMode !== 'fetchxml') return;
    this._syncing = true;
    try {
      const { model, error } = xmlToModel(this._rawTextarea.value);
      if (model) {
        // Preserve _relMeta runtime fields
        const restoreMeta = (newLinks, oldLinks) => {
          for (const nl of newLinks) {
            const ol = oldLinks.find(l => l.name === nl.name && l.alias === nl.alias);
            if (ol?._relMeta) nl._relMeta = ol._relMeta;
            if (nl.linkEntities?.length && ol?.linkEntities?.length) {
              restoreMeta(nl.linkEntities, ol.linkEntities);
            }
          }
        };
        restoreMeta(model.linkEntities, this.model.linkEntities);
        this.model = model;
        if (this._entityInput) this._entityInput.value = model.entity;
        if (this._topInput) this._topInput.value = model.top || '';
        this._renderCards();
      } else {
        this._showNotification(`XML parse error: ${error}`, 'error');
      }
    } finally {
      this._syncing = false;
    }
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Check all filter conditions in a model for required-but-missing values.
   * Returns the first violation message, or null if valid.
   */
  _validateModel(model) {
    const checkGroup = (group) => {
      for (const cond of group.conditions || []) {
        const opDef = FETCH_OPERATORS.find(o => o.value === cond.operator);
        if (opDef?.requiresValue && !cond.value?.toString().trim()) {
          const attrLabel = cond.attribute || 'unknown attribute';
          return `Filter on "${attrLabel}": operator "${opDef.label}" requires a value.`;
        }
      }
      for (const sub of group.groups || []) {
        const err = checkGroup(sub);
        if (err) return err;
      }
      return null;
    };
    const rootErr = checkGroup(model.filters);
    if (rootErr) return rootErr;
    for (const le of model.linkEntities || []) {
      const leErr = checkGroup(le.filters);
      if (leErr) return `(linked ${le.name || le.entity}) ${leErr}`;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------

  async _executeQuery() {
    if (!this.model.entity) {
      this._showNotification('Select an entity first', 'warning');
      return;
    }
    const validationError = this._validateModel(this.model);
    if (validationError) {
      this._showNotification(validationError, 'error');
      return;
    }
    const ent = this._entities.find(e => e.LogicalName === this.model.entity);
    if (!ent?.EntitySetName) {
      this._showNotification('Entity set name unknown — try loading entities again', 'error');
      return;
    }

    if (this._execBtn) { this._execBtn.disabled = true; this._execBtn.textContent = '\u23F3 Running\u2026'; }
    const start = performance.now();

    try {
      const xml = modelToXml(this.model);
      const response = await this.api.request(
        'GET', `${ent.EntitySetName}?fetchXml=${encodeURIComponent(xml)}`
      );
      this._renderResults(response, Math.round(performance.now() - start));
    } catch (err) {
      this._showNotification(`Query failed: ${err.message}`, 'error');
    } finally {
      if (this._execBtn) { this._execBtn.disabled = false; this._execBtn.textContent = '\u25B6 Execute'; }
    }
  }

  _renderResults(data, elapsed) {
    const panel = this._resultsPanel;
    if (!panel) return;
    panel.style.display = '';
    panel.innerHTML = '';

    const records = data.value || (Array.isArray(data) ? data : []);

    const toolbar = document.createElement('div');
    toolbar.className = 'qb-results-toolbar';

    const countSpan = document.createElement('span');
    countSpan.className = 'qb-results-count';
    countSpan.textContent = `${records.length} record${records.length !== 1 ? 's' : ''}`;
    if (elapsed != null) countSpan.textContent += ` (${elapsed}ms)`;

    const copyBtn = this._createButton('Copy JSON', 'qb-btn qb-btn-xs qb-btn-outline', () =>
      this._copyToClipboard(JSON.stringify(records, null, 2)));
    toolbar.append(countSpan, copyBtn);
    panel.appendChild(toolbar);

    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'qb-results-empty';
      empty.textContent = 'No records returned.';
      panel.appendChild(empty);
      return;
    }

    const columns = Object.keys(records[0]).filter(k => !k.startsWith('@'));
    const wrap = document.createElement('div');
    wrap.className = 'qb-results-wrap';

    const table = document.createElement('table');
    table.className = 'qb-results-table';

    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      th.textContent = col;
      th.title = col;
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const rec of records) {
      const tr = document.createElement('tr');
      for (const col of columns) {
        const td = document.createElement('td');
        const val = rec[col];
        if (val === null || val === undefined) {
          td.className = 'qb-cell-null';
          td.textContent = 'null';
        } else if (typeof val === 'object') {
          td.textContent = JSON.stringify(val);
        } else {
          td.textContent = String(val);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    panel.appendChild(wrap);
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  async _loadEntities() {
    try {
      this._entities = await this.cache.getEntities();
    } catch (err) {
      this._showNotification(`Failed to load entities: ${err.message}`, 'error');
      this._entities = [];
    }
  }

  async _loadAttributes(entityName) {
    if (!entityName || this._attrCache.has(entityName)) return;
    try {
      const attrs = await this.cache.getAttributes(entityName);
      this._attrCache.set(entityName, attrs);
    } catch {
      this._attrCache.set(entityName, []);
    }
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  _createTypeBadge(attrType) {
    const badge = document.createElement('span');
    badge.className = 'qb-type-badge';
    badge.dataset.type = attrType;
    const map = {
      String: 'Str', Memo: 'Memo', Integer: 'Int', BigInt: 'BigInt',
      Decimal: 'Dec', Double: 'Dbl', Money: '$', DateTime: 'Date',
      Boolean: 'Bool', Picklist: 'List', Status: 'Status', State: 'State',
      Lookup: 'Lkp', Owner: 'Own', Customer: 'Cust', Uniqueidentifier: 'Guid',
    };
    badge.textContent = map[attrType] || attrType || '?';
    return badge;
  }

  _createButton(text, cls, onClick) {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  _showNotification(message, type = 'info') {
    const note = document.createElement('div');
    note.className = `qb-notification qb-notification-${type}`;
    note.textContent = message;
    note.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:10000;';
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 3500);
  }

  async _copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this._showNotification('Copied to clipboard', 'success');
    } catch (err) {
      this._showNotification(`Copy failed: ${err.message || 'check clipboard permissions'}`, 'error');
    }
  }
}

// ---------------------------------------------------------------------------
// Static exports
// ---------------------------------------------------------------------------

export { modelToXml, xmlToModel, prettifyXml, createEmptyModel, FETCH_OPERATORS, AGGREGATE_FUNCTIONS, TEMPLATE_QUERIES, modelToOData };

export default FetchXmlBuilder;

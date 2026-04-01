/**
 * cmt-xml-utils.js
 * Pure data-transformation utilities for Microsoft Configuration Migration Tool (CMT) XML format.
 * No DOM rendering, no side effects, no external dependencies.
 */

// ---------------------------------------------------------------------------
// XML helpers
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

function getAttr(el, name) {
  return el.getAttribute(name) ?? '';
}

// ---------------------------------------------------------------------------
// 1. parseCmtSchemaXml
// ---------------------------------------------------------------------------

/**
 * Parse a CMT data_schema.xml string into a structured array.
 * @param {string} xmlString
 * @returns {Array<{entity:string, displayName:string, fields:Array, keys:string[]}>}
 */
export function parseCmtSchemaXml(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) throw new Error('Invalid schema XML: ' + errorNode.textContent);

  const results = [];
  for (const entityEl of doc.querySelectorAll('entity')) {
    const fields = [];
    for (const f of entityEl.querySelectorAll('fields > field')) {
      const field = {
        name: getAttr(f, 'name'),
        displayName: getAttr(f, 'displayname'),
        type: getAttr(f, 'type'),
      };
      const lookupType = f.getAttribute('lookupType');
      if (lookupType) field.lookupType = lookupType;
      fields.push(field);
    }

    const keys = [];
    for (const k of entityEl.querySelectorAll('keys > key')) {
      keys.push(k.textContent.trim());
    }

    results.push({
      entity: getAttr(entityEl, 'name'),
      displayName: getAttr(entityEl, 'displayname'),
      fields,
      keys,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// 2. parseCmtDataXml
// ---------------------------------------------------------------------------

/**
 * Parse a CMT data.xml string into structured entity/record arrays.
 * Lookup field elements retain all attributes (value, lookupentity, lookupentityname).
 * Simple fields are stored as plain value strings.
 * @param {string} xmlString
 * @returns {Array<{entity:string, displayName:string, records:Array<{id:string, fields:Object}>}>}
 */
export function parseCmtDataXml(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');
  const errorNode = doc.querySelector('parsererror');
  if (errorNode) throw new Error('Invalid data XML: ' + errorNode.textContent);

  const results = [];
  for (const entityEl of doc.querySelectorAll('entity')) {
    const records = [];
    for (const recEl of entityEl.querySelectorAll('records > record')) {
      const fields = {};
      for (const f of recEl.querySelectorAll('field')) {
        const name = getAttr(f, 'name');
        const hasLookup = f.hasAttribute('lookupentity') || f.hasAttribute('lookupentityname');
        if (hasLookup) {
          const entry = { value: getAttr(f, 'value') };
          if (f.hasAttribute('lookupentity')) entry.lookupentity = getAttr(f, 'lookupentity');
          if (f.hasAttribute('lookupentityname')) entry.lookupentityname = getAttr(f, 'lookupentityname');
          fields[name] = entry;
        } else {
          fields[name] = getAttr(f, 'value');
        }
      }
      records.push({ id: getAttr(recEl, 'id'), fields });
    }
    results.push({
      entity: getAttr(entityEl, 'name'),
      displayName: getAttr(entityEl, 'displayname'),
      records,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// 3. generateCmtSchemaXml
// ---------------------------------------------------------------------------

const ATTR_TYPE_TO_CMT = {
  String: 'string',
  Memo: 'string',
  Integer: 'number',
  BigInt: 'number',
  Decimal: 'decimal',
  Double: 'decimal',
  Money: 'money',
  Boolean: 'bool',
  DateTime: 'datetime',
  Picklist: 'optionsetvalue',
  MultiSelectPicklist: 'optionsetvalue',
  State: 'state',
  Status: 'status',
  Lookup: 'entityreference',
  Owner: 'entityreference',
  Customer: 'entityreference',
  UniqueIdentifier: 'guid',
};

/**
 * Generate a CMT data_schema.xml string from Dataverse entity metadata.
 * @param {Array<{logicalName:string, displayName:string, primaryIdAttribute:string, primaryNameAttribute:string, attributes:Array}>} entities
 * @returns {string}
 */
export function generateCmtSchemaXml(entities) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<entities>'];

  for (const ent of entities) {
    lines.push(
      `  <entity name="${xmlEscape(ent.logicalName)}" displayname="${xmlEscape(ent.displayName)}" ` +
      `primaryidfield="${xmlEscape(ent.primaryIdAttribute)}" primarynamefield="${xmlEscape(ent.primaryNameAttribute)}">`
    );
    lines.push('    <fields>');

    for (const attr of ent.attributes) {
      const isPk = attr.logicalName === ent.primaryIdAttribute;
      let cmtType;
      if (isPk && (attr.attributeType === 'UniqueIdentifier' || attr.attributeType === 'Uniqueidentifier')) {
        cmtType = 'primarykey';
      } else {
        cmtType = ATTR_TYPE_TO_CMT[attr.attributeType] || 'string';
      }

      let fieldXml = `      <field name="${xmlEscape(attr.logicalName)}" displayname="${xmlEscape(attr.displayName)}" type="${xmlEscape(cmtType)}"`;

      if (cmtType === 'entityreference' && attr.lookupType) {
        fieldXml += ` lookupType="${xmlEscape(attr.lookupType)}"`;
      }

      fieldXml += ' />';
      lines.push(fieldXml);
    }

    lines.push('    </fields>');
    lines.push('  </entity>');
  }

  lines.push('</entities>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 4. generateCmtDataXml
// ---------------------------------------------------------------------------

/**
 * Generate a CMT data.xml string from Dataverse API response records.
 * @param {Array<{logicalName:string, displayName:string, records:Array<Object>, schema:Array<{name:string, type:string, lookupType?:string}>}>} entities
 * @returns {string}
 */
export function generateCmtDataXml(entities) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<entities>'];

  for (const ent of entities) {
    lines.push(`  <entity name="${xmlEscape(ent.logicalName)}" displayname="${xmlEscape(ent.displayName)}">`);
    lines.push('    <records>');

    const lookupFields = new Map();
    for (const s of ent.schema) {
      if (s.type === 'entityreference') lookupFields.set(s.name, s.lookupType || '');
    }

    for (const rec of ent.records) {
      const idField = ent.schema.find(s => s.type === 'primarykey');
      const recordId = idField ? (rec[idField.name] || '') : '';
      lines.push(`      <record id="${xmlEscape(recordId)}">`);

      for (const s of ent.schema) {
        if (s.type === 'primarykey') continue;

        if (lookupFields.has(s.name)) {
          const guid = rec[`_${s.name}_value`] ?? '';
          const target = s.lookupType || '';
          if (guid) {
            lines.push(`        <field name="${xmlEscape(s.name)}" value="${xmlEscape(guid)}" lookupentity="${xmlEscape(target)}" />`);
          }
        } else {
          const val = rec[s.name];
          if (val != null) {
            lines.push(`        <field name="${xmlEscape(s.name)}" value="${xmlEscape(String(val))}" />`);
          }
        }
      }

      lines.push('      </record>');
    }

    lines.push('    </records>');
    lines.push('  </entity>');
  }

  lines.push('</entities>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5. cmtRecordsToOperations
// ---------------------------------------------------------------------------

function coerceValue(raw, cmtType) {
  if (raw == null || raw === '') return null;
  switch (cmtType) {
    case 'number':
      return Number(raw);
    case 'decimal':
    case 'money':
      return Number(raw);
    case 'bool':
      return raw === 'true' || raw === '1' || raw === true;
    case 'state':
    case 'status':
    case 'optionsetvalue':
      return Number(raw);
    default:
      return raw;
  }
}

/**
 * Convert parsed CMT data + schema into Dataverse Web API operations for bulk execution.
 * @param {Array} parsedData        - output of parseCmtDataXml
 * @param {Array} schemaEntities    - output of parseCmtSchemaXml (for type info)
 * @param {Map<string,string>} entitySetMap - Map<logicalName, entitySetName>
 * @param {'upsert'|'create'} mode
 * @returns {Array<{method:string, url:string, headers?:Object, body:Object, description:string}>}
 */
export function cmtRecordsToOperations(parsedData, schemaEntities, entitySetMap, mode) {
  const schemaMap = new Map();
  for (const se of schemaEntities) {
    const fieldMap = new Map();
    for (const f of se.fields) fieldMap.set(f.name, f);
    schemaMap.set(se.entity, fieldMap);
  }

  const ops = [];

  for (const dataEntity of parsedData) {
    const entityName = dataEntity.entity;
    const entitySet = entitySetMap.get(entityName);
    if (!entitySet) continue;

    const fieldDefs = schemaMap.get(entityName);
    if (!fieldDefs) continue;

    for (const rec of dataEntity.records) {
      const body = {};
      const nameParts = [];

      for (const [fieldName, rawVal] of Object.entries(rec.fields)) {
        const def = fieldDefs.get(fieldName);
        if (!def || def.type === 'primarykey') continue;

        if (def.type === 'entityreference') {
          const lookupVal = typeof rawVal === 'object' ? rawVal : { value: rawVal };
          const guid = lookupVal.value;
          if (!guid) continue;

          const targetEntity = def.lookupType || lookupVal.lookupentity || '';
          const targetSet = entitySetMap.get(targetEntity);
          if (targetSet) {
            body[`${fieldName}@odata.bind`] = `/${targetSet}(${guid})`;
          }
        } else {
          const simpleVal = typeof rawVal === 'object' ? rawVal.value : rawVal;
          const coerced = coerceValue(simpleVal, def.type);
          if (coerced != null) {
            body[fieldName] = coerced;
            if (nameParts.length < 2) nameParts.push(`${fieldName}=${simpleVal}`);
          }
        }
      }

      const desc = `${mode} ${entityName} ${rec.id.substring(0, 8)}... (${nameParts.join(', ')})`;

      if (mode === 'upsert') {
        ops.push({
          method: 'PATCH',
          url: `${entitySet}(${rec.id})`,
          headers: { 'If-Match': '*' },
          body,
          description: desc,
        });
      } else {
        ops.push({
          method: 'POST',
          url: entitySet,
          body,
          description: desc,
        });
      }
    }
  }

  return ops;
}

// ---------------------------------------------------------------------------
// 6. Minimal zip utilities (browser-native, no external libs)
// ---------------------------------------------------------------------------

/**
 * Read a uint16 from a DataView in little-endian.
 */
function readU16(dv, offset) { return dv.getUint16(offset, true); }

/**
 * Read a uint32 from a DataView in little-endian.
 */
function readU32(dv, offset) { return dv.getUint32(offset, true); }

/**
 * Extract all text files from a zip ArrayBuffer.
 * Supports STORE (0) and DEFLATE (8) via DecompressionStream.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Map<string, string>>} filename -> text content
 */
export async function unzip(buffer) {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const result = new Map();

  // Locate End of Central Directory record (signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (readU32(dv, i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Invalid zip: EOCD not found');

  const cdEntries = readU16(dv, eocdOffset + 10);
  const cdOffset = readU32(dv, eocdOffset + 16);

  // Walk central directory entries (signature 0x02014b50)
  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (readU32(dv, pos) !== 0x02014b50) throw new Error('Invalid zip: bad CD entry');

    const compressionMethod = readU16(dv, pos + 10);
    const compressedSize = readU32(dv, pos + 20);
    const uncompressedSize = readU32(dv, pos + 24);
    const nameLen = readU16(dv, pos + 28);
    const extraLen = readU16(dv, pos + 30);
    const commentLen = readU16(dv, pos + 32);
    const localHeaderOffset = readU32(dv, pos + 42);

    const nameBytes = bytes.slice(pos + 46, pos + 46 + nameLen);
    const fileName = new TextDecoder().decode(nameBytes);

    // Advance past this CD entry
    pos += 46 + nameLen + extraLen + commentLen;

    // Skip directories
    if (fileName.endsWith('/')) continue;

    // Read local file header to find data start
    if (readU32(dv, localHeaderOffset) !== 0x04034b50) throw new Error('Invalid zip: bad local header');
    const localNameLen = readU16(dv, localHeaderOffset + 26);
    const localExtraLen = readU16(dv, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    let text;
    if (compressionMethod === 0) {
      // STORE
      text = new TextDecoder().decode(compressedData);
    } else if (compressionMethod === 8) {
      // DEFLATE — use DecompressionStream('deflate-raw')
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      const writePromise = writer.write(compressedData).then(() => writer.close());

      const chunks = [];
      let totalLen = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLen += value.length;
      }
      await writePromise;

      const decompressed = new Uint8Array(totalLen);
      let off = 0;
      for (const chunk of chunks) {
        decompressed.set(chunk, off);
        off += chunk.length;
      }
      text = new TextDecoder().decode(decompressed);
    } else {
      throw new Error(`Unsupported compression method ${compressionMethod} for ${fileName}`);
    }

    result.set(fileName, text);
  }

  return result;
}

/**
 * Create a minimal zip Blob from an array of files using STORE (no compression).
 * @param {Array<{name: string, content: string}>} files
 * @returns {Blob}
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const entries = files.map(f => ({
    name: encoder.encode(f.name),
    data: encoder.encode(f.content),
  }));

  // Calculate total size
  let localSize = 0;
  for (const e of entries) {
    localSize += 30 + e.name.length + e.data.length;
  }
  let cdSize = 0;
  for (const e of entries) {
    cdSize += 46 + e.name.length;
  }
  const eocdSize = 22;
  const totalSize = localSize + cdSize + eocdSize;

  const buf = new ArrayBuffer(totalSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let offset = 0;

  // CRC-32 lookup table
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const localOffsets = [];

  // Write local file headers + data
  for (const e of entries) {
    localOffsets.push(offset);
    const crc = crc32(e.data);

    dv.setUint32(offset, 0x04034b50, true); offset += 4;   // signature
    dv.setUint16(offset, 20, true); offset += 2;            // version needed
    dv.setUint16(offset, 0, true); offset += 2;             // flags
    dv.setUint16(offset, 0, true); offset += 2;             // compression: STORE
    dv.setUint16(offset, 0, true); offset += 2;             // mod time
    dv.setUint16(offset, 0, true); offset += 2;             // mod date
    dv.setUint32(offset, crc, true); offset += 4;           // crc-32
    dv.setUint32(offset, e.data.length, true); offset += 4; // compressed size
    dv.setUint32(offset, e.data.length, true); offset += 4; // uncompressed size
    dv.setUint16(offset, e.name.length, true); offset += 2; // name length
    dv.setUint16(offset, 0, true); offset += 2;             // extra length

    u8.set(e.name, offset); offset += e.name.length;
    u8.set(e.data, offset); offset += e.data.length;
  }

  // Write central directory
  const cdStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const crc = crc32(e.data);

    dv.setUint32(offset, 0x02014b50, true); offset += 4;   // signature
    dv.setUint16(offset, 20, true); offset += 2;            // version made by
    dv.setUint16(offset, 20, true); offset += 2;            // version needed
    dv.setUint16(offset, 0, true); offset += 2;             // flags
    dv.setUint16(offset, 0, true); offset += 2;             // compression: STORE
    dv.setUint16(offset, 0, true); offset += 2;             // mod time
    dv.setUint16(offset, 0, true); offset += 2;             // mod date
    dv.setUint32(offset, crc, true); offset += 4;           // crc-32
    dv.setUint32(offset, e.data.length, true); offset += 4; // compressed size
    dv.setUint32(offset, e.data.length, true); offset += 4; // uncompressed size
    dv.setUint16(offset, e.name.length, true); offset += 2; // name length
    dv.setUint16(offset, 0, true); offset += 2;             // extra length
    dv.setUint16(offset, 0, true); offset += 2;             // comment length
    dv.setUint16(offset, 0, true); offset += 2;             // disk number start
    dv.setUint16(offset, 0, true); offset += 2;             // internal attrs
    dv.setUint32(offset, 0, true); offset += 4;             // external attrs
    dv.setUint32(offset, localOffsets[i], true); offset += 4; // local header offset

    u8.set(e.name, offset); offset += e.name.length;
  }

  // Write EOCD
  const cdLength = offset - cdStart;
  dv.setUint32(offset, 0x06054b50, true); offset += 4;          // signature
  dv.setUint16(offset, 0, true); offset += 2;                   // disk number
  dv.setUint16(offset, 0, true); offset += 2;                   // disk with CD
  dv.setUint16(offset, entries.length, true); offset += 2;      // entries on disk
  dv.setUint16(offset, entries.length, true); offset += 2;      // total entries
  dv.setUint32(offset, cdLength, true); offset += 4;            // CD size
  dv.setUint32(offset, cdStart, true); offset += 4;             // CD offset
  dv.setUint16(offset, 0, true); offset += 2;                   // comment length

  return new Blob([buf], { type: 'application/zip' });
}

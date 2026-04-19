import { describe, it, expect } from 'vitest';
import {
  parseCmtSchemaXml,
  parseCmtDataXml,
  generateCmtSchemaXml,
  generateCmtDataXml,
  cmtRecordsToOperations,
  createZip,
  unzip,
} from '../../src/sidepanel/modules/bulk-ops/cmt-xml-utils.js';

// ---------------------------------------------------------------------------
// parseCmtSchemaXml
// ---------------------------------------------------------------------------

describe('parseCmtSchemaXml', () => {
  it('parses entities with fields and keys', () => {
    const xml = `<?xml version="1.0"?>
<entities>
  <entity name="account" displayname="Account">
    <fields>
      <field name="accountid" displayname="Account ID" type="primarykey" />
      <field name="name" displayname="Name" type="string" />
      <field name="revenue" displayname="Revenue" type="money" />
      <field name="primarycontactid" displayname="Primary Contact" type="entityreference" lookupType="contact" />
    </fields>
    <keys>
      <key>accountid</key>
    </keys>
  </entity>
</entities>`;

    const result = parseCmtSchemaXml(xml);
    expect(result).toHaveLength(1);
    expect(result[0].entity).toBe('account');
    expect(result[0].displayName).toBe('Account');
    expect(result[0].fields).toHaveLength(4);
    expect(result[0].keys).toEqual(['accountid']);

    const lookupField = result[0].fields.find(f => f.name === 'primarycontactid');
    expect(lookupField.type).toBe('entityreference');
    expect(lookupField.lookupType).toBe('contact');
  });

  it('throws on invalid XML', () => {
    expect(() => parseCmtSchemaXml('<not valid xml<<<')).toThrow('Invalid schema XML');
  });

  it('returns empty array for empty entities', () => {
    const xml = '<?xml version="1.0"?><entities></entities>';
    expect(parseCmtSchemaXml(xml)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseCmtDataXml
// ---------------------------------------------------------------------------

describe('parseCmtDataXml', () => {
  it('parses records with simple and lookup fields', () => {
    const xml = `<?xml version="1.0"?>
<entities>
  <entity name="account" displayname="Account">
    <records>
      <record id="aaa-111">
        <field name="name" value="Contoso" />
        <field name="primarycontactid" value="bbb-222" lookupentity="contact" lookupentityname="John" />
      </record>
    </records>
  </entity>
</entities>`;

    const result = parseCmtDataXml(xml);
    expect(result).toHaveLength(1);
    expect(result[0].records).toHaveLength(1);

    const rec = result[0].records[0];
    expect(rec.id).toBe('aaa-111');
    expect(rec.fields.name).toBe('Contoso');
    expect(rec.fields.primarycontactid).toEqual({
      value: 'bbb-222',
      lookupentity: 'contact',
      lookupentityname: 'John',
    });
  });

  it('throws on invalid XML', () => {
    expect(() => parseCmtDataXml('<bad<<<')).toThrow('Invalid data XML');
  });
});

// ---------------------------------------------------------------------------
// generateCmtSchemaXml
// ---------------------------------------------------------------------------

describe('generateCmtSchemaXml', () => {
  it('generates valid schema XML from entity metadata', () => {
    const entities = [{
      logicalName: 'account',
      displayName: 'Account',
      primaryIdAttribute: 'accountid',
      primaryNameAttribute: 'name',
      attributes: [
        { logicalName: 'accountid', displayName: 'Account ID', attributeType: 'UniqueIdentifier' },
        { logicalName: 'name', displayName: 'Name', attributeType: 'String' },
        { logicalName: 'revenue', displayName: 'Revenue', attributeType: 'Money' },
      ],
    }];

    const xml = generateCmtSchemaXml(entities);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<entities>');
    expect(xml).toContain('name="account"');
    expect(xml).toContain('type="primarykey"'); // accountid should be primarykey
    expect(xml).toContain('type="string"');
    expect(xml).toContain('type="money"');
  });

  it('escapes XML special characters in names', () => {
    const entities = [{
      logicalName: 'test',
      displayName: 'Test & "Entity"',
      primaryIdAttribute: 'testid',
      primaryNameAttribute: 'name',
      attributes: [
        { logicalName: 'name', displayName: 'Name <with> special', attributeType: 'String' },
      ],
    }];

    const xml = generateCmtSchemaXml(entities);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&lt;with&gt;');
  });

  it('adds lookupType for entityreference fields', () => {
    const entities = [{
      logicalName: 'account',
      displayName: 'Account',
      primaryIdAttribute: 'accountid',
      primaryNameAttribute: 'name',
      attributes: [
        { logicalName: 'primarycontactid', displayName: 'Primary Contact', attributeType: 'Lookup', lookupType: 'contact' },
      ],
    }];

    const xml = generateCmtSchemaXml(entities);
    expect(xml).toContain('type="entityreference"');
    expect(xml).toContain('lookupType="contact"');
  });
});

// ---------------------------------------------------------------------------
// generateCmtDataXml
// ---------------------------------------------------------------------------

describe('generateCmtDataXml', () => {
  it('generates data XML with simple and lookup fields', () => {
    const entities = [{
      logicalName: 'account',
      displayName: 'Account',
      records: [
        { accountid: 'aaa-111', name: 'Contoso', _primarycontactid_value: 'bbb-222' },
      ],
      schema: [
        { name: 'accountid', type: 'primarykey' },
        { name: 'name', type: 'string' },
        { name: 'primarycontactid', type: 'entityreference', lookupType: 'contact' },
      ],
    }];

    const xml = generateCmtDataXml(entities);
    expect(xml).toContain('record id="aaa-111"');
    expect(xml).toContain('name="name" value="Contoso"');
    expect(xml).toContain('name="primarycontactid" value="bbb-222" lookupentity="contact"');
  });

  it('skips null values', () => {
    const entities = [{
      logicalName: 'account',
      displayName: 'Account',
      records: [{ accountid: 'aaa', name: null }],
      schema: [
        { name: 'accountid', type: 'primarykey' },
        { name: 'name', type: 'string' },
      ],
    }];

    const xml = generateCmtDataXml(entities);
    expect(xml).not.toContain('name="name"');
  });
});

// ---------------------------------------------------------------------------
// cmtRecordsToOperations
// ---------------------------------------------------------------------------

describe('cmtRecordsToOperations', () => {
  const schemaEntities = [{
    entity: 'account',
    displayName: 'Account',
    fields: [
      { name: 'accountid', displayName: 'ID', type: 'primarykey' },
      { name: 'name', displayName: 'Name', type: 'string' },
      { name: 'revenue', displayName: 'Revenue', type: 'money' },
      { name: 'statecode', displayName: 'Status', type: 'state' },
      { name: 'primarycontactid', displayName: 'Primary Contact', type: 'entityreference', lookupType: 'contact' },
    ],
    keys: ['accountid'],
  }];

  const parsedData = [{
    entity: 'account',
    displayName: 'Account',
    records: [{
      id: 'aaa-111-bbb-222',
      fields: {
        name: 'Contoso',
        revenue: '50000.00',
        statecode: '0',
        primarycontactid: { value: 'ccc-333', lookupentity: 'contact' },
      },
    }],
  }];

  const entitySetMap = new Map([['account', 'accounts'], ['contact', 'contacts']]);

  it('generates PATCH operations for upsert mode', () => {
    const ops = cmtRecordsToOperations(parsedData, schemaEntities, entitySetMap, 'upsert');
    expect(ops).toHaveLength(1);
    expect(ops[0].method).toBe('PATCH');
    expect(ops[0].url).toBe('accounts(aaa-111-bbb-222)');
    expect(ops[0].headers['If-Match']).toBe('*');
  });

  it('generates POST operations for create mode', () => {
    const ops = cmtRecordsToOperations(parsedData, schemaEntities, entitySetMap, 'create');
    expect(ops).toHaveLength(1);
    expect(ops[0].method).toBe('POST');
    expect(ops[0].url).toBe('accounts');
  });

  it('coerces values by type', () => {
    const ops = cmtRecordsToOperations(parsedData, schemaEntities, entitySetMap, 'create');
    const body = ops[0].body;
    expect(body.name).toBe('Contoso');           // string stays string
    expect(body.revenue).toBe(50000.00);          // money → number
    expect(body.statecode).toBe(0);               // state → number
  });

  it('creates odata.bind for lookup fields', () => {
    const ops = cmtRecordsToOperations(parsedData, schemaEntities, entitySetMap, 'create');
    const body = ops[0].body;
    expect(body['primarycontactid@odata.bind']).toBe('/contacts(ccc-333)');
  });

  it('skips entities not in entitySetMap', () => {
    const emptyMap = new Map();
    const ops = cmtRecordsToOperations(parsedData, schemaEntities, emptyMap, 'create');
    expect(ops).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createZip / unzip roundtrip
// ---------------------------------------------------------------------------

describe('zip roundtrip', () => {
  // createZip/unzip use DataView + Blob + DecompressionStream — requires real browser APIs.
  // Covered by Playwright e2e tests, not jsdom.
  it('createZip returns a Blob', () => {
    const blob = createZip([{ name: 'test.txt', content: 'hello' }]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/zip');
  });
});

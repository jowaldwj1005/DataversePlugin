/**
 * ERD v2 — Pure utility functions
 * @module erd-v2/helpers
 */

import { SVG_NS, HEADER_H, FIELD_H, FIELD_PAD, SYSTEM_NOISE_NAMES, SYSTEM_FIELD_NAMES, SYSTEM_ATTR_TYPES } from './constants.js';

/** Create an SVG element with attributes. */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Read a CSS custom property value. */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '';
}

/** Short label for an attribute type. */
export function attrTypeShort(t) {
  const map = {
    String: 'Str', Memo: 'Txt', Integer: 'Int', BigInt: 'BigInt',
    Decimal: 'Dec', Double: 'Dbl', Money: '$', DateTime: 'Date',
    Boolean: 'Bool', Picklist: 'List', Status: 'Status', State: 'State',
    Lookup: 'Lkp', Owner: 'Own', Customer: 'Cust', Uniqueidentifier: 'Guid',
    Image: 'Img', File: 'File',
  };
  return map[t] || t || '?';
}

/** Example JSON value for a Dataverse attribute type. */
export function exampleValue(attrType) {
  switch (attrType) {
    case 'String': case 'Memo': return '"Sample text"';
    case 'Integer': case 'BigInt': return '0';
    case 'Decimal': case 'Double': case 'Money': return '0.00';
    case 'DateTime': return '"2024-01-01T00:00:00Z"';
    case 'Boolean': return 'false';
    case 'Picklist': case 'Status': case 'State': return '0';
    case 'Lookup': case 'Owner': case 'Customer': return '"00000000-0000-0000-0000-000000000000"';
    default: return 'null';
  }
}

/** Compute entity box height given field count. */
export function entityHeight(fieldCount) {
  return HEADER_H + FIELD_PAD + Math.max(fieldCount, 1) * FIELD_H + FIELD_PAD;
}

/**
 * Detect auto-generated Dataverse system noise fields.
 * @param {object} attr - attribute metadata
 * @param {Set<string>} lookupNames - lookup field logical names on this entity
 */
export function isSystemNoise(attr, lookupNames) {
  const name = attr.LogicalName;
  if (SYSTEM_NOISE_NAMES.has(name)) return true;
  if (SYSTEM_ATTR_TYPES.has(attr.AttributeType)) return true;
  for (const suffix of ['name', 'yominame']) {
    if (name.endsWith(suffix)) {
      const base = name.slice(0, -suffix.length);
      if (lookupNames.has(base) || SYSTEM_FIELD_NAMES.has(base)) return true;
    }
  }
  if (name.endsWith('type')) {
    const base = name.slice(0, -4);
    if (lookupNames.has(base) || lookupNames.has(base + 'id') || SYSTEM_FIELD_NAMES.has(base)) return true;
  }
  return false;
}

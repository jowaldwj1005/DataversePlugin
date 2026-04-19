/**
 * ERD v2 — Shared constants
 * @module erd-v2/constants
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Entity card dimensions ──────────────────────────────────────────────

export const ENTITY_W = 220;
export const HEADER_H = 42;
export const FIELD_H = 20;
export const FIELD_PAD = 6;
export const CORNER_R = 6;
export const MAX_KEY_FIELDS = 15;

// Zoom threshold: below this, field rows are hidden (header-only cards)
export const ZOOM_THRESHOLD_FIELDS = 0.5;

// ── Channel router ─────────────────────────────────────────────────────

export const STUB_LEN = 25;
export const LANE_STEP = 8;
export const PORT_MARGIN = 12;
export const ROUTE_MARGIN = 15;
export const PATH_CORNER_R = 5;
export const BUMP_R = 4;
export const MIN_CHANNEL = 40;

// Arrow color palette
export const ARROW_COLORS = [
  '#6bc5e8', '#a78bfa', '#f9a857', '#4ade80', '#f472b6',
  '#e879a0', '#60d5c4', '#c4b5fd', '#facc15', '#93c5fd',
  '#fb923c', '#86efac', '#d8b4fe', '#67e8f9', '#fca5a5',
];

// System fields — hidden by default, toggleable via dropdown
export const SYSTEM_FIELD_ENTRIES = [
  ['createdby', 'Created By'],
  ['modifiedby', 'Modified By'],
  ['createdonbehalfby', 'Created By (Delegate)'],
  ['modifiedonbehalfby', 'Modified By (Delegate)'],
  ['owningbusinessunit', 'Owning Business Unit'],
  ['owningteam', 'Owning Team'],
  ['owninguser', 'Owning User'],
  ['ownerid', 'Owner'],
  ['statecode', 'Status'],
  ['statuscode', 'Status Reason'],
  ['createdon', 'Created On'],
  ['modifiedon', 'Modified On'],
  ['versionnumber', 'Version Number'],
  ['importsequencenumber', 'Import Sequence Number'],
  ['overriddencreatedon', 'Record Created On'],
  ['timezoneruleversionnumber', 'TZ Rule Version'],
  ['utcconversiontimezonecode', 'UTC Offset'],
  ['transactioncurrencyid', 'Currency'],
  ['exchangerate', 'Exchange Rate'],
];
export const SYSTEM_FIELD_NAMES = new Set(SYSTEM_FIELD_ENTRIES.map(e => e[0]));

// Fields that are pure system noise — always excluded
export const SYSTEM_NOISE_NAMES = new Set([
  'organizationid', 'processid', 'stageid', 'traversedpath',
  'slaid', 'slainvokedid',
]);

// AttributeTypes that are never useful in a diagram
export const SYSTEM_ATTR_TYPES = new Set(['Virtual', 'EntityName']);

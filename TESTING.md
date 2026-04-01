# Testing Guide

Manual test checklist for the Dataverse Toolkit extension.
Run against a real Dynamics 365 / Power Platform environment.

## Setup

1. `chrome://extensions` → Load unpacked → select this folder
2. Navigate to any `*.dynamics.com` page and sign in
3. Click the extension icon → Open side panel
4. Status bar (bottom) should show your org URL and org name

---

## 1. Connection & Recovery

| # | Steps | Expected |
|---|-------|----------|
| 1.1 | Open side panel on a D365 page | Status bar: `Connected — https://orgX.crm.dynamics.com` |
| 1.2 | Open side panel on a non-D365 tab | Status bar: `Not connected`, welcome screen visible |
| 1.3 | Reload extension via `chrome://extensions`, switch back to D365 tab, open side panel | Reconnects without manual page reload |
| 1.4 | Leave D365 tab idle for 2 minutes, then execute a query | Still works (service worker restored from session storage) |

---

## 2. Explorer

| # | Steps | Expected |
|---|-------|----------|
| 2.1 | Click Explorer tab | Tables list loads with count badge (e.g. "350") |
| 2.2 | Expand `account` → Columns | Attribute list loads; `accountid` shown first (PK), `name` second |
| 2.3 | Click an attribute | Detail panel shows: Logical Name, Type, Required Level, Display Name |
| 2.4 | Expand `account` → Relationships → Many-to-One | Relationship list with schema names and target entities |
| 2.5 | Search box: type "cont" | Tree filters to contact, contactinvoices, etc. |
| 2.6 | Expand Solutions | Lists unmanaged solutions with version |
| 2.7 | Expand a solution | Shows entity list for that solution |
| 2.8 | Expand Actions (root node) | Shows custom actions (may be empty in clean org) |
| 2.9 | Expand a custom action | Shows Request Parameters and Response Properties sub-nodes |

---

## 3. FetchXML Builder

| # | Steps | Expected |
|---|-------|----------|
| 3.1 | Type "account" in entity picker | Autocomplete shows Account (account) |
| 3.2 | Select Account | Root card renders with column checkbox list |
| 3.3 | Check `name`, `statecode`, `createdon` | Columns selected; XML raw panel updates |
| 3.4 | Add filter: `statecode` `Equals` → value input should be a `<select>` with option labels | Picklist dropdown with Active / Inactive etc. |
| 3.5 | Add filter: `name` `Contains` (leave value empty) → click Execute | Validation error: "Filter on name: operator Contains requires a value" |
| 3.6 | Fill value → Execute | Results table appears with real records |
| 3.7 | Click `+ Add Related Table` on Account card | Modal shows N:1 / 1:N / N:N sections |
| 3.8 | Pick a contact N:1 relationship | Second card appears; raw XML has `<link-entity>` |
| 3.9 | Switch output to OData tab | Raw panel shows OData URL with `$select`, `$filter`, `$expand` |
| 3.10 | Add a sort row → drag ≡ handle to reorder | Sort order changes; XML updates |
| 3.11 | Code button → Power Automate | Modal shows FetchXML variable + HTTP action + Parse JSON with column-specific schema |
| 3.12 | Code button → C# | Modal shows FetchExpression snippet |
| 3.13 | Templates → "My Records" | Query pre-fills with ownerid eq-userid filter |

---

## 4. Request Builder

| # | Steps | Expected |
|---|-------|----------|
| 4.1 | Method: GET, Entity: `accounts`, `$top=3` → Send | 200 OK, JSON response body with 3 records |
| 4.2 | Switch method to POST | Record ID field disappears; Query Options section hides |
| 4.3 | Method GET, enter a record GUID in ID field | `$filter` input disables with tooltip |
| 4.4 | Send a valid GET with record ID | 200 OK, single record JSON |
| 4.5 | Code button → cURL | Shows curl command with correct headers |

---

## 5. Bulk Operations

| # | Steps | Expected |
|---|-------|----------|
| 5.1 | Click "Show example" | Expandable JSON example appears showing Metadata API operations (EntityDefinitions + Attributes) |
| 5.2 | Paste the example JSON → click "Load Operations" | Operations appear in Standalone Operations list; header shows count |
| 5.3 | Click "+ Add Operation" → fill Method=POST, URL=accounts, Body=`{"name":"Test"}` | Operation card appears in Standalone Operations |
| 5.4 | Click "+ ChangeSet" | ChangeSet 1 section appears with a colored label and "0 ops" badge |
| 5.5 | Drag a standalone operation into the ChangeSet drop zone | Operation moves into ChangeSet; count updates |
| 5.6 | Paste invalid JSON in the input area → click "Load Operations" | Inline validation error shown, list unchanged |
| 5.7 | Click "Import CSV" → paste CSV rows | Operations loaded from CSV into the list |
| 5.8 | Execution Settings: set Batch size=50, Throttle=200, check "Continue on error" | Settings saved |
| 5.9 | Click "Execute All" against real org | Results summary shows succeeded/failed/skipped counts; each operation card shows status badge |
| 5.10 | After execution, click on a failed operation's Edit button | "Last Result" section shows response JSON |
| 5.11 | Click Export → CSV | Downloaded CSV with columns: method, url, description, status, responseStatus, responseBody |
| 5.12 | Click "Clear All" | All operations removed, counter resets to 0 |

---

## 6. Security Inspector

| # | Steps | Expected |
|---|-------|----------|
| 6.1 | Entity Privileges tab → select Account | Privilege matrix loads with all roles |
| 6.2 | Find "System Administrator" row | Shows `Org` level for Create, Read, Write, Delete, etc. (not `--`) |
| 6.3 | Click a role name | Detail panel: all privileges for that role |
| 6.4 | User Permissions tab → search your own name | Shows roles, teams, effective permissions table grouped by entity |
| 6.5 | Field Security tab → select an entity | Shows field security profiles and their permissions per attribute |

---

## 7. ERD Viewer

| # | Steps | Expected |
|---|-------|----------|
| 7.1 | Select a solution → Load ERD | SVG diagram renders with entity boxes and arrows |
| 7.2 | Scroll / pinch to zoom | Pan and zoom work |
| 7.3 | Hover over an arrow | Tooltip shows: schema name + entity pair + referenced attribute |
| 7.4 | Click an entity box | Detail panel opens with attribute table (name, type, required) |
| 7.5 | With entity selected → Export Schema | Clipboard contains valid JSON Schema draft-07 with `$schema`, `definitions`, `format: uuid` on lookup fields |
| 7.6 | With entity selected → Export Payload | Clipboard contains example POST body (required + recommended fields, not just required) |
| 7.7 | No entity selected → Export Schema | Exports schema for all loaded entities |

---

## 8. Settings

| # | Steps | Expected |
|---|-------|----------|
| 8.1 | Change theme to Light → Save | Theme applies immediately; status bar visible |
| 8.2 | Reload extension, reopen side panel | Light theme still active (persisted to `chrome.storage.local`) |
| 8.3 | Change cache TTL to 1 minute → Save → go to Explorer | After 1 minute, entity list reloads from API (not cache) |
| 8.4 | Clear Metadata Cache | Toast: "Metadata cache cleared" |
| 8.5 | Reset to Defaults | Settings revert to dark theme, 60-minute TTL, page size 50 |

---

## Edge cases worth testing manually

- **Large org** (500+ entities): Explorer virtual scroll stays smooth, no freezing
- **Org with no custom solutions**: Solutions node shows "(no entities)" gracefully
- **FetchXML N:N**: Add N:N join → switch to OData → raw panel shows warning comment, not broken URL
- **Bulk Ops with metadata ops**: POST `EntityDefinitions` + POST `EntityDefinitions(LogicalName='x')/Attributes` in sequence — verify table + column actually created

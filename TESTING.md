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

## 8. AI Customizer

### Prerequisites
Configure AI provider in Settings: Provider, Endpoint URL, API Key, Model.

| # | Steps | Expected |
|---|-------|----------|
| 8.1 | Open AI tab without config | "Configure your AI provider in Settings" message |
| 8.2 | Configure Azure OpenAI in Settings → switch to AI tab | Entity search, Type/View dropdowns, status dot shows "azure · model" |
| 8.3 | Search entity "account" | Dropdown shows matching entities, click selects |
| 8.4 | Select a system view | Debug console logs "[META] View selected" with XML details |

### View Modification

| # | Steps | Expected |
|---|-------|----------|
| 8.5 | Prompt: "add email, phone, and owner columns" → Send | Agent timeline: Analyzed → Generated → Validated. Diff shows +lines |
| 8.6 | Check diff: fetchxml has real attribute names, no `*name` suffixes | Correct: `<attribute name="ownerid"/>`, NOT `owneridname` |
| 8.7 | Check diff: layoutxml cells for lookups use attribute name as-is | Correct: `<cell name="ownerid"/>`, NOT `<cell name="owneridname"/>` |
| 8.8 | Check diff: statecodename/statuscodename are the only `*name` cells | Only exception for state/status fields |
| 8.9 | Click "Apply & Publish" | Status: "✓ Applied & Published". Diff collapses. Debug console shows PATCH → Publish → Verify |
| 8.10 | Hard-reload D365 page (Ctrl+Shift+R) | View shows new columns with data |

### Stateful Follow-up

| # | Steps | Expected |
|---|-------|----------|
| 8.11 | After 8.9, prompt: "add createdby too" | Agent uses UPDATED view as baseline (includes changes from 8.9) |
| 8.12 | Diff shows only +1 (createdby), not re-adding previous columns | Previous columns preserved in baseline |
| 8.13 | Apply & Publish → hard-reload | Both sets of changes visible |

### Link-Entity (Related Entity Fields)

| # | Steps | Expected |
|---|-------|----------|
| 8.14 | Prompt: "show the thread's status and agent" (on entity with lookup) | Agent requests related entity metadata → timeline shows tool call |
| 8.15 | Check fetchxml: link-entity has `alias="a_<hex>"`, `visible="false"` | Correct alias format and attributes |
| 8.16 | Check layoutxml: link-entity cells use `alias.attributename`, NO `*name` suffix | Correct: `a_xxx.jw_status`, NOT `a_xxx.jw_statusname` |
| 8.17 | Check: no nested link-entities | All link-entities are direct children of `<entity>` |

### Agent Questions

| # | Steps | Expected |
|---|-------|----------|
| 8.18 | Prompt: "optimize this view" | Agent may ask a clarifying question in the timeline |
| 8.19 | Answer the question via inline input → press Enter | Agent continues, generates XML based on answer |

### New View Creation

| # | Steps | Expected |
|---|-------|----------|
| 8.20 | Click "+New" next to view dropdown | Name input appears, view dropdown hides |
| 8.21 | Enter name, prompt: "create a view with all important fields" | Agent generates full view XML from blank baseline |
| 8.22 | Apply & Publish → hard-reload | New view appears in D365 view selector |

### Validation

| # | Steps | Expected |
|---|-------|----------|
| 8.23 | If AI generates `*name` attribute in fetchxml | Validation blocks Apply with error message |
| 8.24 | If AI generates duplicate cells in layoutxml | Validation blocks Apply with error message |
| 8.25 | If AI generates nested link-entity | Validation blocks Apply with error message |

### Debug Console

| # | Steps | Expected |
|---|-------|----------|
| 8.26 | Expand debug console (click header) | Shows [META], [SEND], [RECV] entries with timestamps |
| 8.27 | Click ▶ on a [SEND] entry | Expands to show full request payload |
| 8.28 | Filter buttons: Prompts / API / Errors | Filters log entries by tag |
| 8.29 | "System Prompt" button → edit → "Use Custom" | Next request uses custom prompt |
| 8.30 | Clear button | Clears log, timeline, and aborts running agent |

---

## 9. Settings

| # | Steps | Expected |
|---|-------|----------|
| 9.1 | Change theme to Light → Save | Theme applies immediately; status bar visible |
| 9.2 | Reload extension, reopen side panel | Light theme still active (persisted to `chrome.storage.local`) |
| 9.3 | Change cache TTL to 1 minute → Save → go to Explorer | After 1 minute, entity list reloads from API (not cache) |
| 9.4 | Clear Metadata Cache | Toast: "Metadata cache cleared" |
| 9.5 | Reset to Defaults | Settings revert to dark theme, 60-minute TTL, page size 50 |
| 9.6 | Configure AI Provider (Azure OpenAI) → Save | Endpoint preview shows resulting URL. Settings persisted. |
| 9.7 | Configure AI Provider (Anthropic) → Save | Endpoint preview shows `/messages` URL with `x-api-key` header |

---

## Bulk Operations — Sample JSONs

### Create Accounts

```json
[
  { "method": "POST", "url": "accounts", "body": { "name": "BulkTest Alpha", "emailaddress1": "alpha@bulktest.invalid" } },
  { "method": "POST", "url": "accounts", "body": { "name": "BulkTest Beta",  "emailaddress1": "beta@bulktest.invalid"  } },
  { "method": "POST", "url": "accounts", "body": { "name": "BulkTest Gamma", "emailaddress1": "gamma@bulktest.invalid" } }
]
```

Note the GUIDs from the `OData-EntityId` response headers — needed for PATCH/DELETE below.

### Create Contacts

```json
[
  { "method": "POST", "url": "contacts", "body": { "firstname": "Bulk", "lastname": "Alpha", "emailaddress1": "c.alpha@bulktest.invalid" } },
  { "method": "POST", "url": "contacts", "body": { "firstname": "Bulk", "lastname": "Beta",  "emailaddress1": "c.beta@bulktest.invalid"  } }
]
```

### Deactivate Accounts (replace GUIDs)

```json
[
  { "method": "PATCH", "url": "accounts(00000000-0000-0000-0000-000000000001)", "body": { "statecode": 1, "statuscode": 2 } },
  { "method": "PATCH", "url": "accounts(00000000-0000-0000-0000-000000000002)", "body": { "statecode": 1, "statuscode": 2 } },
  { "method": "PATCH", "url": "accounts(00000000-0000-0000-0000-000000000003)", "body": { "statecode": 1, "statuscode": 2 } }
]
```

### Deactivate Contacts (replace GUIDs)

```json
[
  { "method": "PATCH", "url": "contacts(00000000-0000-0000-0000-000000000001)", "body": { "statecode": 1, "statuscode": 2 } },
  { "method": "PATCH", "url": "contacts(00000000-0000-0000-0000-000000000002)", "body": { "statecode": 1, "statuscode": 2 } }
]
```

### Delete cleanup

```json
[
  { "method": "DELETE", "url": "accounts(00000000-0000-0000-0000-000000000001)", "body": null },
  { "method": "DELETE", "url": "accounts(00000000-0000-0000-0000-000000000002)", "body": null },
  { "method": "DELETE", "url": "contacts(00000000-0000-0000-0000-000000000001)", "body": null }
]
```

---

## Edge cases worth testing manually

- **Large org** (500+ entities): Explorer virtual scroll stays smooth, no freezing
- **Org with no custom solutions**: Solutions node shows "(no entities)" gracefully
- **FetchXML N:N**: Add N:N join → switch to OData → raw panel shows warning comment, not broken URL
- **Bulk Ops with metadata ops**: POST `EntityDefinitions` + POST `EntityDefinitions(LogicalName='x')/Attributes` in sequence — verify table + column actually created

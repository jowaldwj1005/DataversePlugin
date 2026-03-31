# Dataverse Toolkit – Backlog

## Recently Fixed (this session)
- [x] Manifest trailing comma (JSON parse error)
- [x] `response.data || response` / `response.success` anti-pattern → all modules now use unwrapped data from `api-client.request()`
- [x] `api-client.requestRaw()` added for request-builder + bulk-ops (need status/headers)
- [x] Service worker `activeEnv` not restored after idle kill → restored from `chrome.storage.session`
- [x] Content script orphan after extension reload → re-inject via `chrome.scripting` API on demand + `onInstalled`
- [x] Security tab: `roleprivileges_association` / `roleprivilegesdepthmask` both unreliable → switched to `RetrieveRolePrivilegesRole(RoleId=@p)` function
- [x] `MaxLength`/`MinValue` etc. removed from base `/Attributes` `$select` (type-specific, not on base type)
- [x] RecordViewer stale record reference on inline cell save → resolved from live `_records` by PK
- [x] FetchXML builder: `_validateModel()` added → validates required-but-empty filter values before execute/copy
- [x] FetchXML builder: canvas `max-height: 55vh` clipped results panel → switched to single scrollable column, sticky toolbar
- [x] Request Builder: smart method constraints (POST hides ID/QueryOptions, record ID disables $filter)
- [x] Bulk Ops: JSON paste panel as primary entry point with inline metadata API example
- [x] `privilegedepthmask` null guard in security inspector

## Recently Fixed
- [x] Power Automate code generation from visual model → HTTP action + Parse JSON schema block (attrs from cache → itemProperties per selected column; FetchXML stored as variable; steps commented)
- [x] Code gen dropdown added to FetchXML toolbar: C# / JavaScript / Power Automate → shows modal with copy button
- [x] ERD `_loadSolution`: removed stale `compResp.data || compResp` wrapper
- [x] ERD relationship arrows: `<title>` tooltip with SchemaName + entity names + ReferencedAttribute; dashed/dotted style per rel type
- [x] Settings tab: already persisted to `chrome.storage.local` — verified done

## Planned – Next Priority

### FetchXML Builder
- [ ] OData output: verify/fix `$expand` for N:N relationships (navigationProp may be missing)
- [ ] "Add sort" drag handle UX

### Security Tab
- [x] User Permissions: `_computeEffectivePermissions` now uses `RetrieveUserPrivileges(UserId=@p)?@p={guid}` → parses `prvCreateAccount` names → groups by entity with max depth per privilege
- [x] Field Security: switched to direct nav prop `systemusers(id)/systemuserprofiles_association` (avoids unreliable N:N expand-with-filter)

### ERD Viewer
- [x] Export Schema: outputs proper JSON Schema draft-07 (`$schema`, `definitions`, `x-dataverse-type`, `format: uuid/date-time`)
- [x] Export Payload: now includes all required + non-custom recommended fields (not just required)

### Explorer
- [x] Actions / Functions nodes: load `customapis` + parameters via `customapirequestparameters` / `customapiresponseproperties`; detail panel shows type + binding
- [x] Solutions node: expandable → loads entities via `solutioncomponents?componenttype eq 1` matched against entity list

### General
- [ ] Icons (16x16, 48x48, 128x128) — extension shows default icon

## Known API Constraints
- `$orderby` not supported on metadata endpoints → sort client-side
- `$select` on `/Attributes` (base type only): no MaxLength, MinValue, OptionSet, etc. → use type-cast URL for those
- Role privileges: use `RetrieveRolePrivilegesRole(RoleId=@p)?@p={guid}` → returns `RolePrivileges[].Depth` as string
- `$batch` response is `multipart/mixed` — parse boundary from Content-Type header

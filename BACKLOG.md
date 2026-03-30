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

## Planned – Next Priority

### FetchXML Builder
- [ ] Power Automate code generation from visual model → HTTP action + Parse JSON schema block
- [ ] OData output: verify/fix `$expand` for N:N relationships (navigationProp may be missing)
- [ ] "Add sort" drag handle UX

### Security Tab
- [ ] User Permissions tab: test with real user → verify `RetrieveUserPrivileges` result shape
- [ ] Field Security tab: verify `fieldsecurityprofile` + `fieldpermission` queries work

### ERD Viewer
- [ ] Relationship arrows: hover tooltip with schema name
- [ ] Export Schema: JSON Schema draft-07 format per entity
- [ ] Export Payload: example POST body with placeholder values per attribute type

### Explorer
- [ ] Actions / Functions nodes: load parameters and show in detail panel
- [ ] Solutions node: load entities in solution via `solutioncomponents`

### General
- [ ] Icons (16x16, 48x48, 128x128) — extension shows default icon
- [ ] Settings tab: persist theme, cache TTL, default page size to `chrome.storage.local`
- [ ] Code generation (FetchXML → Power Automate) from model not XML

## Known API Constraints
- `$orderby` not supported on metadata endpoints → sort client-side
- `$select` on `/Attributes` (base type only): no MaxLength, MinValue, OptionSet, etc. → use type-cast URL for those
- Role privileges: use `RetrieveRolePrivilegesRole(RoleId=@p)?@p={guid}` → returns `RolePrivileges[].Depth` as string
- `$batch` response is `multipart/mixed` — parse boundary from Content-Type header

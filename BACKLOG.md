# Dataverse Toolkit — Backlog

## Future features

- [ ] Import / export saved queries and request collections (JSON file)
- [ ] Chrome Web Store listing: screenshots, store description, privacy policy
- [ ] Explorer: Forms and Views nodes (currently "Coming soon")
- [ ] FetchXML: aggregate mode UI (count, sum, avg, group-by columns)
- [ ] Request Builder: save/restore named request collections (alongside history)
- [ ] ERD: auto-fit layout (force-directed instead of grid, for dense solutions)

## Known API constraints (for reference)

- `$orderby` rejected on all metadata endpoints → sort client-side
- `$select` on `/Attributes` base URL: only base `AttributeMetadata` fields; type-specific need type-cast URL
- Role/user privilege depth: use `RetrieveRolePrivilegesRole` / `RetrieveUserPrivileges` — nav properties are unreliable
- `$batch` response is `multipart/mixed` — parse boundary from Content-Type header
- N:N `$expand` not supported in OData v4 → use FetchXML for N:N joins
- Custom APIs: in `customapis` entity, parameters in `customapirequestparameters` / `customapiresponseproperties`

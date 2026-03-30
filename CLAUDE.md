# Dataverse Toolkit - Chrome Extension

## Project Overview
A professional Chrome Extension (Manifest V3) for Dynamics 365 / Power Platform developers. Provides a comprehensive Dataverse Web API explorer, FetchXML builder, request builder, bulk operations, and security inspector - all running standalone in the browser with zero backend dependencies.

## Architecture

### Extension Components
- **Side Panel** (`src/sidepanel/`) - Main workspace with 7 tabs: Explorer, FetchXML, Request, Bulk Ops, Security, ERD, Settings
- **Background Service Worker** (`src/background/service-worker.js`) - Message router, API proxy (bypasses CORS), auth token management, metadata caching
- **Content Script** (`src/content/content-script.js`) - Injects into Dynamics 365 pages to extract auth tokens and environment info via Xrm global context
- **Popup** (`src/popup/`) - Quick actions and connection status
- **DevTools Panel** (`src/devtools/`) - Dataverse API request logger in Chrome DevTools

### Data Flow
```
Dynamics 365 Page → Content Script (extracts token) → Background Worker (stores token)
Side Panel Module → Background Worker (API_REQUEST) → Dataverse Web API → Background Worker → Side Panel
```

### Key Design Decisions
- **No build system** - Pure ES modules, no bundler, no transpilation. Chrome Extensions with Manifest V3 support ES modules natively.
- **No external dependencies** - Everything is custom-built (code editor, tree view, grid, etc.) to keep the extension lightweight and avoid supply chain risk.
- **Auth via content script injection** - The content script injects a page-level script to access `Xrm.Utility.getGlobalContext()` and relays the token via `window.postMessage` → content script → background worker.
- **All API calls go through background worker** - Side panel can't call Dataverse directly (CORS). The background worker proxies all requests with proper auth headers.
- **Metadata caching** - Entity/attribute/relationship metadata cached in `chrome.storage.local` with 1-hour TTL, namespaced per environment.

## File Structure
```
manifest.json                          # Manifest V3 config
src/
  background/service-worker.js         # Message router, API proxy, cache
  content/content-script.js            # Token extraction from Dynamics pages
  shared/
    api-client.js                      # DataverseClient class + QueryBuilder
    metadata-cache.js                  # MetadataCache with TTL + events
  sidepanel/
    index.html                         # Main UI shell with SVG sprite sheet
    app.js                             # DataverseToolkit bootstrap class
    styles/
      main.css                         # Layout, base styles, scrollbars
      components.css                   # All UI components (tree, grid, editor, etc.)
      themes.css                       # Dark/Light/High-contrast themes
    modules/
      api-explorer.js                  # Tree-view schema browser with virtual scroll
      record-viewer.js                 # Data grid with inline editing + CRUD
      detail-panel.js                  # Property grid for metadata display
      fetchxml-builder.js              # Visual builder + raw XML editor
      request-builder.js               # HTTP request builder + response viewer
      bulk-operations.js               # Batch request builder with drag-and-drop
      security-inspector.js            # Roles, privileges, field security
      code-editor.js                   # Lightweight syntax-highlighted editor
  popup/
    popup.html, popup.js, popup.css    # Extension popup
  devtools/
    devtools.html, devtools.js         # DevTools page entry
    panel.html, panel.js, panel.css    # Dataverse network logger panel
icons/                                 # Extension icons (TODO)
```

## Module Pattern
All side panel modules follow the same constructor pattern:
```js
class ModuleName {
  constructor(container, apiClient, metadataCache) { ... }
  render() { ... }  // Initial DOM setup
  destroy() { ... } // Cleanup
}
```

## Message Types (Background Worker Communication)
All inter-component communication uses `chrome.runtime.sendMessage` with these types:
- `GET_TOKEN` / `SET_TOKEN` - Auth token management
- `GET_ENV` - Current environment info
- `API_REQUEST` - Proxy a Web API call (method, url, headers, body)
- `CLEAR_CACHE` / `GET_METADATA_CACHE` / `SET_METADATA_CACHE` - Metadata cache ops

## Coding Conventions
- Pure JavaScript ES2022+ (no TypeScript, no JSX)
- ES module imports/exports throughout
- Private class fields with `#` prefix
- JSDoc comments on public methods
- CSS custom properties (`--dvt-*` prefix) for all theme-dependent values
- BEM-like CSS class naming
- No external dependencies - everything built from scratch
- Dark theme (VS Code Dark+) as default

## Dataverse Web API Reference
- Base URL: `https://{org}.crm.dynamics.com/api/data/v9.2/`
- Auth: **Cookie-based** via page-extractor.js proxy (MAIN world, same-origin). No Bearer token.
- Metadata: `EntityDefinitions`, `EntityDefinitions(LogicalName='x')/Attributes`
- FetchXML: `GET {entitySet}?fetchXml={encoded}`
- Batch: `POST $batch` with `multipart/mixed` body
- Common headers: `OData-Version: 4.0`, `Prefer: odata.include-annotations="*"`

### Critical API constraints
- **`api-client.request()` returns unwrapped data directly** — never check `response.success/ok`, never do `response.data || response`. The method throws on failure.
- **`$select` on `/Attributes`** — only base `AttributeMetadata` properties. Type-specific ones (`MaxLength`, `MinValue`, `OptionSet`, etc.) need a type-cast URL like `/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata`.
- **`$orderby` on metadata endpoints is not supported** — sort client-side.
- **Role privilege depth** — use `RetrieveRolePrivilegesRole(RoleId=@p)?@p={guid}`. Returns `{ RolePrivileges: [{ PrivilegeId, PrivilegeName, Depth: "Basic"|"Local"|"Deep"|"Global" }] }`. Neither `roleprivileges_association` nor `roleprivilegesdepthmask` return usable depth data.
- **MV3 service worker killed when idle** — always restore `activeEnv` from `chrome.storage.session` at start of each `proxyApiRequest`.
- **Content scripts orphaned after extension reload** — re-inject via `chrome.scripting.executeScript()` on demand.

See `skills/` folder for detailed guidance.

## Development
1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select this project directory
4. Navigate to any Dynamics 365 / Power Platform environment
5. The extension auto-detects the environment and extracts auth tokens
6. Click the extension icon or open the side panel to start using

## TODO
- [ ] Create extension icons (16x16, 48x48, 128x128)
- [ ] Test all modules end-to-end against a real Dataverse environment
- [ ] Add import/export for saved queries and request collections
- [ ] Chrome Web Store listing assets (screenshots, description)
- [ ] Consider BYOK (Bring Your Own Key) for AI features in future

# Skill: Architecture Decisions

Why things are built the way they are.

## Auth: Cookie-based via page proxy, not Bearer token

All API calls flow: Side Panel → Background SW → content-script.js (ISOLATED) → page-extractor.js (MAIN world) → `fetch()` with `credentials: 'same-origin'`.

**Why**: The side panel and background SW run at `chrome-extension://` origin → CORS blocks all Dataverse calls. The MAIN world script runs at `https://orgX.crm.dynamics.com` origin → session cookies work automatically, no token needed.

`Xrm.getAuthToken()` was considered but is unreliable since 2022 (MSAL manages tokens internally).

## All modules receive `(container, apiClient, metadataCache)`

Every side panel module follows the same constructor signature. `apiClient` is a `DataverseClient` instance. `metadataCache` is the `MetadataCache` instance from `app.js` (not from `shared/metadata-cache.js` — that file exists but app.js has its own inline MetadataCache with direct `_apiClient.request()` calls).

## Two MetadataCache implementations — only use app.js one

`src/shared/metadata-cache.js` exists but routes through `chrome.runtime.sendMessage` → background SW → API. The inline `MetadataCache` class in `app.js` calls `_apiClient.request()` directly (which itself goes SW → proxy). Use `this.cache` (the app.js one) in all modules.

## FetchXML Builder is the primary query UI

The node-card canvas (`FetchXmlBuilder`) is the source of truth for queries:
- `model` → `modelToXml()` → FetchXML string
- `model` → `modelToOData()` → OData v4 URL
- `model` → `generateCSharp()`, `generateJavaScript()`, `generatePowerAutomate()` → code

Code generation should always work from the model, not by parsing the raw textarea.

## Request Builder scope

The Request Builder is for raw HTTP requests: one-off API calls, testing endpoints, crafting POST/PATCH bodies. It is NOT a query builder — for querying data, use the FetchXML builder. Keep it lean: method selector, URL input, headers editor, body editor. No OData assist needed here.

## Bulk Operations scope

Not a visual batch builder — too complex and confusing. Instead: paste a JSON array of operations, the extension assembles the `$batch` multipart body and sends it. Each operation: `{ method, url, body? }`. URL is relative to the API base (e.g. `accounts` or `accounts(guid)`).

## No build system, no dependencies

Pure ES2022 modules, no bundler. Chrome MV3 supports ES modules natively in service workers and side panels. Zero external dependencies keeps the extension lightweight and avoids supply chain risk.

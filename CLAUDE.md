# Dataverse Toolkit — Project Guide

Chrome Extension (Manifest V3) for Dynamics 365 / Power Platform developers.
Side panel workspace with zero backend dependencies, no build step, no external libraries.

---

## Architecture

```
Dynamics 365 page (*.dynamics.com)
  └─ content-script.js  (ISOLATED world)   — listens for MAIN world messages
       └─ page-extractor.js  (MAIN world)  — runs at org origin, has session cookies
                                             calls fetch() with credentials:same-origin

Side Panel  ──────────────────────────────────────────────────────────────────┐
  app.js (bootstrap, tab routing, MetadataCache)                              │
  modules/  (one class per tab, lazy-loaded)                                  │
     └─ apiClient.request() ─→ chrome.runtime.sendMessage(API_REQUEST)        │
                                        │                                      │
Background Service Worker ─────────────┘                                      │
  proxyApiRequest() ─→ sendMessage to tab content script                      │
                           └─→ page-extractor.js fetch() ─→ Dataverse Web API │
                                                              response back   ─┘
```

**Why this routing**: The side panel (`chrome-extension://`) origin is CORS-blocked from all `*.dynamics.com` endpoints. The MAIN world page-extractor runs at the same origin as the page, so session cookies work automatically — no Bearer token needed.

---

## Module pattern

Every side panel module:

```js
export class MyModule {
  constructor(container, apiClient, metadataCache) { ... }
  render()   { ... }   // called each time tab becomes active; builds DOM from scratch
  destroy()  { ... }   // optional cleanup (timers, global listeners)
  onHide()   { ... }   // optional; called on tab switch without destroying module

  // Module Bridge integration (optional — enables AI agent orchestration)
  setContext(ctx) { ... }  // receive context from agent or tab switch
  getContext()    { ... }  // expose current state to agent
}
```

`apiClient` is `DataverseClient` from `src/shared/api-client.js`.
`metadataCache` is the `MetadataCache` instance from `app.js` — **not** from `src/shared/metadata-cache.js` (that file exists but is unused in the side panel).

### Tab switching with context

```js
app.switchTab(tabId, context);         // public — switches tab, passes context
app.getModule(tabId);                  // returns cached module instance or null
app.getActiveTab();                    // returns current tab ID
```

When `context` is provided, `module.setContext(ctx)` is called after render.
Modules are cached singletons — switching away and back preserves state.

---

## API client rules — read before touching any query

`DataverseClient.request()` **throws on failure** and **returns unwrapped data**:

```js
// CORRECT
const data = await this.api.request('GET', 'accounts?$top=5');
const records = data.value || [];

// WRONG — response is already the data, not a wrapper
if (!response.success) throw ...     // ❌
const data = response.data || response; // ❌
```

For modules that need HTTP status/headers (request-builder, bulk-ops), use `requestRaw()`:

```js
const raw = await this.api.requestRaw('GET', 'accounts');
// raw: { ok, status, statusText, headers, data, error }
// never throws — always returns
```

See `skills/dataverse-api-gotchas.md` for all API edge cases.

---

## MetadataCache methods (app.js)

```js
cache.getEntities()                     → EntityDefinition[]
cache.getAttributes(entityName)         → AttributeMetadata[]
cache.getRelationships(entityName)      → { ManyToOne, OneToMany, ManyToMany }
cache.getOptionSet(entityName, attrName)→ OptionMetadata[]
```

All results are TTL-cached (default 1 hour). Cache is keyed per method+args.

---

## Message types (side panel → background worker)

| Type | Payload | Returns |
|------|---------|---------|
| `API_REQUEST` | `{ method, url, headers, body }` | `{ ok, status, data, error, headers }` |
| `GET_ENV` | — | `{ url, orgName, apiVersion }` |
| `CLEAR_CACHE` | — | — |
| `EXTERNAL_REQUEST` | `{ url, method, headers, body }` | `{ ok, status, data }` — for AI provider calls |
| `FORM_INSPECT` | `{ action, params }` | `{ data }` — Xrm.Page operations via page context |

---

## Module Bridge (AI Agent ↔ Modules)

The Module Bridge (`ai-customizer/module-bridge.js`) connects the AI agent to every module:

```
AI Agent (chat)
  ├─ read_module_state(tabId)      → module.getContext() — no tab switch
  └─ navigate_module(tabId, ctx)   → app.switchTab() → module.setContext(ctx)
```

**Principle: "Invisible for data, visible for artifacts."**

- Data queries (metadata, records, FetchXML execution) → results in chat, no tab switch
- Visual artifacts (ERD, query builder, bulk ops) → agent navigates to the tab

### Agent tools (tool-registry.js)

28 built-in tools in categories:
- **metadata**: `get_entities`, `get_entity_metadata`, `get_optionset`, `inspect_form`
- **query**: `execute_fetchxml`, `execute_odata`, `get_record`
- **crud**: `create_record`, `update_record`, `delete_record` (confirmation required)
- **customization**: `publish_entity`, `execute_action` (confirmation required)
- **code**: `execute_code` (confirmation required, never auto-approvable)
- **navigation**: `navigate_module`, `read_module_state`, `load_fetchxml`, `load_request`, `load_bulk_operations`, `show_erd`, `show_security`, `generate_tool_schema`
- **other**: `name_conversation`

Tool handlers receive `(params, ctx)` where `ctx = { api, cache, log, bridge }`.

### Quick Chat Bar

Persistent 32px input bar at bottom of every tab (when AI configured).
`Ctrl+I` focuses it. Enter sends message → switches to AI tab → auto-sends.
Hidden when AI tab is active. Appears/disappears when AI settings change.

### Agent protocol (JSON-based, not native function calling)

```jsonc
{ "status": "tool_call", "tool": "<id>", "params": {...}, "reasoning": "..." }
{ "status": "tool_calls", "calls": [...], "reasoning": "..." }
{ "status": "done", "reasoning": "..." }      // reasoning IS the user-facing answer
{ "status": "question", "question": "...", "reasoning": "..." }
{ "status": "error", "error": "...", "reasoning": "..." }
```

### Context injection

The system prompt automatically includes:
1. Tool list with descriptions and param schemas
2. Skill documents linked to active tools
3. Current entity/view context (if selected)
4. Active module state via `bridge.buildContextForPrompt()` (what tab the user is on, current query/request/etc.)

---

## Coding conventions

- ES2022+, pure JS — no TypeScript, no JSX, no bundler
- ES module imports/exports everywhere
- Private fields with `#` prefix for class internals
- CSS custom properties: `--color-*` prefix (defined in `themes.css`)
- CSS class naming: `{module-prefix}-{element}` (e.g. `qb-card`, `erd-toolbar`)
- No external dependencies

---

## What NOT to do

- **Never** `response.data || response` or check `response.success/ok` — `request()` already unwraps
- **Never** `$orderby` on metadata endpoints (`EntityDefinitions`, `/Attributes`, etc.) — not supported; sort client-side
- **Never** `$select` type-specific properties (`MaxLength`, `OptionSet`, etc.) on the base `/Attributes` URL — use a type-cast URL: `/Attributes/Microsoft.Dynamics.CRM.StringAttributeMetadata`
- **Never** read role privilege depth from `roleprivileges_association` or `roleprivilegesdepthmask` — use `RetrieveRolePrivilegesRole(RoleId=@p)?@p={guid}`
- **Never** skip the `activeEnv` restore at the start of `proxyApiRequest` — the service worker is killed after ~30s idle
- **Never** assume the content script is alive after extension reload in dev mode — re-inject on demand via `chrome.scripting.executeScript()`

---

## Key scope decisions

| Tab | Scope |
|-----|-------|
| **Explorer** | Read-only schema browser. No editing. |
| **FetchXML** | Primary query UI. Model → XML / OData / code. Always generate from model, never parse the raw textarea for codegen. |
| **Request Builder** | Raw HTTP tool for one-off calls. Not a query builder. POST hides ID/QueryOptions, record ID disables `$filter`. |
| **Bulk Ops** | JSON array of `{method, url, body}` pasted by user → assembled into `$batch` multipart. Not a visual batch builder. |
| **Security** | Role matrix uses `RetrieveRolePrivilegesRole`. User permissions use `RetrieveUserPrivileges`. Field security uses direct nav prop on systemuser. |
| **ERD** | Solution → solutioncomponents → entities. Export Schema = JSON Schema draft-07. |
| **Tools** | Agent Tool Builder. Entity cards → JSON Schema tool definitions (Claude/OpenAI). 1:N children as deep insert array properties. Output: Tool Schema, Deep Insert template, API info. |
| **AI** | Dataverse Agent (BYOK: OpenAI/Azure/Anthropic). "Claude Code for Dataverse". 28 built-in tools, multi-turn agent loop, sessions, skills, view operations, confirmation UI. Can navigate to and orchestrate ALL other modules via Module Bridge. Quick Chat Bar on every tab (`Ctrl+I`). |
| **Settings** | Persisted to `chrome.storage.local`. Theme applies immediately; no page reload needed. AI provider settings (endpoint, API key, model) stored locally. |

---

## Development setup

```
1. chrome://extensions → enable Developer mode
2. Load unpacked → select this folder
3. Navigate to any *.dynamics.com page and sign in
4. Open side panel (extension icon)
```

After reloading the extension (dev mode), the side panel recovers automatically — no manual page refresh needed.

See `skills/` for transferable patterns used in this project.

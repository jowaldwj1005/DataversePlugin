# Architecture

Conceptual overview of the Dataverse Toolkit — a Chrome Extension (Manifest V3) for Dynamics 365 / Power Platform developers.

---

## Design Principles

- **Zero dependencies.** No frameworks, no bundlers, no libraries. Every component — from the force-directed graph layout to the ZIP parser — is built from browser primitives.
- **No backend.** The extension runs entirely in the browser. API calls go through the user's existing Dynamics 365 session. AI features use BYOK (bring your own key) with direct provider calls.
- **Session piggyback.** Instead of managing OAuth tokens, the extension rides the user's already-authenticated browser session. This eliminates token refresh logic and consent flows entirely.
- **Lazy everything.** Modules load on first tab click. Metadata fetches on first access. Entity trees expand on demand. Nothing runs until it's needed.

---

## The CORS Problem and How It's Solved

The central architectural challenge: the side panel runs at `chrome-extension://` origin, which is CORS-blocked from all `*.dynamics.com` endpoints. There's no server to proxy through. The user's session cookies are bound to the Dynamics 365 origin.

The solution is a three-hop message relay:

```
Side Panel (chrome-extension://)
     │
     │  chrome.runtime.sendMessage
     ▼
Background Service Worker
     │
     │  chrome.tabs.sendMessage
     ▼
Content Script — ISOLATED world (*.dynamics.com)
     │
     │  window.postMessage
     ▼
Page Extractor — MAIN world (*.dynamics.com)
     │
     │  fetch() with credentials: 'same-origin'
     ▼
Dataverse Web API
```

Two content scripts run on every Dynamics 365 page, each in a different Chrome execution world:

- **ISOLATED world** (`content-script.js`): Has access to Chrome extension APIs but not to the page's JavaScript context. Acts as a message relay between the background worker and the page.
- **MAIN world** (`page-extractor.js`): Runs as if it were part of the page itself. Has access to `Xrm` globals, session cookies, and can make `fetch()` calls to Dataverse endpoints without CORS restrictions.

This split is necessary because Chrome MV3 doesn't allow a single script to access both extension APIs and page context simultaneously. The ISOLATED script bridges that gap.

---

## Runtime Components

### Background Service Worker

The service worker is the central message router. It receives requests from the side panel, forwards them to the correct tab's content script, and returns responses.

Key responsibilities:
- **API proxying** — routes every Dataverse request through the content script pipeline
- **Environment detection** — identifies which tab has an active Dynamics 365 session
- **External requests** — proxies AI provider calls (OpenAI, Azure, Anthropic) from the side panel, since the extension origin can't reach those APIs directly either
- **Request logging** — maintains a rolling log of the last 500 API calls, broadcast to any open DevTools panels via long-lived ports
- **Script re-injection** — after an extension reload during development, re-injects content scripts into already-open Dynamics 365 tabs

MV3 service workers are killed after ~30 seconds of inactivity. The worker restores its active environment state from `chrome.storage.session` on every wake-up, so no request is lost to a cold start.

### Side Panel (Main Application)

The side panel is a single HTML page (`index.html`) bootstrapped by `app.js`. It provides:

- A **tab bar** with 10 workspace tabs
- A **module registry** that lazy-loads each tab's module on first activation
- A **metadata cache** with TTL-based expiry and persistent backup in `chrome.storage.local`
- An **event bus** for decoupled communication between modules (connection state changes, settings updates)
- **Theme management** via CSS custom properties — switches instantly without page reload

### Content Layer

The content scripts are injected into every `*.dynamics.com` page. Beyond the API relay described above, the page extractor also:

- Extracts environment metadata (org URL, org name, API version) from the Xrm global
- Handles form inspection requests — reading field values, control states, and form metadata from the live `Xrm.Page` context
- Retries environment extraction up to 15 times on slow-loading pages where `Xrm` isn't immediately available

### DevTools Panel

A separate DevTools panel (`src/devtools/`) provides a real-time API log viewer. It connects to the background worker via a long-lived port and displays every proxied request/response with timing, status, and payload details.

---

## Module System

Every side panel tab is backed by a module class. Modules follow a consistent contract:

- **Constructor** receives a DOM container, the API client, the metadata cache, and an event bus
- **`render()`** builds the full UI from scratch each time the tab becomes active
- **`destroy()`** (optional) cleans up timers and global listeners
- **`onHide()`** (optional) handles tab-switch-away without full destruction

Modules are loaded via dynamic `import()` on first tab activation and cached for reuse. This means the extension starts fast — only the shell UI and connection check run on launch.

Modules don't communicate directly with each other. Cross-module coordination happens through the event bus (connection state, cache invalidation) or through shared services (API client, metadata cache).

### Module Complexity Spectrum

The modules range from simple utilities to complex sub-applications:

| Simple | Medium | Complex |
|--------|--------|---------|
| Form Inspector | API Explorer | Query Builder (FetchXML) |
| Settings | Request Builder | ERD Viewer |
| Tool Builder | Security Inspector | Bulk Operations (8 sub-modules) |
| | | AI Customizer (7 sub-modules) |

The two most complex modules — Bulk Operations and AI Customizer — are decomposed into sub-module directories with their own internal architecture:

**Bulk Operations** uses a wizard pattern: a base class defines the wizard lifecycle (setup, preview, execute, results), and each operation type (create, update, delete, assign, deep insert, status toggle) extends it. Two additional modules handle Configuration Migration Tool export/import.

**AI Customizer** implements a multi-turn agent loop: an agent runner orchestrates LLM calls with tool-use support (metadata lookups), a timeline component renders the conversation history, provider adapters normalize across OpenAI/Azure/Anthropic APIs, and an operation layer handles the actual view modification and creation.

---

## Data Flow Patterns

### Schema Metadata

Entity and attribute metadata is expensive to fetch and rarely changes. The caching strategy has three layers:

1. **In-memory cache** in the `MetadataCache` class — instant access, per-session
2. **Persistent storage** in `chrome.storage.local` — survives service worker restarts and tab reloads
3. **Dataverse Web API** — the source of truth, hit only on cache miss or TTL expiry (default: 1 hour)

Modules request metadata through the cache, which transparently handles fetch, store, and expiry. The cache is keyed by method and arguments, so `getAttributes('account')` and `getAttributes('contact')` are cached independently.

### API Requests

All Dataverse API calls follow the same path regardless of which module initiates them:

1. Module calls `apiClient.request(method, url, body)`
2. API client sends a `chrome.runtime.sendMessage` with type `API_REQUEST`
3. Background worker forwards to the active tab's content script
4. Content script relays to page extractor via `window.postMessage`
5. Page extractor executes `fetch()` with session cookies
6. Response travels back up the chain

The API client exposes two interfaces: `request()` throws on failure and returns unwrapped data (used by most modules), and `requestRaw()` returns the full response envelope including status and headers (used by Request Builder and Bulk Operations where HTTP details matter).

### AI Provider Calls

AI requests (from the AI Customizer) follow a different path. They're sent as `EXTERNAL_REQUEST` messages to the background worker, which makes the HTTP call directly — these don't go through the content script, since they target provider APIs (OpenAI, Azure, Anthropic), not Dataverse.

---

## UI Architecture

The side panel UI is built entirely with vanilla DOM manipulation — no virtual DOM, no templates, no reactivity system. Each module owns its DOM subtree and manages its own state.

### Theming

Three themes (dark, light, high-contrast) are implemented via CSS custom properties defined in `themes.css`. A `data-theme` attribute on the root element switches the active theme. All color references use `var(--color-*)` tokens, so theme changes are instantaneous with no DOM rebuilding.

### Interaction Patterns

- **Virtual scrolling** in the API Explorer handles orgs with 1000+ entities without rendering all nodes
- **Keyboard navigation** supports tab switching (Ctrl+1–5), query execution (Ctrl+Enter), and module-specific shortcuts
- **Toast notifications** use a queue system with auto-dismiss
- **Modals** are stack-based with Escape-to-close
- **Drag-and-drop** is used in the Query Builder (sort reordering) and Bulk Operations (operation reordering)

---

## Security Boundaries

The extension operates within strict isolation boundaries:

- **Extension storage** is invisible to the Dynamics 365 page — AI provider keys and settings never leak to the org
- **Page context access** is limited to what the MAIN world script explicitly extracts — the extension can't read arbitrary page state beyond Xrm globals
- **AI provider calls** go directly from the extension to the provider — Dataverse credentials are never sent to AI endpoints
- **Form inspection** is read-only — the extension reads form context but never modifies form data

---

## Extension Lifecycle

### First Load
1. Chrome injects content scripts into the active Dynamics 365 tab
2. Page extractor detects `Xrm` and sends environment info to the background worker
3. User opens the side panel — `app.js` bootstraps, checks connection via background worker
4. Connection confirmed — shell UI renders, first tab module loads on click

### Service Worker Restart
MV3 kills idle workers aggressively. On wake-up:
1. Incoming message triggers worker activation
2. Worker restores `activeEnv` from `chrome.storage.session`
3. Request processing continues — the caller sees no interruption

### Extension Reload (Development)
After reloading the extension in `chrome://extensions`:
1. Background worker starts fresh, detects open Dynamics 365 tabs
2. Re-injects content scripts via `chrome.scripting.executeScript()`
3. Side panel recovers automatically — no manual page refresh needed

---

## File Organization

```
src/
├── background/          Background service worker
│   └── service-worker.js
├── content/             Content scripts (two execution worlds)
│   ├── content-script.js    ISOLATED world — message relay
│   └── page-extractor.js    MAIN world — API access + Xrm
├── devtools/            DevTools API log viewer
├── popup/               Extension action popup
├── shared/              Cross-context utilities
│   ├── api-client.js        DataverseClient + QueryBuilder
│   └── metadata-cache.js    TTL cache (used by service worker)
└── sidepanel/           Main application
    ├── app.js               Shell, routing, MetadataCache
    ├── index.html           Entry point
    ├── modules/             One class per tab
    │   ├── bulk-ops/            Wizard sub-modules
    │   └── ai-customizer/       Agent sub-modules
    └── styles/              CSS (main, themes, components)
```

The flat module structure is intentional. With no build step and no framework routing, each module is a self-contained ES module file that can be understood in isolation. The two complex modules (Bulk Ops, AI Customizer) are the only ones that warranted sub-directories.

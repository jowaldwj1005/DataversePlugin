# Skill: Chrome Extension — Manifest V3 Patterns

Use this when building any Chrome Extension that needs to make cross-origin API calls
or run persistent logic alongside web pages.

---

## 1. CORS bypass via page proxy (MAIN world content script)

The side panel and background service worker run at `chrome-extension://` — CORS blocks
any fetch to a different origin. The solution: inject a script into the **MAIN world** of
the target page, which runs at that page's origin and inherits its session cookies.

```
manifest.json:
"content_scripts": [{
  "world": "MAIN",            ← key: runs at page origin
  "matches": ["https://*.target.com/*"]
}]
```

The MAIN world script calls `fetch(url, { credentials: 'same-origin' })`.
Message relay: MAIN world → `window.postMessage` → ISOLATED content script → `chrome.runtime.sendMessage` → background worker.

**When to use**: Any extension that needs to call an API protected by session cookies (SSO, SharePoint, D365, etc.) without a Bearer token.

---

## 2. MV3 service worker killed after ~30 seconds idle

Manifest V3 service workers are terminated when idle. Any in-memory state is lost.

**Rule**: Never rely on module-level variables for state that must survive across requests.
Persist everything important to `chrome.storage.session` (survives SW kill, cleared on browser close).

```js
// At the START of every message handler that needs state:
let activeEnv = null;

async function proxyApiRequest(params) {
  if (!activeEnv) {
    const stored = await chrome.storage.session.get('activeEnv');
    if (stored.activeEnv) activeEnv = stored.activeEnv;
  }
  // now safe to use activeEnv
}
```

Persistent cross-session state → `chrome.storage.local`.
Short-term session state (survive SW kill, not browser close) → `chrome.storage.session`.

---

## 3. Content scripts are orphaned after extension reload in dev mode

When you reload an unpacked extension during development, existing tabs' content scripts
lose their connection to the extension but remain in the page. Any `chrome.runtime.sendMessage`
from the page fails silently.

**Recovery pattern**: Background worker catches the error and re-injects on demand.

```js
// Requires "scripting" permission in manifest.json
async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/content-script.js'],
      world: 'ISOLATED',
    });
    // also re-inject MAIN world script if needed
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/page-extractor.js'],
      world: 'MAIN',
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}
```

Also inject proactively on `chrome.runtime.onInstalled` to cover all already-open tabs:

```js
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://*.target.com/*' });
  for (const tab of tabs) {
    try { await injectContentScripts(tab.id); } catch { /* tab may not be ready */ }
  }
});
```

---

## 4. ES modules work natively in MV3 — no bundler needed

MV3 supports ES modules natively in:
- Service workers: `"type": "module"` in the `background` key is **not** supported —
  use classic script, `import()` dynamically if needed
- Side panel / popup HTML: `<script type="module" src="...">` works fully

```json
// manifest.json
"background": {
  "service_worker": "src/background/service-worker.js"
  // no "type": "module" — use importScripts() or classic script
},
"side_panel": {
  "default_path": "src/sidepanel/index.html"
}
```

In side panel HTML:
```html
<script type="module" src="app.js"></script>
```

This means: no webpack, no Rollup, no build step for standard extension UIs.

---

## 5. `chrome.storage` — which store for what

| Store | Survives SW kill | Survives browser close | Shared across contexts |
|-------|-----------------|----------------------|----------------------|
| `storage.session` | ✓ | ✗ | ✓ (same extension) |
| `storage.local` | ✓ | ✓ | ✓ (same extension) |
| `storage.sync` | ✓ | ✓ | ✓ (across devices) |

Use `session` for auth tokens, active connection state.
Use `local` for user settings, metadata cache.
Use `sync` only for small, user-facing preferences (quota: 100KB).

---

## 6. Side panel lazy module loading

Load modules on first tab activation, cache the instance:

```js
async _initModule(tabId) {
  if (this._modules[tabId]) {
    this._modules[tabId].render();   // re-render into fresh container
    return;
  }
  const { default: Mod } = await import(`./modules/${tabId}.js`);
  const mod = new Mod(container, this.api, this.cache);
  mod.render();
  this._modules[tabId] = mod;
}
```

Calling `render()` on re-activation (not `destroy()` + recreate) keeps state
like loaded data, scroll position, and cached metadata alive across tab switches.

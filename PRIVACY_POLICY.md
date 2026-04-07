# Privacy Policy — Dataverse Toolkit

**Last updated: 2026-04-06**

## Summary

Dataverse Toolkit does not collect, transmit, or share any personal data. All data stays in your browser.

---

## What data is accessed

The extension accesses Microsoft Dynamics 365 / Dataverse APIs on your behalf, using the session already established in your browser. No credentials are stored by this extension — authentication happens via browser cookies at the `*.dynamics.com` origin.

## What data is stored

All storage is local to your browser:

| Data | Where | TTL |
|------|-------|-----|
| API metadata cache (entity schemas) | `chrome.storage.local` | 1 hour |
| Settings (theme, preferences) | `chrome.storage.local` | Persistent |
| Auth token (session) | `chrome.storage.session` | ~55 min / browser close |

Nothing is written to `chrome.storage.sync` — data never leaves your device.

## What data is transmitted

API requests are proxied through the active Dynamics 365 page to `*.dynamics.com` endpoints only. No data is sent to any third-party server, analytics service, or external endpoint.

## Permissions justification

| Permission | Reason |
|---|---|
| `activeTab` | Required to interact with the current Dynamics 365 tab |
| `scripting` | Injects content scripts to proxy API calls through the page session |
| `storage` | Stores metadata cache and settings locally |
| `sidePanel` | Displays the extension UI in the side panel |
| `tabs` | Routes messages between the side panel and the active tab |
| `https://*.dynamics.com/*` | All API calls target Dynamics 365 / Dataverse endpoints only |

## Contact / Support

Issues and questions: [https://github.com/jwald3/DataversePlugin/issues](https://github.com/jwald3/DataversePlugin/issues)

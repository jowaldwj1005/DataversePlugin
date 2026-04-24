# Privacy Policy — Dataverse Toolkit

**Last updated: 2026-04-21**

## Summary

Dataverse Toolkit does not collect, transmit, or share any personal data with the extension developer. All settings and cache data stay in your browser. If you configure the optional AI Agent feature (BYOK), prompts and metadata context are sent to the AI provider you choose — see "AI Provider Data" below.

---

## What data is accessed

The extension accesses Microsoft Dynamics 365 / Dataverse APIs on your behalf, using the session already established in your browser. No credentials are stored by this extension — authentication happens via browser cookies at the `*.dynamics.com` origin.

## What data is stored

All storage is local to your browser:

| Data | Where | TTL |
|------|-------|-----|
| API metadata cache (entity schemas) | `chrome.storage.local` | 1 hour |
| Settings (theme, preferences) | `chrome.storage.local` | Persistent |
| AI provider settings (endpoint, model) | `chrome.storage.local` | Persistent |
| AI API key (BYOK) | `chrome.storage.local` | Persistent |
| AI conversation sessions | `chrome.storage.local` | Persistent |
| Agent skills (system + user-created) | `chrome.storage.local` | Persistent |
| ERD layout positions | `chrome.storage.local` | Persistent |
| Auth token (session) | `chrome.storage.session` | ~55 min / browser close |

Nothing is written to `chrome.storage.sync` — data never leaves your device via Chrome sync.

## What data is transmitted

### Dataverse API calls

API requests are proxied through the active Dynamics 365 page to `*.dynamics.com` endpoints only using your existing browser session.

### AI Provider calls (optional, BYOK)

If you configure the AI Agent feature, the extension sends requests directly to the AI provider you specify. This is entirely opt-in and requires you to provide your own API key.

| Provider | Endpoint | What is sent |
|----------|----------|-------------|
| OpenAI | `api.openai.com` | Prompts, entity/field metadata context, conversation history |
| Azure OpenAI | Your Azure endpoint | Same as above |
| Anthropic | `api.anthropic.com` | Same as above |

**Important:**
- Your Dynamics 365 credentials are **never** sent to AI providers
- Only metadata (schema names, field definitions) and user prompts are transmitted
- Record data is only sent if you explicitly use agent tools that include it in the prompt
- API keys are stored locally and sent only to the provider you configured
- No data is sent to the extension developer, analytics services, or any other third party

## Permissions justification

| Permission | Reason |
|---|---|
| `activeTab` | Required to interact with the current Dynamics 365 tab |
| `scripting` | Injects content scripts to proxy API calls through the page session |
| `storage` | Stores metadata cache and settings locally |
| `sidePanel` | Displays the extension UI in the side panel |
| `tabs` | Routes messages between the side panel and the active tab |
| `https://*.dynamics.com/*` | Dataverse API calls via user's browser session |
| `https://api.openai.com/*` | AI Agent: OpenAI provider calls (BYOK, opt-in) |
| `https://*.openai.azure.com/*` | AI Agent: Azure OpenAI provider calls (BYOK, opt-in) |
| `https://api.anthropic.com/*` | AI Agent: Anthropic provider calls (BYOK, opt-in) |

## Contact / Support

Issues and questions: [https://github.com/jwald3/DataversePlugin/issues](https://github.com/jwald3/DataversePlugin/issues)

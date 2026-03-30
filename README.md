# Dataverse Toolkit

A professional Chrome Extension for Dynamics 365 / Power Platform developers. Explore the Dataverse Web API, build FetchXML queries visually, craft HTTP requests, run bulk operations, inspect security roles, and diagram your data model — all from your browser's side panel, with zero backend dependencies.

## Features

### Explorer
Browse your entire Dataverse schema in a VS Code-style tree. Tables, columns, relationships, keys, forms, views, global option sets, actions, functions, and solutions — with full metadata details and virtual scrolling for large orgs.

### FetchXML Builder
Visual node-card query builder. Each table appears as a card with checkable columns, nested filter groups (AND/OR, type-aware operators, OptionSet dropdowns for picklists), and sort rows. Add related tables via a relationship picker (N:1 / 1:N / N:N). Switch between FetchXML and OData output. Execute and view results inline. Code generation: C#, JavaScript, Power Automate HTTP action.

### Request Builder
Craft any Web API request with entity autocomplete, OData query options (auto-disabled when a record ID is entered), a header preset library, and a full response viewer with syntax highlighting. Requests are saved to history with favorites. Generates code in JavaScript, C#, Python, and cURL.

### Bulk Operations
Paste a JSON array of operations — each with `method`, `url` (relative to the API base), and optional `body`. The extension assembles and sends a single `$batch` multipart request. Supports the full Dataverse API including metadata operations (create tables, add columns). Results shown per operation.

```json
[
  { "method": "POST", "url": "EntityDefinitions", "body": { ... } },
  { "method": "POST", "url": "EntityDefinitions(LogicalName='new_project')/Attributes", "body": { ... } }
]
```

### Security Inspector
Role-privilege matrix per entity (Create/Read/Write/Delete/Append/AppendTo/Assign/Share with depth), user permission lookup, field-level security profiles, and audit configuration viewer.

### ERD Viewer
Load a Dataverse solution and render an interactive SVG entity-relationship diagram. Pan/zoom, click an entity to view its full attribute list. Export JSON schema or example POST payload for any entity.

### DevTools Panel
Real-time Dataverse API request logger in Chrome DevTools. Filter, search, and inspect every Web API call made by the extension or the Dynamics 365 app.

## Installation (Development)

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Navigate to any Dynamics 365 / Power Platform environment
6. Open the side panel (click the extension icon) — the extension auto-detects the environment

## Requirements

- Google Chrome 114+ (for Side Panel API support)
- Access to a Dynamics 365 / Power Platform environment

## Architecture

- **No build system** — pure ES modules, no bundler, no transpilation
- **No external dependencies** — everything built from scratch
- **Cookie-based auth** — API calls proxy through the page context (MAIN world content script) which has valid session cookies; no bearer token extraction needed
- **Background service worker** routes all API calls to avoid CORS restrictions on the side panel

See [CLAUDE.md](CLAUDE.md) for full architecture docs and [skills/](skills/) for Dataverse API gotchas.

## License

MIT

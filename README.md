# Dataverse Toolkit

A Chrome Extension for Dynamics 365 / Power Platform developers, built entirely through vibe coding with Claude. No frameworks, no build tools, no dependencies — just raw ES modules, SVG, and a side panel that does more than most standalone apps.

Every feature was designed and implemented in conversation, from the first API proxy to the force-directed ERD layout. The result is a zero-dependency developer toolkit that runs entirely in the browser.

## Features

### API Explorer
Browse your entire Dataverse schema in a VS Code-style tree. Tables, columns, relationships, keys, forms, views, global option sets, actions, functions, and solutions — with full metadata details and virtual scrolling for large orgs.

### FetchXML Builder
Visual node-card query builder. Each table appears as a card with checkable columns, nested filter groups (AND/OR, type-aware operators, OptionSet dropdowns for picklists), and sort rows with drag-and-drop reordering. Add related tables via a relationship picker (N:1 / 1:N / N:N with OData annotation notes). Switch between FetchXML and OData output. Execute and view results inline. Code generation: C#, JavaScript, Power Automate HTTP action.

### Request Builder
Craft any Web API request with entity autocomplete, OData query options (auto-disabled when a record ID is entered), a header preset library, and a full response viewer with syntax highlighting. Requests are saved to history with favorites. Generates code in JavaScript, C#, Python, and cURL.

### Bulk Operations
Paste a JSON array of operations — each with `method`, `url` (relative to the API base), and optional `body`. The extension assembles and sends a single `$batch` multipart request. Supports the full Dataverse API including metadata operations. Results shown per operation.

### Security Inspector
Role-privilege matrix per entity (Create/Read/Write/Delete/Append/AppendTo/Assign/Share with depth indicators), user permission lookup via `RetrieveUserPrivileges`, field-level security profiles, and audit configuration viewer.

### Interactive ERD Viewer
This is where the vibe coding really paid off. Load any unmanaged Dataverse solution and get a fully interactive entity-relationship diagram:

- **Force-directed layout** — entities cluster by relationships using a Fruchterman-Reingold physics simulation. Toggle to grid layout with animated transitions
- **Entity dragging** — grab any entity and rearrange it, arrows follow in real-time with requestAnimationFrame throttling
- **Smart field display** — entities show PK, primary name, and FK/lookup fields by default. System lookups (Created By, Modified By, delegates, owning team/user/BU) are hidden by default to reduce noise
- **FK Fields dropdown** — globally toggle which system lookup fields appear on all entities. "Hide all" instantly declutters the diagram to show only business-relevant relationships
- **Per-entity column chooser** — right-click any entity to pick exactly which fields to show on that specific box
- **Expand on double-click** — double-click any entity to see ALL its fields, double-click again to collapse back
- **Crow's foot notation** — proper ERD markers (||, fork) showing 1:N and N:N cardinality at both ends
- **N:N relationships** — many-to-many relationships rendered with distinct dotted styling and intersect entity info in tooltips
- **Orthogonal routing** — clean H-V-H Manhattan-style lines with lane offsets so parallel edges don't overlap. Toggle to Bezier curves
- **Relationship highlighting** — hover any entity to highlight its connections and fade everything else
- **Minimap** — canvas-based overview in the bottom-right corner with viewport indicator, click to navigate
- **Filtering** — text search, "Custom only", "Hide system entities" checkboxes
- **SVG & PNG export** — download the diagram with all styles inlined and CSS variables resolved. PNG renders at 2x for retina, with theme-colored background
- **JSON Schema export** — draft-07 schema with Dataverse type extensions (`x-dataverse-type`, `x-dataverse-primaryId`)
- **Payload export** — example POST body with required fields populated and optional fields included
- **Keyboard shortcuts** — `+`/`-` zoom, `0` reset, `f` focus filter, `Escape` clear selection

All of this in ~1500 lines of vanilla JS and SVG — no D3, no Cytoscape, no graph library.

### DevTools Panel
Real-time Dataverse API request logger in Chrome DevTools. Filter, search, and inspect every Web API call made by the extension or the Dynamics 365 app.

## Installation

1. Clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Navigate to any Dynamics 365 / Power Platform environment and sign in
6. Open the side panel (click the extension icon)

## Requirements

- Google Chrome 114+ (Side Panel API)
- Access to a Dynamics 365 / Power Platform environment

## Architecture

- **No build system** — pure ES modules, no bundler, no transpilation
- **No external dependencies** — everything built from scratch
- **Cookie-based auth** — API calls proxy through the page context (MAIN world content script) which has valid session cookies
- **Background service worker** routes all API calls to avoid CORS restrictions on the side panel

See [CLAUDE.md](CLAUDE.md) for full architecture docs and [skills/](skills/) for Dataverse API patterns.

## Vibe Coding

This project was built through iterative conversation with Claude — describing features, reviewing screenshots, adjusting behavior, and pushing the boundaries of what's possible without dependencies. The ERD viewer alone went through multiple rounds of "arrows land at the same spot", "layout not optimal", "system fields are cluttering everything" — each fixed in conversation.

## License

MIT

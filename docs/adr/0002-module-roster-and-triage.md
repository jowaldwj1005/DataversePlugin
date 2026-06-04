> **Status: superseded — absorbed into [`docs/PRD.md`](../PRD.md) (2026-06-03).**
> Frozen as the Phase-2 working draft. Several of its specifics were corrected by `docs/CODEBASE-ATLAS.md` and by owner decisions (Security stays as a directly-reachable UI surface + tools, not an agent-tools-only cut; Skills persist as Solution-bundled Dataverse records; Authoring is one mode and has a working precursor; LOC and tool counts were wrong). The grill edits in this file (cut-order, Authoring one-mode, Query absorbing Data Investigation) are partial and intentionally not reconciled — the PRD is the corrected, living version. Do not build from this file; build from the PRD.

# ADR-0002: MVP Module roster, per-Module triage, interaction-mode tagging

## Context

ADR-0001 locked the product positioning: an *Environment-scoped, multi-Module developer Workspace for Dataverse, designed end-to-end for human-Agent collaboration*, with every capability tagged by one of three interaction modes (Agent-only, UI-led / Agent-augmented, Agent-led / UI-augmented). It explicitly deferred *which* Modules ship in the MVP and *what happens to* each surface in the current build.

Phase 0 produced a salvage map across ~36,500 LOC: ~10K solid (ERD v2, API Client, content-script bridge, Detail Panel, Code Editor, Form Tools, Request Builder, easter eggs), ~13K salvageable patterns (FetchXML, Explorer, Security, Tool Builder, AI Agent infrastructure), ~13K to cut (Bulk Ops wizard tangle, ERD v1, RecordViewer, inlined CSS, monolithic `app.js` sections).

This ADR operationalizes ADR-0001 against that map:
1. **Full MVP Module roster.**
2. **Per-Module verdict** — keep / refactor / rethink / cut / rebuild.
3. **Interaction-mode tag** per Module and (roughly) per significant Agent Tool.
4. **Standalone-without-BYOK contract** per Module.

## Decision

### MVP Module roster — 11 Modules

| # | Module | Mode | BYOK required? | Verdict |
|---|---|---|---|---|
| 1 | **Explorer** | UI-led, Agent-augmented | No | Light refactor |
| 2 | **Query** | UI-led, Agent-augmented | No | Rethink (split) + new Explore/Pivot surface (absorbs Data Investigation) |
| 3 | **Request Builder** | UI-led, Agent-augmented | No | Rebuild in new shell |
| 4 | **ERD** | UI-led, Agent-augmented | No | Keep (v2 only); template the rest |
| 5 | **Form** | UI-led, Agent-augmented | No | Light refactor |
| 6 | **Authoring** | Agent-led, UI-augmented | **Yes** | Build from scratch (no prior surface) |
| 7 | **Bulk Ops** | Agent-led, UI-augmented | Recommended (core scope-picker works without) | Rebuild as flagship — "CMT on crack" |
| 8 | **Agent Investigation** | UI-led, Agent-augmented (transcripts surface) | **Yes** | Build from scratch (no prior surface) |
| 9 | **Skills** | UI-led, Agent-augmented | No (browse + run); recommended (Agent-assisted edit) | New surface; absorbs current Tool Builder |
| 10 | **Agent Chat** | Transverse — chat as Module | **Yes** | Rebuild on a real Agent framework (ADR-0004) |
| 11 | **Settings** | UI-led (almost no Agent surface) | No | Light refactor (extract from `app.js`) |

**Verdict legend:** *Keep* — minimal change. *Light refactor* — preserve logic; extract coupling, clean structure. *Rethink* — same job, different decomposition (model / parser / codegen split). *Rebuild* — pattern survives, code does not. *Build from scratch* — no prior surface in current build.

### Per-Module specification

#### 1. Explorer — UI-led, Agent-augmented

**Job:** Browse the Environment's schema — entities, attributes, relationships, keys, forms, views, Custom APIs, Solutions. The "where AI stops" canonical example: scrolling and inspecting deterministic metadata never requires chatting.

**Salvage:** Current `api-explorer.js` (2.5K) — virtual scrolling, tree navigation, lazy-loaded sub-categories. Solid foundation.

**Refactor:**
- Extract coupling to the shared Detail Panel (currently each Module has its own copy).
- Surface state via Module Bridge (`get_selection`, `selected_entity`, `selected_attribute`).
- Expose key actions as Agent Tools (`navigate_to_entity`, `inspect_entity`).

**Key Agent Tools:** `search_entities` (filter required, retain), `get_entity_metadata`, `get_optionset`, `navigate_module(Explorer, …)`.

**Standalone contract:** Fully usable without BYOK. Identical surface — Agent simply isn't there to assist.

---

#### 2. Query — UI-led, Agent-augmented

**Job:** Read-only data fetching via FetchXML or OData with multi-syntax code generation (FetchXML / OData / JS / C# / Power Automate parameters).

**Salvage:** Current `fetchxml-builder.js` (2.7K) — bidirectional model ↔ XML/OData sync, template queries, pagination, history. Logic survives; structure does not.

**Rethink:**
- Split monolith into four pure modules:
  - **QueryModel** (immutable representation: entity, attributes, filters, links, order, paging, aggregates)
  - **Parsers**: FetchXML ↔ QueryModel; OData ↔ QueryModel
  - **Codegen**: QueryModel → FetchXML / OData / JS (Xrm.WebApi) / C# / PowerShell
  - **UI** (the visual builder)
- Saved queries become first-class persisted artifacts (Workspace-bound; possibly per-Environment).
- Templates stay (All Active, My Records, Created Today).

**Boundary:** Direct query building, saved-query click-to-run, click-to-paginate, syntax switching = "where AI stops". Query *synthesis from natural language*, *cross-table joins from a description*, *explain this query* = Agent.

**Key Agent Tools:** `execute_fetchxml`, `execute_odata`, `build_query(description) → QueryModel`, `explain_query`, `save_query(name)`.

**Standalone contract:** Fully usable without BYOK.

---

#### 3. Request Builder — UI-led, Agent-augmented

**Job:** Craft arbitrary Web API HTTP requests; preview headers, body, response; generate code in PowerShell / C# / Python / Node.js / JS.

**Salvage:** Current `request-builder.js` (1.8K) — solid single-purpose tool. Pattern survives; rebuild in the new Module shell.

**Rebuild scope:** Same surface, ported to the new Module pattern (Module Bridge from day one; standardized state shape; consolidated Code Editor; no inlined CSS).

**Boundary:** URL building, method picking, header editing, body editing, response viewing = "where AI stops". Request *synthesis* ("build a $batch that updates these 20 accounts"), *explain this 400 response*, *generate the next request from the last response* = Agent.

**Key Agent Tools:** `execute_request(method, url, headers, body) → response`, `explain_response`, `suggest_request(intent)`.

**Standalone contract:** Fully usable without BYOK.

---

#### 4. ERD — UI-led, Agent-augmented

**Job:** Visualize the Environment's relationship graph — Solution-scoped or ad-hoc — with the field-level detail of each entity surfaced via a click.

**Salvage:** ERD v2 sub-module pack (`erd-v2/` — 13 files, dagre-powered hierarchical layout, channel-routed edges, exemplary deep-module architecture). Keep as-is and use as the architectural template for the rewrite.

**Cut:** ERD v1 (`erd-viewer.js` — 3.6K) — replaced by v2.

**Light refactor:** Consolidate the Detail Panel duplicate (`erd-v2/detail-panel.js` → shared `DetailPanel`).

**Boundary:** Pan, zoom, click-to-select, layout = "where AI stops". *"Show me all entities related to Case at depth 2"*, *"what's similar to this graph in Solution X"*, *"reorganize to group by ownership"* = Agent.

**Key Agent Tools:** `show_erd(scope)`, `navigate_to_entity`, `explain_relationship`.

**Standalone contract:** Fully usable without BYOK.

---

#### 5. Form — UI-led, Agent-augmented

**Job:** Inspect the live model-driven-app form the user is currently looking at. Field list with All / Dirty / Required / Hidden / Disabled filters, raw record JSON, record bookmarks, quick clone, Environment badge (DEV / TEST / PROD).

**Salvage:** Current `form-tools.js` (1.5K) — preserve the `FORM_INSPECT` Xrm.Page bridge, sub-tab logic, Environment-badge detection, bookmarks.

**Light refactor:** Extract sub-surface management into a shared pattern (also used by Investigation); reuse shared Code Editor for JSON viewing instead of bespoke highlighting.

**Boundary (the Level Up complement):** Read-only contextual surface. We deliberately do NOT replicate Level Up's God Mode (unlocking / unhiding / unmandatory-ing fields by manipulating the host page DOM). The Form Module reads form state and surfaces metadata; mutation goes through Authoring + Skills.

**Boundary:** Inspecting fields, JSON, bookmarks, copying GUIDs = "where AI stops". *"What changed since I last loaded this record?"*, *"why is this field hidden?"*, *"generate FetchXML for this record's related contacts"* = Agent.

**Key Agent Tools:** `inspect_form` (Xrm.Page operations), `get_record`, `bookmark_record`.

**Standalone contract:** Fully usable without BYOK.

---

#### 6. Authoring — Agent-led, UI-augmented

**NEW Module.** No prior surface in the current build.

**Job:** Create and modify Dataverse schema — tables, columns, relationships, security roles, forms, views — through the Agent, never through a WYSIWYG designer. One uniform mode across all scales: the Agent proposes a step sequence (one step or many), the UI surfaces diff/progress, the human approves/edits/aborts.

**Build from scratch.** Single dependency is the API Client and the metadata Web API; no prior tangled code to port.

**One surface, two ends of a spectrum:**

- **Single-op end** (degenerate Solution-scale case — one-step flow): *add column to entity X*, *add 1:N from X to Y*, *add option to set Z*, *publish entity*, *update form attribute*. UI: one-step Approval surface showing the proposed metadata diff. Approve commits; abort cancels.
- **Solution-scale end**: *create an audit table family for these 5 entities*, *generate forms for all entities in Solution X*, *apply this Skill to every entity tagged custom*. UI: multi-step Approval surface — per-step progress, diff per entity, approve / skip / edit / abort per step, dry-run mode for the whole sequence.

Both ends share the same UI primitive (an Approval Step with diff + actions) — a single-op is a one-step Approval Flow. The user never sees a "mode switch"; the surface scales with the number of steps in the flow.

**Form / view generation (in scope):** Agent-driven *generation* of forms and views — one-shot create forms across many entities. NOT a click-by-click visual editor. make.powerapps.com remains the canonical visual designer for jobs that genuinely need one.

**Key Agent Tools:** `create_column`, `create_relationship`, `create_entity`, `add_optionset_option`, `update_form_xml`, `create_view`, `publish_entity`, `publish_all`, `dry_run`, `approve_step`, `abort_flow`.

**Standalone contract:** Requires BYOK. Authoring is the one job that *only* works with an Agent configured. Users without BYOK see Authoring's Module entry explaining what it does and how to enable it.

---

#### 7. Bulk Ops — Agent-led, UI-augmented

**Job:** Move records between Environments (Configuration Migration), conditionally mass-update records, mass-delete with filtering. Headline use case: CMT-style migration with Agent-driven filtering, mapping suggestions, schema-aware translation, Solution-scale awareness. Internal codename: *"CMT but on crack."*

**Cut entirely:** The current `bulk-operations.js` + `bulk-ops/` sub-folder — 5K lines, monolithic WizardBase, six wizard sub-classes, anti-glossary "wizard" surface. Replace the whole implementation.

**Rebuild — new surface shape:**
- **Scope picker** (direct manipulation): pick source Environment context, pick entity set, pick filter (saved Query, FetchXML, or "everything in Solution X")
- **Agent filter / mapping pass:** Agent reviews scope, proposes filters, identifies cross-Environment ID remapping needs (lookups, owners, business units), surfaces schema differences
- **Dry-run with diff:** preview of what will change record-by-record, grouped by entity
- **Approval flow:** approve / skip / edit / abort per group; the human steers, the Agent runs
- **Commit:** `$batch` execution (mechanics preserved from current code — `EntityBodyBuilder`, batch boundaries, CMT XML utilities salvageable)
- **Result inspection:** record-by-record success/failure with replay

**Salvageable patterns:** `$batch` multipart assembly, `EntityBodyBuilder`, CMT XML import/export utilities. Cut: WizardBase modal stepper, the per-wizard subclasses, the bespoke `DynamicTextarea`.

**Key Agent Tools:** `propose_bulk_filter`, `propose_id_mapping`, `dry_run_batch`, `execute_batch`, `compare_environments(scope)`, `import_cmt_xml`, `export_cmt_xml`.

**Standalone contract:** Core scope picker + manually pasted JSON / OData batch works without BYOK (kept for the user who refuses to configure an Agent and wants raw batch power). The differentiating Agent-driven filtering and mapping requires BYOK.

---

#### 8. Data Investigation — UI-led, Agent-augmented

**NEW Module.** No prior surface in the current build.

**Job:** Exploratory inspection of Dataverse data — any table, any rows, any relationships. Generic, distinct from Query (Query is *parameterized read*; Data Investigation is *exploratory read with pivot*). Audit-log records are one type of data among many; not a special case.

**Surface:**
- Universal data table with sort / filter / column visibility (RecordViewer's pattern, rebuilt — the existing `record-viewer.js` is unused dead code but the data-grid pattern is sound)
- Cross-record pivot: select a record, see related records in adjacent entities, follow lookups
- Live execution against the connected Environment (reuses Query under the hood for the actual fetch)
- Saved investigations (Workspace-bound)

**Boundary:** Loading a saved investigation, sorting a column, paginating, following a lookup = "where AI stops". *"Find me cases where the owner doesn't match the team"*, *"explain why this record's status is locked"*, *"what's anomalous about this set of audit-log entries"* = Agent.

**Why a separate Module from Query:** Query produces a result; Investigation lives in the result. Different surfaces, different state shapes, different saved-artifact lifetimes.

**Key Agent Tools:** `investigate_records(filter)`, `pivot_to_related`, `anomaly_summary`, `explain_record`.

**Standalone contract:** Fully usable without BYOK.

---

#### 9. Agent Investigation — UI-led, Agent-augmented

**NEW Module.** No prior surface in the current build.

**Job:** Audit what the Workspace Agent itself has done — a Claude-Code-style transcript of Tool calls, decisions, mutations, with possible extensions (record-level diffs, replay, "what changed since I asked").

**Out of scope:** Auditing external AI agents (Foundry, Copilot Studio, third-party). That is someone else's product.

**Surface:**
- Conversation timeline: messages, Tool calls, Tool responses, mutations
- Tool-call expansion: see params, response, downstream mutations
- Mutation diff: for any Tool that mutated Dataverse data, show before/after
- Filter by: time range, Tool name, success/failure, Environment
- Per-Skill view: "what did the *audit-table* Skill do in this Workspace"
- Export: shareable transcript snippet

**Why a separate Module from Agent Chat:** Agent Chat is the *live* surface (in-the-moment conversation). Agent Investigation is the *retrospective* surface (auditing past behavior). Different jobs, different surfaces — same underlying transcript data.

**Key Agent Tools:** `query_transcripts(filter)`, `replay_step`, `diff_mutation`, `explain_decision`.

**Standalone contract:** Requires BYOK — if there's no Agent configured, there's no transcript to investigate. Users without BYOK see the Module entry explaining it exists once Agent is configured.

---

#### 10. Skills — UI-led, Agent-augmented

**NEW first-class Module.** Absorbs the current Tool Builder.

**Job:** Browse, edit, run, and share Skills (markdown plus Agent Tool links, persisted in Dataverse). System Skills ship with the product; User Skills are authored by users. Skills are the product's dynamic extensibility mechanism (per ADR-0001).

**Salvage:** Current `skill-manager.js` (332 lines) — the system + user skill model and Dataverse persistence. Current `tool-builder.js` (1.2K) — entity-card-to-tool-schema pattern. Both fold into this Module.

**Surface:**
- **Browse:** list system + user Skills; preview their markdown; see which Agent Tools they reference
- **Edit:** create new User Skill or edit existing; markdown editor (reuse Code Editor); Agent Tool picker
- **Run:** invoke a Skill against the current Workspace selection (entity, record, scope)
- **Share:** publish to Dataverse so other users in the same Environment can use it
- **From Tool Builder:** card-based Tool generation (entity → JSON Schema → Skill scaffold)

**Boundary:** Browsing, picking, running a Skill, viewing its markdown = "where AI stops". *"Suggest a Skill for this scope"*, *"refine this Skill's prompt"*, *"merge these two similar Skills"* = Agent.

**Skill ownership / sharing model:** Personal (User Skill in own Dataverse user record) vs Team (shared in a Dataverse table accessible by security role) vs Solution-bundled (Skill records inside a Solution that exports/imports with it). Resolution deferred to a near-term follow-up ADR (likely ADR-0007 or similar).

**Key Agent Tools:** `list_skills`, `create_skill`, `update_skill`, `run_skill(name, scope)`, `suggest_skill_from_history`.

**Standalone contract:** Browsing + running existing Skills works without BYOK (Skills that don't require AI — e.g. parameterized Query templates exposed as Skills — run fine; Skills that call the Agent obviously don't). Editing / authoring new Skills is recommended-with-BYOK but markdown editing works directly.

---

#### 11. Agent Chat — Transverse Module

**Job:** The conversational surface for the Agent. Lives across Modules — from inside Agent Chat the Agent reads any other Module's state, drives it through Tools, and navigates the user to it. Agent Chat is one Agent-first UI among many; the Agent participates in other Modules without requiring the user to be in Agent Chat. (Detailed UX shape — exact placement, command palette, Module navigation — deferred to ADR-0003.)

**Rebuild on a real Agent framework.** Drop the bespoke JSON protocol (`status: tool_call / tool_calls / done / question / error`). Drop the hand-rolled JSON repair. Drop the 1,201 lines of inlined CSS in `styles.js`.

**Framework choice:** Vercel AI SDK vs LangGraph.js — deferred to ADR-0004 (Phase 4) with a bundle-weight spike in an MV3 extension.

**Preserve:** Tool Registry pattern (the 28 Tools are gold; specific Tool list is implementation, not architecture); Provider Adapters (OpenAI / Azure / Anthropic / Custom; Responses API + Chat Completions fallback); Module Bridge (`read_module_state`, `navigate_module`, `buildContextForPrompt`); Session Manager (multi-conversation persistence); confirmation flow for destructive Tools.

**Cut:** Bespoke `agent-runner.js` JSON protocol; inlined CSS; XML diff renderer (move to Agent Investigation Module); the operations sub-folder (fold into Authoring).

**Standalone contract:** Requires BYOK. No Agent without an Agent configured.

---

#### 12. Settings — UI-led (almost no Agent surface)

**Job:** Theme (dark / light / high-contrast), cache TTL, AI provider configuration (BYOK), Responses API vs Chat Completions toggle, reasoning-token budget.

**Salvage:** Current inline settings panel in `app.js` (~250 lines) — works fine.

**Light refactor:** Extract into its own Module class. Add validation (endpoint URL format, API key presence). Add import / export for portability.

**Boundary:** Toggling a setting is direct manipulation. The Agent could *explain* a setting on request but does not drive Settings — there is no business case for Agent-driven setting changes.

**Key Agent Tools:** None primary. (Maybe `get_workspace_settings(read-only)` for debugging.)

**Standalone contract:** Fully usable without BYOK. Indeed, it is *the* Module where the user configures BYOK.

---

### Cut order under velocity pressure

Twelve Modules is the MVP target. If implementation velocity forces a defer, the cut order is fixed in advance so the call is made on schedule rather than under panic:

1. **Data Investigation → v1.1.** First to defer. Explorer + Query + Form already cover joint schema-plus-data inspection adequately for MVP; Data Investigation's added value is *pivot* and *anomaly* surfaces, which are deepening, not table-stakes. Lowest positioning cost: ADR-0001's "joint schema + data inspection" use case stays served by the three existing Modules until v1.1 lands the pivot/anomaly UX.
2. **Skills edit surface → v1.1.** Second. Skills Module ships browse + run (system Skills only); User Skill authoring/editing/sharing UI defers. Skills-as-a-concept stays in MVP — markdown can still be edited externally and dropped in. Re-examined in Grill #7.
3. **Agent Investigation depth → v1.1.** Third. Bare transcript list ships in MVP (the Primary Use Case is preserved at a shallow level); mutation diff, replay, per-Skill view, advanced filters defer.

Authoring, Bulk Ops, Request Builder, Agent Chat, Skills-as-a-concept, Explorer, Query, ERD, Form, Settings are non-deferrable — each is either a Primary Use Case Module or load-bearing infrastructure.

### Cross-cutting cuts

- **ERD v1** (`erd-viewer.js`, 3.6K) — replaced by ERD v2.
- **RecordViewer** (`record-viewer.js`, 1.4K) — dead code. The data-grid pattern is reborn in Data Investigation.
- **Tool Builder** (`tool-builder.js`, 1.2K) as a standalone Module — absorbed into Skills.
- **Bulk Ops wizard** (`bulk-operations.js` + `bulk-ops/`, 5K) — replaced wholesale.
- **Custom JSON agent protocol** + **inlined CSS** in current AI Customizer — replaced via framework choice in ADR-0004.
- **DetailPanel duplicates** in Explorer, Security, ERD v2 — consolidated to one shared component.
- **Replicated constants** (`SYSTEM_FIELDS`, `SKIP_FIELDS`, `TYPE_MAP`) across 4+ Modules — centralized.
- **The Security Module as a tab in the rewrite** — ADR-0001 promotes it from "rethink" to "Agent capability." Security inspection becomes Agent Tools (`who_can_X_on_Y`, `compare_role_privileges`, `show_field_security`) callable from Agent Chat, Authoring, or Data Investigation. The existing role-matrix UI is not rebuilt as its own Module; if a deep role-matrix surface is needed later, it returns as a v1.1 Module. This is the largest single scope reduction from the current build.

### Cross-cutting preserves

- **API Client** (`src/shared/api-client.js`, 590 lines) — keep as-is.
- **Three-hop content-script CORS bridge** — keep as-is. Black box.
- **MetadataCache** — keep, lift out of `app.js`.
- **Code Editor** (1.1K) — keep, lightweight.
- **Detail Panel** — keep one shared implementation.
- **Easter eggs** — keep. Zero coupling, morale.
- **Provider Adapters** — keep the abstraction even when the agent framework changes.
- **Module Bridge interface** — keep the *shape* (`read_module_state`, `navigate_module`, `buildContextForPrompt`); the implementation may move into whichever agent framework is chosen.

### Interaction-mode summary

| Mode | Modules |
|---|---|
| Agent-only (with optional UI surface) | *(none in MVP — slot reserved for future capabilities)* |
| UI-led, Agent-augmented | Explorer, Query, Request Builder, ERD, Form, Data Investigation, Agent Investigation, Skills, Settings |
| Agent-led, UI-augmented | Authoring, Bulk Ops |
| Transverse | Agent Chat |

**Why no MVP Module is Agent-only:** Authoring was the natural candidate but its single-op surface is a *degenerate one-step Solution-scale flow*, not a distinct mode — the user always sees an Approval Flow UI (one step or many), never a mode switch. The Agent-only category remains in the taxonomy for future Modules where no UI surface fits (e.g. a hypothetical background-Agent housekeeping Tool), but no MVP Module ships under it. See Grill #2 resolution.

### LOC budget — rough target

| Surface | Current | Target |
|---|---|---|
| Workspace shell (was `app.js`, etc.) | 4,100 | 1,500 |
| Explorer | 2,500 | 2,000 |
| Query | 2,700 | 2,500 (split, no longer monolithic) |
| Request Builder | 1,800 | 1,500 |
| ERD (v2) | 2,000 | 2,000 |
| Form | 1,500 | 1,200 |
| Authoring | 0 | ~2,500 (new) |
| Bulk Ops | 5,100 | ~2,500 |
| Data Investigation | 0 | ~1,500 (new) |
| Agent Investigation | 0 | ~1,500 (new) |
| Skills | 1,500 (Tool Builder + Skill Manager) | ~2,000 |
| Agent Chat | 1,800 + 1,200 inlined CSS | ~2,000 (framework dependency) |
| Settings | 250 | 400 |
| Shared (API Client, Code Editor, Detail Panel, MetadataCache, content-script bridge, easter eggs) | 4,500 | 4,000 |
| Cut (ERD v1, RecordViewer, Tool Builder dup) | 6,200 | 0 |
| **Total** | **~36,500** | **~27,000** |

Net reduction is smaller than the Phase 0 straw-man (~12K target) because:
- Authoring + Data Investigation + Agent Investigation are *new* Modules.
- Bulk Ops is rebuilt rather than cut.

The shape changes more than the size. The product has more Modules but fewer dead-weight LOC.

## Alternatives considered and rejected

- **Fold Data Investigation into Explorer + Query.** Rejected. Explorer is *schema*; Query is *parameterized read*; Data Investigation is *exploratory read with pivot*. Different surfaces, different state shapes. Conflating them in one Module would force a confused UI.
- **Defer Skills Module to v1.1.** Rejected. Skills are the extensibility mechanism per ADR-0001; if users can't see or edit them in the Workspace, they can't extend it. MVP requires a Skills Module.
- **Keep Security as its own Module.** Rejected for MVP. Role-matrix inspection is real value but it's not in the four primary use cases stated in ADR-0001 (Authoring at Solution scale, joint schema + data inspection, Agent Investigation, Web API testing). Promote it to Agent Tools and surface it where needed; if user demand warrants a dedicated Module, it returns as v1.1.
- **Keep Tool Builder as a separate Module.** Rejected. Tool Builder generates Tool schemas from entity metadata — which is exactly Skill scaffolding. Folding it into Skills removes the duplicate Module.
- **One Investigation Module with two sub-surfaces.** Rejected (user-confirmed). Data Investigation and Agent Investigation have nothing in common operationally — one queries Dataverse data, the other queries Agent transcripts. Separate Modules give each a clean surface; a single "Investigation" Module would force a tab-bar splitter inside the Module, which is just two Modules wearing a costume.
- **Treat Agent Chat as the shell rather than a Module.** Rejected per ADR-0001. The product is Agent-first but not chatbot-first; most Agent-first UIs are non-chat. Agent Chat is one Module among many — albeit a transverse one. The detailed UX shape (where Agent Chat sits in the layout, whether it's always-visible, command-palette behavior) is ADR-0003.
- **Keep the existing Bulk Ops wizard implementation as-is and only refactor.** Rejected. The 5K wizard tangle is the worst Phase 0 finding — 1,093 lines of `WizardBase` modal boilerplate, six sub-classes reimplementing the same lifecycle. The use case is flagship but the implementation cannot be salvaged. Rebuild.
- **Build click-by-click visual designers for forms / views as part of Authoring.** Rejected per ADR-0001. Authoring is Agent-driven across all three modes; make.powerapps.com remains the canonical visual designer. Authoring's value-add is *Agent-driven generation* + *reusable Skills*, not a competing GUI.

## Consequences

**Commits us to:**

- **Twelve MVP Modules** — three of them new (Authoring, Data Investigation, Agent Investigation), one absorbed/repositioned (Skills), one rebuilt as flagship (Bulk Ops), six refactored or rebuilt against existing patterns, one rebuilt on a new agent framework (Agent Chat). This is the rewrite's surface area.
- **The interaction-mode taxonomy is a design contract.** Every new Module must declare its mode before implementation begins. Mixed-mode Modules (Authoring) must be explicit about which sub-surface is which mode.
- **Every Module surfaces state via the Module Bridge and exposes its meaningful actions as Agent Tools — from day one.** No "we'll add the Agent integration later" milestones.
- **Direct-manipulation Modules must work standalone (no BYOK).** This is now a per-Module contract: Explorer, Query, Request Builder, ERD, Form, Data Investigation, Skills (browse + run), Settings, and Bulk Ops (core scope picker) must each ship a fully usable no-BYOK mode. Authoring, Agent Chat, and Agent Investigation are the only Modules that hard-require BYOK.
- **The product has more Modules than before, not fewer.** Twelve MVP Modules vs the eight-to-nine tabs in the current build. Cohesion comes from Agent-first design + shared state + the Module Bridge, not from surface reduction.
- **Skill ownership / sharing model is a known follow-up.** Personal vs Team vs Solution-bundled needs an ADR before Skills Module implementation begins.
- **Security goes from "Module" to "Agent Tools."** Largest single scope reduction. If demand warrants a dedicated surface later, it returns as v1.1.
- **`app.js` is split.** The Workspace shell, MetadataCache, ModuleRegistry, EventBus, ModalStack, ToastQueue, SettingsManager, and (transverse) Agent Chat each become explicit surfaces — not buried in a 2,091-line bootstrap.

**Forecloses:**

- No third-party plugin gallery for Modules. Modules ship with the product; capabilities extend via Skills + Agent Tools.
- No WYSIWYG schema, form, or view designer in Authoring.
- No dedicated Security Module in MVP.
- No multi-Environment Workspace in MVP (parked from ADR-0001).
- No external-AI-agent auditing in Agent Investigation.

**Open follow-ups (next ADRs):**

- **ADR-0003 (Phase 3) — UX shape:** layout (where Agent Chat sits, always-visible vs invocable, command palette), Module navigation (sidebar vs top bar vs command palette), inter-Module state passing.
- **ADR-0004 (Phase 4) — Agent framework:** Vercel AI SDK vs LangGraph.js — with bundle-weight spike in MV3 context.
- **ADR-0005 — Workspace shell architecture:** Module lifecycle, state shape, Bridge wiring, hot-swap during dev.
- **ADR-0006 — Skill ownership / sharing model:** Personal vs Team vs Solution-bundled, security roles, versioning.
- **ADR-0007 — Standalone-without-BYOK contract:** what each Module surfaces when no Agent is configured (CTA placement, empty-state copy).

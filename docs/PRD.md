# Dataverse Toolkit — Product Requirements (PRD)

> **Status: living source of truth (2026-06-04).** This PRD **supersedes and absorbs** ADR-0001 (positioning) and ADR-0002 (Module roster) — both retained as historical record with a superseded banner. From here, product direction is edited *here*; ADRs are reserved only for genuinely hard-to-reverse **technical** forks.
>
> **Grounding:** every "what exists today" claim is taken from [`CODEBASE-ATLAS.md`](./CODEBASE-ATLAS.md) (verified ground truth of the current `main` build), and every stack choice from [`REWRITE-FOUNDATIONS.md`](./REWRITE-FOUNDATIONS.md). The glossary is [`CONTEXT.md`](../CONTEXT.md) — its vocabulary is load-bearing and used verbatim here (Workspace, Module, Agent, Agent-first UI, Agent Tool, Skill, Authoring, Query, Investigation, Bulk Ops, Solution-scale, BYOK, the three interaction modes). We never say *tab*, *wizard*, *AI*, *chatbot*, *plugin*.
>
> **How to read:** §1–4 are *why and what* (thesis, rewrite rationale, positioning, doctrine). §5–9 are *the product* (Module roster, per-Module scope, the Agent, write-safety, Skills). §10 is *how it's built* (the decided stack). §11–13 are *boundaries, sequencing, open forks*.

---

## 1. Product thesis

The Dataverse Toolkit is an **Environment-scoped, multi-Module developer Workspace for Dynamics 365 / Power Platform, designed end-to-end for human–Agent collaboration**, delivered as a Chrome side panel. Every Module is an *Agent-first UI*: jointly operable by a human at the keyboard and by the Agent through Tools, against one live Environment, with zero backend.

The thesis, in the owner's words: **fully follow through on the agent-first idea — and at the same time demonstrate *why smart UIs are needed*.** The best agent experience is not a chat box. It is a set of smart, deterministic, jointly-operable surfaces — tables, graphs, forms, query builders, bulk grids — where the human and the Agent share every control and where *a perfect agent-first UI knows where AI stops*. The product is a showcase of that idea.

---

## 2. Why a rewrite

The current `main` build is, per the owner, "heavily vibe-coded, loosely wired together," and the [Codebase Atlas](./CODEBASE-ATLAS.md) confirms it precisely: ~48,250 LOC across six runtime surfaces, with **systematic gaps between what the docs claim and what the code does**. The rewrite is not a port; it is a **redesign at the surface and a salvage of the depth**.

**What is genuinely good (salvage as deep modules):** the 3-hop CORS bridge (MAIN-world same-origin `fetch`, no OAuth), the `DataverseClient` contract (`request`/`requestRaw`, best-tested file), `provider-adapters` (multi-provider transport, the AI "gem"), the ERD v2 thin-orchestrator + reactive-store *shape*, the Query model↔XML/codegen logic, the CMT/`$batch` engine, the Tool Registry confirmation model, and — the biggest salvage *miss* in the old plan — `operations/view-operation.js`, **a working Authoring precursor**.

**What is fiction or rot (do not carry forward):** the headline "Skills shared via Dataverse" feature **does not exist** (it is `chrome.storage.local` only); "28 Tools" is really **25**; the documented `search_entities` Tool doesn't exist (it's `get_entities`); ERD v2's flagship "channel-routed edges" is **dead code**; `destroy()` is never called (leak risk); Quick Clone writes to the live Environment **with no confirmation**; the DEV/TEST/PROD badge is an unreliable URL guess; three competing CSS regimes (~9.4K including a 4,488-line monolith and 1,201 lines of CSS-in-JS); a 2,091-line `app.js` god-spine; the bespoke JSON agent protocol with `repairJson`.

**And: the owner is dissatisfied with the current design/UX *and* code quality.** So the rewrite gets a fresh design system and a fresh component model on top, while the proven logic is lifted into clean **deep modules** (narrow interface, complex implementation hidden) behind it. The full reuse contract is the salvage catalog in [`REWRITE-FOUNDATIONS.md` §4](./REWRITE-FOUNDATIONS.md).

---

## 3. Who it serves & positioning

**Who.** The classical Power Platform / Dataverse developer — schema designer, query author, data-model maintainer, Web API consumer. The Agent collaborates with them across every Module; it is central to how the product works, not the user's identity.

**Verbs.** *Inspect, query, author, test, migrate* — against a live Environment, with the Agent participating in every verb.

**Unit of identity.** The connected **Environment**. The Workspace recontextualizes when the host page navigates to a different Environment; switching Environments switches everything (auth, schema cache, selection, Agent conversation). One Environment at a time (multi-Environment is parked).

**Differentiation.**

| vs. | How we differ |
|---|---|
| **XrmToolBox** | Mac/Linux parity, browser-delivered (no install), Agent-first across every Module, shared state across Modules. No plugin gallery / version skew. |
| **Level Up** | Multi-Module Workspace, not form-scoped. We complement, not replicate, its host-page God Mode. |
| **make.powerapps.com** | A broad substitute for the developer-facing surfaces (tables, columns, relationships, views, security, forms) reached through *Agent-driven Authoring*, not GUIs. Solution-scale Authoring, joint schema+data, Skill-mediated reuse. make's visual designers stay canonical for click-by-click form/canvas design. |
| **Microsoft CMT** | Agent-driven filters + mapping suggestions, runs against the live Environment, Solution- and schema-aware, browser-delivered. "CMT but on crack." |
| **MS Dataverse Skills (Claude Code / Copilot)** | A stateful, *visual* Workspace where Agent and human share every UI surface — they target the headless CLI/IDE loop. Complementary. **Our Skills live as Dataverse records bundled in Solutions** (see §9) — versioned and shipped with the org's customizations. |

---

## 4. Core doctrine

These are the non-negotiable principles every Module is built against.

### 4.1 Agent-first, never agent-only-to-reach *(the corrected doctrine)*

Every Module is **both**:
1. **directly usable via its own UI** — reachable and operable *without asking the Agent* (browse the schema, run a saved query, scan the role matrix, pan the ERD), and
2. **fully exposed to the Agent** — its state is readable (`getContext`), its meaningful actions are Tools, and the Agent can navigate the user to it.

The product is agent-first *in conception* and never agent-only *in reach*. This **overrides ADR-0002's** "Security → Agent-Tools-only" cut: a surface like the role matrix or a data explorer must be openable directly, *and* drivable by the Agent. "Invisible for data, visible for artifacts" still holds — the Agent surfaces results in chat for data queries and navigates to a Module when it produces a visual artifact — but the human can always open any Module directly.

### 4.2 Three interaction modes

Every capability is tagged with one mode (the design contract):
- **Agent-only** — invoked only through the Agent (may have a UI for visualization/confirmation). *No MVP Module is purely Agent-only* — the slot is reserved for future capabilities.
- **UI-led, Agent-augmented** — direct-manipulation UI is primary; the Agent can also drive/prefill/explain. Fully usable with no Agent configured. (Most Modules.)
- **Agent-led, UI-augmented** — the Agent orchestrates a multi-step flow; the UI shows diffs/progress and accepts interventions (approve/skip/edit/abort). (Authoring, Bulk Ops.)

### 4.3 Perfect agent-first UIs know where AI stops

Browsing entities, picking fields, running a saved query, paginating, following a lookup, panning a graph — these are deterministic visual operations and **never require chatting**. The Agent collaborates on synthesis, multi-step flows, and Authoring. Getting this boundary right is the core design challenge and the product's reason to exist.

### 4.4 Redesign the surface, reuse the depth

The rewrite replaces the UI/UX and the wiring wholesale, but reuses the proven logic as **deep modules** with narrow interfaces (see [`REWRITE-FOUNDATIONS.md` §4](./REWRITE-FOUNDATIONS.md)). New UI is never blocked on old UI; old logic is never shipped with its old surface attached.

### 4.5 Permanent constraints

- **BYOK** is permanent — users supply their own provider credentials; we never broker AI traffic through our backend (we have none).
- **One Environment at a time.**
- **Mac/Linux parity** — no Windows-only code paths.
- **No WYSIWYG designers** — no form/view/canvas/schema visual editors. Authoring goes through the Agent + Skills. make.powerapps.com remains canonical for visual design.
- **Extensibility = Skills**, not a plugin gallery.

---

## 5. Module roster

**12 Modules + 2 auxiliary surfaces.** Mode per §4.2. "Direct UI" = usable without the Agent (per §4.1). "Deep-module salvage" points at the reuse contract in [`REWRITE-FOUNDATIONS.md` §4](./REWRITE-FOUNDATIONS.md).

| # | Module | Mode | BYOK to *use* | Direct UI | Salvage |
|---|---|---|---|---|---|
| 1 | **Explorer** | UI-led | No | Yes | Tree model, virtual scroll, lazy load (light refactor) |
| 2 | **Query** *(+ Explore/Pivot)* | UI-led | No | Yes | QueryModel + codegen (split out); new Explore/Pivot surface absorbs Data Investigation |
| 3 | **Request Builder** | UI-led | No | Yes | requestRaw envelope, URL build/parse, codegens (rebuild on new shell) |
| 4 | **ERD** | UI-led | No | Yes | ERD v2 orchestrator+store (de-dead-code); A* router salvaged from v1 |
| 5 | **Form** | UI-led | No | Yes | FORM_INSPECT bridge, merge logic, bookmarks (light refactor; add bridge surface) |
| 6 | **Authoring** | Agent-led | **Yes** | Surface reachable; the *capability* needs the Agent | **view-operation precursor** generalized to the Approval-Flow engine |
| 7 | **Bulk Ops** | Agent-led | Core no / Agent-mapping yes | Yes (scope picker) | CMT/`$batch` engine, EntityBodyBuilder (lookup bug fixed); cut the wizard tangle |
| 8 | **Security** | UI-led | No | Yes | Privilege-resolution data layer → matrix-viz UI **and** Tools *(kept, not cut — overrides ADR-0002)* |
| 9 | **Agent Investigation** | UI-led | No to *view* past transcripts | Yes | Session/transcript model; may reuse the API-log capture backbone |
| 10 | **Skills** | UI-led | Browse/run no / Agent-assisted authoring yes | Yes | Skill model + system Skills; **Dataverse persistence built from scratch** (see §9) |
| 11 | **Agent Chat** | Transverse | **Yes** | Yes | Tool Registry/confirmation model; loop rebuilt on AI SDK 6 |
| 12 | **Settings** | UI-led | No (it's where BYOK is set) | Yes | Inline settings extracted; env-name display; safety config |
| — | **DevTools panel** *(auxiliary)* | dev surface | No | Yes | Live API-log tail; ring buffer + port backbone (light refactor) |
| — | **Popup** *(auxiliary)* | launcher | No | Yes | Status + side-panel launcher + quick actions (thin) |

Notes:
- **Data Investigation is folded into Query** as a second surface (*Build/Run* and *Explore/Pivot*); a Saved Query is a valid Explore starting point; a Saved Investigation = Saved Query + layout state. (Resolves the Query-vs-Investigation seam.)
- **Security stays** as a directly-reachable Module — the matrix visualization is the part Tool-call slices cannot replace — *plus* a data layer exposed as Tools. ADR-0002's agent-tools-only cut is reversed per §4.1.
- **Agent Investigation vs DevTools panel:** the DevTools panel is a Chrome-DevTools surface that tails *all* API traffic (dev debugging); Agent Investigation is the in-Workspace *retrospective audit of the Agent's own* transcript + mutations. Related backbone, distinct jobs. (Whether they share one capture layer is a minor open question, §13.)

---

## 6. Per-Module scope

Compact specs; depth lives in the Atlas (current behavior) and Foundations (reuse interfaces).

**1. Explorer** — Browse the Environment's schema (entities, attributes, relationships, keys, forms, views, Custom APIs, Solutions). The canonical "where AI stops" surface. Direct browsing standalone; Agent does synthesis (*"what's related to Case at depth 2"*). Tools: `get_entities`, `get_entity_metadata`, `get_optionset`. *(Note: Forms/Views sub-views are "coming soon" placeholders today — build for real.)*

**2. Query (+ Explore/Pivot)** — Read-only fetching via FetchXML/OData with multi-syntax codegen, built on the pure `QueryModel` (always generate from the model, never parse the textarea). Two surfaces: *Build/Run* (the query builder) and *Explore/Pivot* (a result grid that follows lookups and pivots to related records — absorbs Data Investigation). Saved Queries and Saved Investigations are first-class persisted artifacts *(neither exists today — build)*. *OData is currently output-only; pagination is modeled but not executed — both are build items.* Tools: `execute_fetchxml`, `execute_odata`, `get_record`, `build_query`, `explain_query`.

**3. Request Builder** — Craft arbitrary Web API HTTP requests; preview headers/body/response; generate code (JS, C#, Python, curl, Power Automate — *not* PowerShell/Node, contrary to old docs). Direct standalone; Agent does request synthesis + response explanation. *(`execute_request`/`explain_response` Tools don't exist yet — build.)*

**4. ERD** — Visualize the relationship graph (Solution-scoped or ad-hoc), dagre hierarchical layout on real entity sizes, color-by-parent, click-to-detail, pop-out, SVG/PNG export. **De-dead-code first:** remove the unreachable channel-router (~400 LOC), no-op field-visibility, unused crow's-foot markers; consolidate the forked DetailPanel. **Flip `show_erd`'s default from v1 to v2** before cutting v1. Salvage v1's A* orthogonal router + JSON-Schema export as free functions.

**5. Form** — Inspect the live model-driven-app form via `Xrm.Page` (Fields/Events/JSON/Tools sub-surfaces, env identity, bookmarks, quick clone). Read-only inspection is "where AI stops." **Add a Module Bridge surface (it has none today).** **Quick Clone becomes a gated write** (§8) — no more unguarded `api.create`. We do *not* replicate Level Up's host-DOM God Mode; mutation goes through Authoring.

**6. Authoring** *(differentiator)* — Create/modify schema (tables, columns, relationships, security roles, forms, views) through the Agent, never a WYSIWYG designer. **One uniform mode** (Agent-led, UI-augmented): the Agent proposes a step sequence; the UI shows a diff per step; the human approves/edits/aborts. A single op is a **one-step Approval Flow** (no mode switch the user can see); Solution-scale is a multi-step Approval Flow with dry-run. **Built on the salvaged `view-operation` engine** (propose → validate → diff → apply → re-read → revert/publish, with `xml-diff`), generalized from view-XML to the full metadata surface. Form/view *generation* is in scope; click-by-click editing is not. Requires the Agent.

**7. Bulk Ops** *(flagship — "CMT on crack")* — Move records between Environments (Configuration Migration), conditional mass-update, mass-delete. Direct scope picker (source/entity/filter) standalone; the Agent reviews scope, proposes filters, identifies cross-Environment ID remapping, surfaces schema diffs; dry-run with per-record diff; Approval Flow; `$batch` commit; result inspection with replay. **Salvage** the CMT XML engine + `buildBatchBody`/`parseBatchResponse` + `fetchAllRecords` + the scope-picker steps (which live inside the to-be-deleted `wizard-base.js` — extract first). **Fix the lookup-write bug** (`@odata.bind`, not `_value`). Cut the WizardBase stepper + 8 subclasses.

**8. Security** — Role-privilege matrix (entity × role with depth coloring), user permissions, field security. The **matrix visualization stays as a direct UI surface** (the irreplaceable part). The **privilege-resolution data layer** (two-call `RetrieveRolePrivilegesRole`/`RetrieveUserPrivileges`, prv-name parser, depth mapping, effective-perm roll-up) becomes a deep module feeding *both* the UI *and* new Tools (`who_can_X_on_Y`, `compare_role_privileges`, `show_field_security` — *none exist today; build*). Audit sub-surface folds into Query.

**9. Agent Investigation** — Retrospective audit of what the Workspace Agent did: a transcript of Tool calls, decisions, and mutations, with mutation diffs, replay, and per-Skill views. Viewing *past* transcripts does **not** require current BYOK (transcripts persist independently). Out of scope: auditing external agents (Foundry/Copilot Studio). This is also where the §8 write-safety transparency requirement ("what was applied, how") is satisfied.

**10. Skills** — Browse, run, edit, and share Skills (markdown + Agent-Tool links). System Skills ship with the product; User Skills are authored by users. **Persistence = Solution-bundled Dataverse records** (see §9). Absorbs the current Tool Builder (entity→tool-schema codegen). Browse/run works without BYOK; Skills that call the Agent obviously need it.

**11. Agent Chat** *(transverse)* — The conversational surface. From inside it, the Agent reads any Module's state, drives it through Tools, and navigates the user to it — but it is one Module among many, not the shell. Rebuilt on the hybrid agent core (§7, [ADR-0004](./adr/0004-agent-core.md)). Preserves the Tool Registry pattern, provider transport, session persistence, confirmation flow; drops the bespoke JSON protocol + `repairJson`. Quick Chat Bar (`Ctrl+I`) on every Module.

**12. Settings** — Theme, cache TTL, BYOK provider config, the **write-safety configuration** (§8), and the **Environment-name display** preference. Extracted from `app.js` into its own Module with validation + import/export.

---

## 7. The Agent

**Loop.** Rebuilt as a **hybrid** ([ADR-0004](./adr/0004-agent-core.md) / [`AGENT-CORE.md`](./AGENT-CORE.md)): **Vercel AI SDK 6 `ToolLoopAgent`** as the floor (native tool-calling with real tool-result roles, `stopWhen`/`stepCountIs`, `abortSignal`, `needsApproval` HITL), **one instance per `{envId, threadId}`** — which structurally fixes the context-bleed bug (messages can't load into the wrong thread/Environment). **LangGraph.js lazy-loaded only for Authoring & Bulk Ops** (durable/branching/HITL/replay), contingent on a Slice-0 bundle spike. The bespoke text-JSON protocol, `repairJson`, control-char escaping, and the 8000-char user-turn flattening are **deleted**. Streaming requires an offscreen-document SSE relay (the SW buffers today).

**Tools.** The Tool Registry + Executor split and the confirmation model are kept (gold). The corrected baseline is **25 Tools** (not 28); `search_entities` is `get_entities`; `ctx = {api, cache, log, bridge, skillManager}`. New Tools are added per Module (Query, Request Builder, Security, Authoring). The half-built "user-created executable tools" stub is dropped — user extensibility is **Skills**, not user-authored Tool handlers. Hollow navigation "Tools" that only switch Modules (`show_erd`, `show_security`, `load_*`) are reconsidered against §4.1 (the user can reach those Modules directly anyway).

**Context injection.** System prompt assembles: the Tool list, the Skills relevant to active Tools (fix the current always-inject-everything bug), the current Environment + selection, and the Module Bridge context (`buildContextForPrompt`). The Module Bridge is promoted to a **typed contract** (no `app._pageUrl` leak, one source of tab identity).

**Confirmation & safety** — see §8.

---

## 8. Write-safety & Environment model

The current build can write to the live Environment almost unguarded (`execute_action` = arbitrary HTTP, `execute_code` = `new Function()`, Quick Clone = no gate, the Snake easter-egg even POSTs schema), and the only "safety signal" is a URL-guessed PROD badge. The rewrite makes safety a coherent, *transparent* system — without blocking autonomous work, which the owner explicitly wants.

**1. Honest Environment identity.** Always display the **real Environment name** (and URL) from the org metadata — never a guessed DEV/TEST/PROD badge presented as authoritative. If a *reliable* environment-type signal is available from the API, show it labeled as authoritative; otherwise show the name and let the human judge. Guessing is worse than the truth.

**2. Capability tiers.** Every write Tool/action is tiered:
- **read** — no confirmation.
- **safe-write** (create/update records, add column, add option, etc.) — confirmation by default, **but session-level auto-approve is allowed** so the Agent can work autonomously (e.g. generate dummy data, create many columns).
- **dangerous** (delete, mass-delete, `execute_code`, arbitrary `execute_action`, publish-all, schema delete) — confirmation always; auto-approve is deliberate opt-in, never silent.

This maps directly onto the AI SDK's `needsApproval` (which accepts a function of the Tool input + context — verified), so the gate is data-driven, not hand-rolled.

**3. Transparency is the contract.** Because auto-approve is allowed, it must be **impossible to misunderstand the current configuration or what was done**:
- a persistent, always-visible indicator of the session's auto-approve state, bound to the named Environment ("auto-approving *safe-writes* on **contoso-dev**");
- a complete, inspectable record of **what was applied and how** — this is the Agent Investigation transcript (§6.9), with mutation diffs.

**4. No unguarded writes anywhere.** Quick Clone, the Snake table-creation easter-egg, and every other write route through the same tiered gate. There is no write path that bypasses the safety system.

---

## 9. Skills model

Skills are the extensibility mechanism (per §4.5). The current implementation persists to `chrome.storage.local` only — **the "shared via Dataverse" story is fiction and must be built**.

**Decision: Skills persist as Solution-bundled Dataverse records.** A Skill is a Dataverse record (markdown body + frontmatter + linked Agent-Tool ids) in a custom table. Skills are **packaged inside Solutions** and travel via standard ALM export/import — versioned with the org, shipped with the rest of the customizations. This honors the "shared via Dataverse" positioning *without* inventing a bespoke sharing/permission layer — it reuses the Solution mechanism the developer already lives in.

- **System Skills** ship with the product (the current four + more).
- **User Skills** are authored in-Module (markdown editor + Tool picker), saved as records, and shared by adding them to a Solution.
- Browse/run works without BYOK; AI-driven Skills need it.
- **MVP vs v1.1:** MVP ships browse + run + create + the Solution export/import path. Richer authoring/sharing UX can follow (cut-order, §12).
- The detailed ownership model (personal vs team vs Solution-bundled, security roles, versioning) and the Skill table schema are the one genuinely hard-to-reverse fork left → **ADR-0006** (§13).

Also fix the salvaged bugs: `importFromMarkdown` drops linked Tools (array-vs-object), and the relevance filter never narrows (full Tool list passed in).

---

## 10. Technical foundations *(decided: Path A)*

The full analysis is in [`REWRITE-FOUNDATIONS.md`](./REWRITE-FOUNDATIONS.md); the verified decisions:

| Concern | Decision |
|---|---|
| **Build step** | **Yes — minimal Vite build.** Reverses ADR-0001's "no build step." Unlocks the stack below. *(Owner-approved.)* |
| **Agent core** | **Hybrid (decided in [ADR-0004](./adr/0004-agent-core.md) / [`AGENT-CORE.md`](./AGENT-CORE.md)).** Vercel AI SDK 6 `ToolLoopAgent` as the robust floor (deletes the bespoke protocol + `repairJson`; native tool roles; `needsApproval` ↔ §8; one instance per `{envId, threadId}` — the structural context-bleed fix), **+ LangGraph.js lazy-loaded only for Authoring & Bulk Ops** (durable/branching/HITL, contingent on a Slice-0 bundle spike; fallback = AI-SDK agents-as-tools). Three-layer scoped state. **QuickJS-WASM code interpreter** (Pyodide cut). **MCP deferred to v1.1**, registry kept MCP-ready. *Supersedes this row's earlier "Vercel AI SDK 6 only" pick (made under the dropped minimal-complexity target).* |
| **UI rendering** | **Lit 3** web components — declarative render + scoped styles; ~6kB, eval-free; near-1:1 with the current "Module class with `render()`" mental model. |
| **CSS / design system** | **Keep `themes.css` token layer verbatim** (~176 tokens, the one good asset); rebuild everything else as per-Module Shadow-DOM scoped styles + a small shared primitives sheet. Tokens pierce Shadow DOM **only if `[data-theme]` stays on a light-DOM ancestor** — written into the contract. Kills the 3 competing CSS regimes. |
| **State + Bridge** | A tiny **signals** Workspace store (env-namespaced — fixing the stale-cache risk) + the Module Bridge promoted to a **typed contract**. |
| **Build tooling** | **Vite**, with **`page-extractor.js` kept *unbundled* as a static asset** to dodge the verified CRXJS `world:MAIN` footgun (issue #695). Bundler (CRXJS vs WXT vs esbuild script) is an implementation detail decided at slice 0; the service worker **must stay an ES module** after bundling. |
| **Provider transport** | **Keep the SW `EXTERNAL_REQUEST` proxy**; wire the AI SDK to a **custom `fetch`** that routes through it (the side-panel origin is CORS-blocked from providers — non-negotiable). Salvage `provider-adapters`' Responses-API knowledge (reasoning effort, `web_search`, `url_citation`) — verify each has an SDK equivalent *before* deleting the file. |

**Salvage as deep modules** (reuse contract): CORS transport, `DataverseClient`, `QueryModel`+codegen, ERD layout, CMT/`$batch` engine, Tool Registry/Executor, Module Bridge, the Authoring (`view-operation`) engine, metadata cache (resurrect env-namespacing from the dead shared cache), entity→tool-schema codegen. Strip the dead bearer-token subsystem, the CSS-in-JS, `system-prompts.js`, ERD v1, Record Viewer, the dead Code Editor. Full interfaces in [`REWRITE-FOUNDATIONS.md` §4](./REWRITE-FOUNDATIONS.md).

**Known risks to design out** (from the foundations + agent-core critiques): the CRXJS MAIN-world footgun (mitigated above); SW-must-stay-ESM after bundling; `[data-theme]` must live on a light-DOM ancestor; verify Responses-API features map onto the SDK before deleting `provider-adapters`; lint the bundle for transitive `eval`/`new Function` against MV3 CSP. **Agent-core additions (ADR-0004):** the manifest has **no CSP key** today — add `extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` before any WASM (the code interpreter is blocked without it); streaming needs an offscreen-document SSE relay (the SW buffers today); fix the `findDynamicsTab` multi-tab mis-routing before trusting `envId` as the isolation root; move auto-approval state per-thread.

---

## 11. Scope

**In:** schema browsing; FetchXML/OData query + explore/pivot + codegen; raw Web API testing; ERD visualization; live form inspection; Agent-driven Authoring (incl. form/view generation) at single-op and Solution scale; "CMT on crack" config migration + bulk record ops; security inspection (matrix + tools); Agent Investigation; Skills (Solution-bundled Dataverse records); the BYOK Agent across every Module.

**Out (forecloses):**
- No installable third-party **plugin** platform — capabilities extend via Skills + Tools.
- No release/**ALM** tool (solution packaging, env promotion, CI/CD) — stays with `pac`/pipelines/PPAC. *(Skills ride ALM export/import, but we don't build the pipeline.)*
- No **citizen-developer** surface — the user can read schema names, GUIDs, FetchXML, OData, JSON.
- No **WYSIWYG** designers (form/view/canvas/schema).
- No **hosted AI** / backend-brokered calls — BYOK only.
- No **multi-Environment** Workspace in MVP (parked).
- No **external-agent** auditing in Agent Investigation.

---

## 12. Phasing — tracer-bullet slices

Vertical slices, each shippable and proving the architecture end-to-end before breadth.

- **Slice 0 — Foundations (spine).** Vite/MV3 build (page-extractor unbundled), Lit shell, signals Workspace store, themes.css tokens + Shadow DOM, `DataverseClient` over the kept CORS transport (token theater stripped), env-namespaced MetadataCache, typed Module Bridge. No features — the spine.
- **Slice 1 — Explorer.** First Module end-to-end on the spine: direct UI + bridge + metadata Tools.
- **Slice 2 — Agent Chat + loop + safety.** AI SDK 6 loop, Tool Registry/Executor, the §8 capability-tier + `needsApproval` + transparency model. Proves the Agent drives Explorer.
- **Slice 3 — Query (+ Explore/Pivot).** The primary work surface; QueryModel + codegen + saved artifacts.
- **Slice 4 — Request Builder.** **Slice 5 — ERD v2** (de-dead-coded). **Slice 6 — Form** (gated clone, bridge added).
- **Slice 7 — Authoring.** The differentiator; `view-operation` engine generalized; Approval Flow.
- **Slice 8 — Bulk Ops.** Flagship; CMT/batch core salvaged, lookup bug fixed.
- **Slice 9 — Security.** Data layer → matrix UI + Tools.
- **Slice 10 — Skills.** Dataverse records + Solution import/export.
- **Slice 11 — Agent Investigation.** Transcript audit (satisfies §8 transparency); reuse API-log backbone.
- **Slice 12 — Settings** (extracted; env-name + safety config). Auxiliary DevTools panel + Popup carried over (light refactor).

**MVP = the 12 Modules.** **Cut-order under velocity pressure** (defer in this order): (1) Query *Explore/Pivot depth* → v1.1; (2) Skills *rich authoring/sharing UX* → v1.1 (browse/run + Solution import/export stay in MVP); (3) Agent Investigation *depth* (replay, per-Skill, diffs) → v1.1 (basic transcript stays). **Non-deferrable:** Authoring, Bulk Ops, Agent Chat, Security, the spine.

---

## 13. Open forks → remaining ADRs

Only genuinely hard-to-reverse **technical** decisions remain as ADRs (everything product-level is in this PRD):

- **ADR-0004 — Agent core. ✅ Decided** ([`adr/0004-agent-core.md`](./adr/0004-agent-core.md), full design in [`AGENT-CORE.md`](./AGENT-CORE.md)): hybrid (AI SDK 6 floor + LangGraph for Authoring/Bulk Ops), QuickJS code interpreter (Pyodide cut), MCP deferred to v1.1, three-layer scoped state. Remaining sub-items: two Slice-0 spikes (LangGraph bundle, WASM-CSP); provider-options mapping for Responses-API features; bundler pick (CRXJS / WXT / esbuild).
- **ADR-0005 — Workspace shell architecture.** Module lifecycle contract (render/destroy/onHide/get/setContext — and actually *call* `destroy()`), signals store shape, Bridge wiring, dev HMR.
- **ADR-0006 — Skill ownership / sharing model.** The Skill Dataverse table schema; personal vs team vs Solution-bundled; security roles; versioning.

Smaller open questions (not ADR-worthy): whether Agent Investigation and the DevTools panel share one capture backbone; the exact reliable source (if any) for authoritative Environment-type.

---

## 14. Document lineage

- **This PRD** — living source of truth for product direction. Supersedes ADR-0001 + ADR-0002.
- [`CONTEXT.md`](../CONTEXT.md) — the glossary (vocabulary is load-bearing). Stays separate; edited as terms sharpen.
- [`CODEBASE-ATLAS.md`](./CODEBASE-ATLAS.md) — verified ground truth of the current `main` build (salvage ledger, discrepancy table).
- [`REWRITE-FOUNDATIONS.md`](./REWRITE-FOUNDATIONS.md) — UI/CSS/build/transport stack + deep-module reuse contract (its agent-orchestration line is superseded by ADR-0004).
- [`AGENT-CORE.md`](./AGENT-CORE.md) + [`adr/0004-agent-core.md`](./adr/0004-agent-core.md) — the decided agent core.
- `docs/adr/0001`, `docs/adr/0002` — superseded; retained for history.
- `docs/adr/0004`, `0005`, `0006` — to be written for the hard technical forks above.

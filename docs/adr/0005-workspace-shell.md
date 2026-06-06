# ADR-0005: Workspace shell — Module lifecycle, signals store, typed Bridge

## Status

Accepted (2026-06-06). Records the shell architecture the rewrite's Slice 0 (spine) builds on. Implements [`PRD.md` §10](../PRD.md) (State + Bridge row) and [§12](../PRD.md) (Slice 0), the state-model half of [`DESIGN-CONCEPT.md`](../DESIGN-CONCEPT.md) §2/§9, and shares the stateless-runner invariant with [ADR-0004](./0004-agent-core.md). Does **not** decide the visual/accent or exact shell layout — that is ADR-0003 (UX).

## Context

Three forces shape the shell:

1. **The current build has no real lifecycle.** Modules are cached singletons; `render()` rebuilds DOM from scratch each activation; `destroy()` is defined but **never called** (Atlas §7/§9). Shared Workspace state (selection, schema cache, connection) lives ad-hoc in `app.js` — the *non*-namespaced MetadataCache survived while the env-namespaced one died, which is one root of the context-bleed bug ADR-0004 fixes.
2. **The interaction model needs a single source of truth per anchor.** DESIGN-CONCEPT §2 fixes the Workspace on three anchors — **Environment** (where), **Focus** (shared subject, human + Agent), **Control/the wheel** (who drives + autonomy). The prototype rendered three competing affordances for this trio; the shell must make duplication structurally impossible.
3. **The stack is decided** (PRD §10 / ADR-0004): Lit 3 Modules, a signals Workspace store, a typed Module Bridge, Shadow-DOM scoping over the kept `themes.css` tokens, Vite build. ADR-0005 turns those picks into a lifecycle + state contract.

## Decision

**1. The shell owns the three-anchor status strip — once, at the top.** It is shell chrome, not Module chrome: rendered exactly once, fed purely by the Workspace store, and **Modules cannot render or mutate the anchors**. This makes the prototype's three-competing-variants failure impossible by construction. (Owner decision, 2026-06-06.) A Module may surface *local* detail in its own body (e.g. ERD "3 of 124 tables selected") but never the anchors themselves.

**2. Module lifecycle = evict + rehydrate from the store; `destroy()` actually runs.** (Owner decision, 2026-06-06.) Each Module is a Lit custom element. Switching away **unmounts** the inactive Module (removed from the DOM → `disconnectedCallback`), which **is** the `destroy()` hook — timers, listeners, observers freed every time. Switching back **mounts a fresh element** that rehydrates its view from its env-namespaced store slice. **Persistent view-state lives in the store, never in element fields**, so unmount loses nothing; the element is a pure projection of its slice (the ERD-v2 thin-orchestrator-over-reactive-store shape, generalized). **Heavy Modules opt into keep-warm**: they stay mounted-but-hidden and receive `onHide()`/`onShow()` instead of unmount/remount (ERD is the first; the keep-warm set is an explicit, small allowlist, not the default).

**3. A tiny signals Workspace store, env-namespaced, in three layers** (aligned with ADR-0004's scoped-state model):

| Layer | Owner | Holds | Keyed by |
|---|---|---|---|
| **Shell store** *(this ADR)* | shell | `environment` (honest org identity), `focus` `{moduleId, subject}`, `control` `{holder, autonomy}`, `activeModule`, per-Module view-state slices | `envId` |
| **MetadataCache** | shell | entities/attributes/relationships/optionsets (TTL) — resurrects the dead env-namespacing | `envId` |
| **ConversationStore** *(ADR-0004)* | agent core | messages, system prompt, `autoApprovals`, Bridge snapshot | `{envId, threadId}` |

Reactivity is `@lit-labs/signals` / `@preact/signals-core` (~1–2 kB), no framework store. The status strip, every Module, and `buildContextForPrompt()` all read the **same** shell store — the human and the Agent share one Focus, one wheel, one truth.

**4. Control/the wheel is shell-owned signal state with a one-holder invariant.** `control.holder ∈ {human, agent}` with exactly one holder at a time; `control.autonomy ∈ {manual, auto-safe}` is a *modifier on the same anchor*, not a separate element. Hand-off is explicit and symmetric (DESIGN-CONCEPT §2): human request → Agent takes wheel → acts on shared Focus → raises Approval on the same Module for writes → yields; human can grab the wheel at any instant (Agent pauses, holds plan). Dangerous ops (publish/delete) are **never** auto-approved regardless of autonomy. Auto-approval scope is per-`{envId, threadId}` and lives in the ConversationStore (ADR-0004), surfaced through this anchor.

**5. The Module Bridge is a typed contract over the store — the `_pageUrl` leak is severed.** `getModuleState(moduleId) → ctx` (calls the live Module's `getContext()`), `navigateAndConfigure(moduleId, ctx)` (sets `activeModule` + the Module's `setContext()`), `buildContextForPrompt() → string` (reads the shell store, **not** private `app._pageUrl`). Environment/page identity is derived from `environment` in the store; the duplicated tab-label table collapses into the Module registry as the single source of tab identity. The Bridge **re-snapshots** rather than live-reading shell internals (ADR-0004's isolation invariant).

**6. Dev HMR preserves the store.** Vite HMR swaps Module element definitions in place; the shell store is held in a module-level singleton stashed on `import.meta.hot.data` so an HMR cycle re-renders Modules without losing Workspace state. The service worker reloads as a unit (no HMR); `page-extractor.js` stays unbundled (PRD §10).

## Alternatives considered and rejected

- **Keep all Modules mounted (hidden).** Instant switching and preserved DOM/scroll, but more memory and — fatally — Module DOM becomes a *second* source of truth that drifts from the store. That is the current singleton model that the context-bleed bug grew in. Rejected; the store-is-truth contract is the robustness fix. (Keep-warm for heavy Modules is the *bounded* exception, not the default.)
- **LRU keep-warm(N) as the global policy.** A reasonable feel/memory compromise, but an eviction policy is an extra always-on concept for a side panel with ~12 Modules where rehydrate-from-signals is already near-instant. Rejected as the default; kept only as the explicit heavy-Module allowlist.
- **Per-Module status strip / hybrid shell+local anchors.** Rejected (owner): re-admits the drift/duplication the three-anchor model exists to kill.
- **Zustand / Redux-style store.** Rejected (PRD §10): heavier than signals and redundant with Lit's own reactivity.
- **EventBus-only coupling (status quo).** Rejected as the *sole* mechanism: manual subscription wiring is the current coupling source; signals replace it.

## Consequences

**Commits us to:**
- **`destroy()` is non-optional and the default path** — every tab switch exercises unmount/cleanup, so Modules must hold zero persistent state outside their store slice. This is the same stateless invariant ADR-0004 requires of the Agent runner; the two share one discipline.
- **Every Module is a pure projection of its store slice** — the deep-Module reuse contracts (REWRITE-FOUNDATIONS §4) must expose view-state into the store, not retain it internally (ERD-v2 already does; others must be adapted on salvage).
- **The keep-warm allowlist is a maintained surface** — adding a Module to it is a deliberate, reviewed call (cost: memory + a live element that can drift), not a default.
- **One source of tab/Module identity** — the Module registry; the old `ALL_TABS` / `TAB_LABELS` / `navigate_module`-description triple-source is collapsed.
- **`findDynamicsTab` multi-tab mis-routing must be fixed before `envId` is trusted** as the store key (shared prerequisite with ADR-0004).

**Forecloses:**
- No Module-owned status anchors; no second source of truth in Module DOM.
- No multi-Environment Workspace in MVP (PRD §11) — the store is single-`envId`-scoped now, but env-namespaced *keys* leave the door open without a rewrite.

**Open follow-ups:**
- **ADR-0003 (UX)** locks accent + exact shell layout (rail width, dock collapse) — this ADR fixes only the state/lifecycle skeleton beneath it.
- Motion/transition policy for mount/unmount and Agent hand-off (DESIGN-CONCEPT §9).
- A companion `SHELL.md` design doc (as `AGENT-CORE.md` backs ADR-0004) — **decided: yes** (owner, 2026-06-06); authored when Slice 0 implementation starts.
- Validated against the spine in **Slice 0**; revise here if the signals-rehydrate cost on a real heavy Module forces a wider keep-warm set.

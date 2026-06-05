# Self-Handoff: Dataverse Toolkit rewrite — continue after /clear

**Date:** 2026-06-04 · **Repo:** `C:\Users\jwald\CodeReps\DataversePlugin` · **Branch:** `main` · **Anchor commit:** `d0a4209`

You (a fresh Claude Code session) are continuing your *own* prior work with this owner. The session got long (~400k tokens); the owner is `/clear`-ing and handing you this. Everything below is committed and consistent — start from the docs, not from scratch.

---

## What this is

A **greenfield rewrite** of a Chrome MV3 side-panel developer tool for Dynamics 365 / Power Platform ("Dataverse Toolkit"). The current `main` build is "vibe-coded"; `src/` is the **OLD build, untouched** — kept as reference until cutover. **No rewrite code has been written yet.** This session was **docs/architecture-first**: we produced the product + architecture spec set, all committed. Next is more architecture ADRs, then implementation in vertical slices.

## Read these first (committed, in this order)

1. **`docs/PRD.md`** — THE source of truth. Product thesis, 12-Module roster, doctrine (§4), per-Module scope (§6), the Agent (§7), write-safety (§8), Skills (§9), tech foundations (§10), scope (§11), phasing/slices (§12), open ADR forks (§13). Supersedes ADR-0001 + ADR-0002.
2. **`CONTEXT.md`** — glossary. **Vocabulary is load-bearing** (Workspace, Module, Agent, Agent-first UI, Agent Tool, Skill, Authoring, Query, Investigation, Bulk Ops, Solution-scale, BYOK). Never *tab/wizard/AI/chatbot/plugin*.
3. **`docs/adr/0004-agent-core.md`** + **`docs/AGENT-CORE.md`** — the decided agent core (read before touching anything agent-related).
4. **`docs/CODEBASE-ATLAS.md`** — verified ground truth of the *current* build (salvage ledger §8, code-vs-docs discrepancy table §9). Use it; the old CLAUDE.md/README numbers are wrong (25 tools not 28; `get_entities` not `search_entities`; ~48K LOC not 36.5K; etc.).
5. **`docs/REWRITE-FOUNDATIONS.md`** — UI/CSS/build/transport stack + deep-module reuse contract (§4). Has a "partially superseded" banner: its *agent-orchestration* line is superseded by ADR-0004; everything else stands.
6. `docs/adr/0001`, `0002` — superseded (banners point to PRD); historical only.

## Decisions locked this session — do NOT reopen

- **Doctrine:** agent-first but **never agent-only-to-reach** — every Module is *both* directly UI-usable *and* agent-drivable. (This overruled ADR-0002's "Security → agent-tools-only".) Thesis: "fully follow through on agent-first AND show why smart UIs are needed."
- **Module roster:** 12 Modules + 2 auxiliary surfaces (DevTools panel, Popup — both real, were undocumented). Data Investigation folded into **Query** (Build/Run + Explore/Pivot). **Security kept** (matrix-viz UI + data-layer-as-tools). Authoring is **one mode** (Approval Flow; single-op = degenerate one-step).
- **Skills persistence:** Solution-bundled **Dataverse records** (ALM export/import) — the current "shared via Dataverse" is *fiction* (chrome.storage.local only); build it. → ADR-0006.
- **Write-safety (§8):** always show the **real Environment name** (no guessed PROD badge); capability tiers (read / safe-write / dangerous); **session-level auto-approve is wanted** for autonomous runs; **full transparency** of what's auto-approved + what was applied (ties to Agent Investigation transcript).
- **Build step: YES** (owner accepted; reverses ADR-0001's no-build).
- **Agent core (ADR-0004):** **hybrid** = AI SDK 6 `ToolLoopAgent` floor (one instance per `{envId, threadId}` = structural context-bleed fix) + **LangGraph.js lazy for Authoring & Bulk Ops only** (contingent on Slice-0 bundle spike; fallback agents-as-tools). **QuickJS-WASM code interpreter** (Pyodide **cut**). **MCP deferred to v1.1** (keep registry MCP-ready). Three-layer scoped state.
- **Doc format:** central PRD absorbs ADR-0001/0002; ADRs only for hard tech forks; CONTEXT.md stays glossary.

## What's next (not started)

- **ADR-0005 — Workspace shell architecture:** Module lifecycle (render/destroy/onHide/get/setContext — and actually CALL `destroy()`, never called today), signals store shape, Bridge wiring, dev HMR.
- **ADR-0006 — Skill ownership/sharing:** Skill Dataverse table schema; personal vs team vs Solution-bundled; versioning.
- **Two Slice-0 spikes (gating, per ADR-0004):** (a) LangGraph.js bundle/`eval`-audit via `vite build`; (b) WASM-under-MV3-CSP smoke test — **manifest has NO `content_security_policy` key today; must add `extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` before any WASM.**
- Then **implementation** per PRD §12 tracer-bullet slices: Slice 0 (spine: Vite/MV3 build, page-extractor unbundled, Lit shell, signals store, DataverseClient over the kept CORS transport with token-theater stripped, env-namespaced MetadataCache, typed Bridge) → Slice 1 Explorer → Slice 2 Agent Chat+loop+safety → … → Authoring, Bulk Ops, Security, Skills.
- **Engineering must-dos baked into ADR-0004** (not optional): fix `findDynamicsTab` multi-tab mis-routing before trusting `envId`; per-thread `autoApprovals`; re-snapshotting Module Bridge; offscreen-doc SSE relay for streaming; MemorySaver→chrome.storage checkpointer.

## Parallel track — DON'T touch unless asked

The owner is running a **separate UI/UX prototyping session** (throwaway fake UIs at `C:\tmp\dvt-proto\`; round-2 brief at `C:\Users\jwald\AppData\Local\Temp\dataverse-toolkit-prototype-handoff.md`). That's their track for design feedback (Shell A = base, etc.). It informs the eventual UX (ADR-0003 territory) but is independent of your architecture work.

## How we work

- **Ultracode is ON** — use the **Workflow** tool for substantive research/analysis (this session's PRD/atlas/agent-core all came from background workflows: fan-out research → Opus synthesis → adversarial critic → verify claims against source). Token cost is not the constraint; correctness is. - I heavily correct (Jo), we are always running in usage limits. we must work with opus from now on only if absolutely necessary and let especially all code tasks and research be done by sonnets or even haikus, with clear context window and specific instructions they are able to execute fine
- **Language:** owner writes German, wants German answers. Project docs stay English (for consistency).
- **Style:** terse, high autonomy, premium bar, examples-are-ground-truth (owner's working examples/preferences beat training knowledge). Put genuine owner-only forks via AskUserQuestion with a recommended first option; bake in the obvious engineering calls yourself.
- **Memory:** auto-memory at `…\memory\MEMORY.md` is loaded each session; consider adding a `project_*` entry capturing the PRD/agent-core decisions if not present.

## Gotchas / caveats

- The **first** foundations workflow (Opus synthesis) had 15/16 research agents fail StructuredOutput → its conclusions were under-verified; a **Sonnet re-run** (research agents on `model:'sonnet'` + a "MUST call StructuredOutput" nudge + web-search cap) ran clean. Lesson: for schema-output fan-outs, Sonnet research agents are more reliable; keep the nudge + search cap.
- The committed `REWRITE-FOUNDATIONS.md` is the *first* run's text (with a superseded banner). The richer/verified deep-module catalog lives in the Sonnet/agent-core task outputs under the session's `…\tasks\*.output` if ever needed.
- The original task that started all this — an orchestrator handoff to *grill ADR-0002* (`…\Temp\dataverse-toolkit-handoff-phase2-grill.md`, with a "definition of done" = result summary + commit "Docs: Phase 2 grill") — was **superseded** when the owner redirected to "understand the code first → central PRD." Don't resurrect that DoD; the work is captured in the PRD instead.

## Suggested skills for the next stretch

- **`write-a-skill`** / project skills as needed; **Workflow** for any ADR-0005/0006 research; **`prototype`**/**`frontend-design`** only if the owner pulls UI work into your track.

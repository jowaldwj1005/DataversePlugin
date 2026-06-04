# ADR-0004: Agent core — hybrid framework, QuickJS code interpreter, scoped state

## Status

Accepted (2026-06-04). Full architecture in [`docs/AGENT-CORE.md`](../AGENT-CORE.md). This ADR records the *decision and its trade-offs*; the reference doc carries the design detail. Supersedes the agent-orchestration line of [`PRD.md` §10](../PRD.md) and [`REWRITE-FOUNDATIONS.md` §1](../REWRITE-FOUNDATIONS.md).

## Context

The PRD reserved the agent framework as a hard-to-reverse technical fork (ADR-0004). Three forces converged:

1. **The current agent state machine is broken** — conversation messages bleed into the wrong context on Environment/Module switch (Atlas §7; verified three-vector cause: un-namespaced `SessionManager`, never-destroyed `AgentRunner` singleton, live-read Module Bridge). Robustness here is non-negotiable.
2. **The owner reset the optimization target** from "minimal complexity" (which had pointed PRD §10 at Vercel AI SDK 6 alone) to **most-robust core + maximum agentic capability + showcase/learning**, with a build step accepted.
3. **Two new directions** were put on the table: a **code interpreter** for the Agent, and an **MCP** mechanism.

Research (the `agent-core-research` workflow: 8 Sonnet research agents + Opus synthesis + an adversarial critic that verified claims against source) produced a recommendation; the owner then made the three taste-level calls below.

## Decision

**A hybrid agent core:**

- **Vercel AI SDK 6 `ToolLoopAgent` as the primary loop**, instantiated **once per `{envId, threadId}`**. Deletes the bespoke text-JSON protocol + `repairJson`; native tool-result roles; `needsApproval` maps onto the §8 capability tiers. Per-instance message isolation is the *structural* fix for the context-bleed bug.
- **LangGraph.js as a lazy-loaded durable substrate for Authoring + Bulk Ops only** (`StateGraph` + checkpointer + `interrupt`), **contingent on a Slice-0 bundle spike** (fallback: AI SDK 6 agents-as-tools). The two Agent-led Modules are genuinely multi-step / HITL-resumable / branching; everything else stays on the lighter floor.
- **Three-layer scoped state** (per-Environment `MetadataCache` · per-`{envId, threadId}` `ConversationStore` carrying messages + system-prompt + **autoApprovals** + Bridge snapshot · a re-snapshotting Module Bridge). Isolation is a structural invariant.
- **QuickJS-WASM code interpreter** (asyncified, pooled Web Worker) replacing the CSP-dead `new Function()` path; a restricted **method-allowlist** Dataverse bridge; code-originated writes routed through the same `needsApproval` gate. **Pyodide is cut.**
- **MCP deferred to v1.1**; the Tool Registry `{id, params, executor}` contract is kept clean so MCP (client, then companion server) is purely additive.
- **Provider transport unchanged** (SW `EXTERNAL_REQUEST` proxy + injected custom `fetch`), with a required **offscreen-document SSE-passthrough upgrade** for streaming.

**Owner decisions (2026-06-04):** (1) hybrid framework — *yes*; (2) code interpreter — *QuickJS now, Pyodide cut*; (3) MCP — *defer all to v1.1, keep registry MCP-ready*.

## Alternatives considered and rejected

- **AI SDK 6 only (agents-as-tools for Authoring/Bulk Ops).** The right call under the *old* minimal-complexity target (and the PRD §10 original). Rejected for the reset max-power target: no first-class durable/branching/HITL/replay for the two Modules that most want it. Remains the **fallback** if the LangGraph bundle spike disappoints.
- **Full LangGraph.js everywhere.** Rejected: graph ceremony (nodes/edges/checkpointer) for the ~80% of Tools that are single request/response; heaviest bundle; AI SDK 6 already fixes the two root bugs at a smaller concept count.
- **Mastra.** Rejected: server-first storage reintroduces the forbidden backend; unverified MV3 fit. (It runs AI SDK under the hood, so AI SDK now is the on-ramp if ever relevant.)
- **Pyodide (Python/pandas) code interpreter.** Rejected (cut, not just deferred): the analytical jobs are served by FetchXML aggregates / OData `$apply` server-side or QuickJS-JS; ~6-20 MB WASM + 150-350 MB session heap + dual-interpreter lifecycle is a demo, not a workflow. Revisit only on a concrete pandas-needing user story.
- **Multi-agent supervisor, companion MCP server now, time-travel replay.** Deferred as someday-maybe — power without present product demand for a one-developer tool.

## Consequences

**Commits us to:**
- A **build step** (already accepted): AI SDK + LangGraph ship as bundled npm deps; `page-extractor.js` stays unbundled (MAIN-world IIFE).
- **Prerequisites before any WASM:** add `content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"` to the manifest (currently absent — dagre is pure JS, so the "already there" premise was false), then a **WASM-in-MV3 smoke spike**.
- **Two Slice-0 spikes** gate commitments: the LangGraph bundle/`eval`-audit spike, and the WASM-CSP spike.
- **The robustness fix is non-deferrable** and independent of LangGraph: `{envId, threadId}` keying, stateless runner, re-snapshotting Bridge, per-thread `autoApprovals`, and the `activeEnv↔tab` binding fix (the `findDynamicsTab` multi-tab mis-routing must be fixed before `envId` can be trusted as the isolation root).
- **Streaming** requires an offscreen-document SSE relay (the SW buffers today); more than a trivial change.
- **Checkpointer:** `MemorySaver` for MVP, a `chrome.storage.local` adapter as fast-follow; no LangGraph state ever runs in the (idle-killed) SW.

**Forecloses:**
- No bespoke JSON agent protocol / `repairJson`.
- No Python-in-panel (Pyodide) in MVP or v1.1 absent a concrete need.
- No MCP in MVP (registry kept ready).

**Open follow-ups:** ADR-0005 (Workspace shell + Module lifecycle — the never-called-`destroy()` fix is shared with this ADR's stateless-runner requirement); the two Slice-0 spikes; MCP client/server design when v1.1 scopes it.

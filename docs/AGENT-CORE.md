# Agent Core Architecture — Dataverse Toolkit

> **Status: decided (2026-06-04), recorded in [ADR-0004](./adr/0004-agent-core.md).** Reference doc for the rewrite's agent core. It **supersedes the agent-orchestration line** of [`PRD.md` §10](./PRD.md) and [`REWRITE-FOUNDATIONS.md` §1](./REWRITE-FOUNDATIONS.md); everything else there (Lit, themes.css token layer, signals Workspace store, Vite build, SW transport, the deep-module salvage catalog) stands.
>
> **Optimization target (owner-reset):** most-robust core + maximum agentic capability ("heavy agent shit") + showcase/learning value. A build step is accepted. Minimal-complexity is *not* the goal — but the critique's over-engineering cuts (below) still apply: power is added only where the product uses it.
>
> **Grounding:** [`CODEBASE-ATLAS.md`](./CODEBASE-ATLAS.md) (verified ground truth), [`PRD.md`](./PRD.md) (product). Glossary: [`CONTEXT.md`](../CONTEXT.md) — Workspace, Module, Agent, Agent Tool, Skill, Authoring, Bulk Ops, Solution-scale, BYOK. Never *tab/wizard/AI/chatbot/plugin*.

---

## 1. The core — one coherent stack

| Layer | Decision | Why |
|---|---|---|
| **Agent loop (floor)** | **Vercel AI SDK 6 `ToolLoopAgent`**, one instance per `{envId, threadId}` | Deletes the bespoke text-JSON protocol + `repairJson` + control-char escaping + the 8000-char user-turn flattening; native tool-result roles. **Per-instance message isolation structurally fixes the context-bleed bug.** `needsApproval` maps 1:1 onto the §8 capability tiers. Robust floor for the ~80% of Tools that are single request/response (Explorer, Query, Request Builder, ERD, Form, Security, Skills). |
| **Durable orchestration (ceiling)** | **LangGraph.js `StateGraph` + checkpointer, lazy-loaded — Authoring & Bulk Ops only** | The two Agent-led Modules (PRD §6.6/§6.7) are multi-step, HITL-resumable, branching, Solution-scale. LangGraph's `interrupt`/`update_state` HITL, per-superstep checkpointing, and subgraph composition are first-class. **Contingent on the Slice-0 bundle spike** (§6); fallback = AI SDK 6 agents-as-tools. |
| **State / context isolation** | **Three-layer scoped store** (§2) | Per-Environment `MetadataCache` (keyed by org URL) · per-thread `ConversationStore` keyed `{envId, threadId}` (messages + system-prompt + **autoApprovals** + Bridge snapshot) · re-snapshotting Module Bridge. Isolation becomes a structural invariant, not a discipline. |
| **Code interpreter** | **QuickJS-WASM (asyncified) in a pooled Web Worker** | Replaces the *dead* `new Function()` path (blocked by MV3 CSP). CSP-clean via `wasm-unsafe-eval`, hard-interruptible, true isolation. **Pyodide is cut** (§9). |
| **MCP** | **Deferred to v1.1; Tool Registry kept MCP-ready** | Registry's `{id, params schema, executor}` contract is the only thing an MCP client/server needs — keep it clean now, add MCP later with zero shell changes. (§5) |
| **Provider transport** | **Unchanged** — SW `EXTERNAL_REQUEST` proxy + injected custom `fetch` | Side-panel origin is CORS-blocked from providers. Streaming needs the SSE-passthrough upgrade (§6). |

**One picture:** AI SDK 6 raises the *floor* (robust single-agent tool loop, no protocol rot, per-thread isolation); LangGraph raises the *ceiling* (durable/branching/HITL) precisely on Authoring + Bulk Ops; the QuickJS code interpreter is an orthogonal power-multiplier plugged into the Tool Registry. **Rejected:** full-LangGraph-everywhere (ceremony for trivial Tools), Mastra (server-first; reintroduces the forbidden backend).

---

## 2. How it fixes the robustness bug (context-bleed)

The verified failure (Atlas §7) is context bleeding across Environment/Module switch. The new model closes **four** leaks structurally:

1. **Wrong conversation across Environments** → the `ConversationStore` is keyed `{envId, threadId}`. The key derives from the Environment URL (`getEnvironment()`) + a UUID minted at thread creation. No code path can read another Environment's or thread's messages — the `Map` entry isn't in scope. (Also fixes the stale-metadata-on-env-switch bug: the live cache is *not* env-namespaced today; the dead `shared/metadata-cache.js` was — env-namespacing is resurrected per PRD §10.)
2. **Prior-run history persisting** → AI SDK 6's `ToolLoopAgent` owns its message array per instance; **one instance per `{envId, threadId}`**. The runner is stateless. Nothing lives on a singleton to leak — closing the never-called-`destroy()` hole at the source.
3. **Wrong Module context in the system prompt** → the Module Bridge is **snapshotted at thread open** and re-snapshotted on an explicit `navigate_module` (and a lightweight `{activeTab, pageUrl}` refresh per send) — **not** live-read at send time (`buildContextForPrompt` is retired). *Critique fix: a hard freeze-for-thread-lifetime was rejected — it would leave a 10-turn FetchXML thread reporting FetchXML after switching to Security. The re-snapshot trigger replaces the freeze.*
4. **Auto-approve leaking across threads/Envs** *(critique-caught fourth vector)* → today `setAutoApprove` mutates the shared registry singleton. Move auto-approval state into `slice.autoApprovals` on the per-`{envId, threadId}` `ConversationStore`. A "safe-write auto-approve" enabled in thread A cannot leak into thread B or another Environment.

For Authoring/Bulk Ops, LangGraph's checkpointer (keyed on `thread_id`) adds a **redundant** isolation guarantee exactly where stakes are highest (live-Environment schema + bulk mutations).

**Precondition (critique-caught):** the `{envId}` root inherits the pre-existing `findDynamicsTab` multi-tab mis-routing bug (it picks any `*.dynamics.com` tab, not the one bound to the active Environment). **Fix the activeEnv↔tab binding first** (also in REWRITE-FOUNDATIONS §4.7) — otherwise the envId the store trusts and the origin the proxy hits can diverge.

---

## 3. What "heavy agent shit" this unlocks

| Capability | Looks like | Primitive |
|---|---|---|
| **Code-interpreter data analysis** | Agent runs `execute_fetchxml` → pipes into `execute_code` → "top-10 accounts by revenue / case-volume by month / distribution stats". The multi-step investigation the Query *Explore/Pivot* surface (PRD §6.2) is built for. | AI SDK multi-step loop threads results automatically; **QuickJS asyncified** lets sandboxed JS `await dataverse.query()` directly. (Heavy aggregation idiomatically also goes to FetchXML aggregates / OData `$apply` server-side.) |
| **Durable / branching Authoring** | Solution-scale run pauses after each proposed step, shows a diff, accepts approve/edit/abort, resumes. | **LangGraph `interrupt` nodes + checkpointer.** The salvaged `view-operation` state machine becomes the node body; LangGraph supplies the pause/resume envelope. |
| **"CMT on crack" Bulk Ops** | "Migrate these 40 entities to test, remap cross-Env lookups, show the per-record diff, commit in `$batch`" — dry-run, Approval Flow. | **LangGraph durable execution** over the salvaged CMT/`$batch` engine + `EntityBodyBuilder` (lookup bug fixed); each `$batch` step a checkpointed node; HITL via `interrupt`. |
| **Tool federation (v1.1)** | Org points the Workspace at an internal MCP server; its tools appear alongside the built-ins, no reload. | MCP client merging `CoreTool`s into the Registry (deferred — §5). |

Throughline: floor = robust single-agent loop; ceiling = durable/branching exactly on the two Modules that need it; code interpreter is the orthogonal multiplier.

---

## 4. The code interpreter (QuickJS)

**Substrate.** `execute_code`'s current `new Function()` path is **silently dead under MV3 CSP** (no `eval`/`new Function`). Replacement: a pooled **Web Worker** hosting **QuickJS-WASM, asyncified** (`@jitl/quickjs-singlefile-browser-release-asyncify`, ~1 MB inlined). The QuickJS VM heap is *not* the Worker's JS realm, so `fetch`/`chrome.*`/the transport are invisible unless explicitly injected. Asyncified so sandboxed code can `await dataverse.query()` — a real analytical interpreter.

**What it may do.** Read Dataverse only via an **injected restricted bridge** — an **explicit method allowlist** `dataverse.query(odata)` / `dataverse.fetchXml(xml)` routed through `DataverseClient.request()`. *Critique fix: the boundary is the allowlist, not "write-intent detection" — a read path that could smuggle a mutation (crafted `$batch`/action via GET) must not exist in the allowlist.* No credentials, no DOM, no `chrome.*`, no arbitrary `fetch`. Memory-capped (`setMemoryLimit(32 MB)`); hard-interruptible (`setInterruptHandler` wired to the loop `abortSignal`) — opcode-level cancellation that survives infinite loops.

**Writes hit the §8 gate.** Writes are **not** bridged. Code may only *propose* writes; after the script finishes, accumulated proposals go through the **same `needsApproval` gate** as every CRUD Tool (§8 tiers: create/update = safe-write, session-auto-approvable; delete/mass-delete = dangerous, always confirmed). `execute_code` itself stays `requiresConfirmation:true, autoApprovable:false`.

**Streaming back.** The Worker posts `{stdout|error|result}` over a `MessagePort` to the `AgentTimeline`. Worker pooled per conversation, terminated on `destroy()` / Environment switch / idle. Constraint baked into the system prompt: no `Promise.all` of awaits inside QuickJS (asyncify = one suspension at a time).

The `page` path (`Xrm.Page` via `FORM_INSPECT`) is orthogonal and unchanged — QuickJS replaces only the dead `local` branch.

**Pyodide is cut** (§9).

---

## 5. MCP — deferred to v1.1, architected-for now

MCP is **not built in MVP.** The only MVP obligation is keeping the **Tool Registry contract clean** (`{id, params schema, executor callback}`) — which it already is — so MCP is purely additive later. When it lands:

- **Client** (the near-free, high-value half): AI SDK 6 `createMCPClient` with `StreamableHTTPClientTransport` whose internal `fetch` is overridden to route through the SW `EXTERNAL_REQUEST` proxy (side panel is CORS-blocked from MCP endpoints too). `client.tools()` → `CoreTool`s registered with `source:'mcp'`; the §8 confirmation gate applies unchanged; trust controls = allowlist + first-use confirmation + a server badge in the Agent Investigation transcript. *(Verify the StreamableHTTP transport's fetch-override hook against the shipping package before committing.)*
- **Server** (the showcase half): a Chrome extension **cannot host a server** (no port binding). Only viable as a **companion** (a small `npx dataverse-toolkit-mcp-bridge` Node package: localhost MCP server ↔ outbound WebSocket from the SW into the same Tool Registry). Defer; build read-only first.

---

## 6. Prerequisites & engineering must-dos

These are baked in (not optional, not owner-taste):

- **Manifest CSP — REQUIRED before any WASM** *(critique-caught, verified)*: the manifest currently has **no** `content_security_policy` key, and dagre is pure JS (zero WASM) — so the "wasm-unsafe-eval is already there" premise was false. Add `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" }`. WASM (QuickJS) will not instantiate without it.
- **WASM-in-MV3 spike (Slice 0):** smoke-test that the chosen QuickJS singlefile-asyncify variant instantiates under the declared CSP in a Worker spawned from the side panel; lint the **built** Worker for transitive `eval`/`new Function`. (The MV3 default-CSP-vs-WASM docs were contradictory — declare explicitly, don't rely on an implicit minimum.)
- **LangGraph bundle spike (Slice 0):** `vite build` a minimal `StateGraph + checkpointer + one tool node` against the side-panel entry; measure gz delta and audit transitive deps for `eval`. If lazy-loaded delta > ~200 kB or any `eval` slips in → fall back to AI SDK 6 agents-as-tools, defer LangGraph. **The robustness fix and MVP plan do not depend on LangGraph.**
- **Streaming SW upgrade:** `EXTERNAL_REQUEST` buffers (`await resp.json()`); token streaming needs SSE passthrough over a **`chrome.offscreen` document** (idle-kill-immune; preferred over a long-lived port given Authoring/Bulk-Ops turns can run 60s+). More than the "~30-50 LOC" first estimated — it's the SW↔panel streaming relay + idle-kill survival. Add a ~10 MB response cap.
- **Four state fixes** (§2): `{envId, threadId}` keying; stateless runner; re-snapshotting Bridge; `slice.autoApprovals`.
- **activeEnv↔tab binding fix** (§2 precondition) before trusting `envId`.
- **Checkpointer:** `MemorySaver` (volatile) for MVP; a `chrome.storage.local` `BaseCheckpointSaver` adapter (~100-150 LOC) as a fast-follow for cross-session/SW-kill durability. **No LangGraph state ever runs in the SW** (idle-killed) — all graph execution lives in the side-panel page.

---

## 7. Composition diagram

```mermaid
graph TD
  subgraph sp["Side panel (Lit Modules + signals Workspace store)"]
    MODS["Lit Modules<br/>Explorer · Query · ERD · Form · Security · Skills · …"]
    AUTHMOD["Authoring + Bulk Ops<br/>(Agent-led, Approval Flow UI)"]
    STORE["Workspace store (signals)<br/>per-Env MetadataCache · ConversationStore {envId,threadId}<br/>(messages·systemPrompt·autoApprovals·bridgeSnapshot)"]
    BRIDGE["Module Bridge (typed)<br/>snapshot + re-snapshot on navigate_module"]
    SDK["AI SDK 6 ToolLoopAgent<br/>per-{envId,threadId} · stopWhen · needsApproval · abortSignal"]
    LG["LangGraph.js StateGraph (lazy)<br/>interrupt · checkpointer · subgraphs — Authoring & Bulk Ops only"]
    REG["Tool Registry + Executor<br/>25 built-in (+ MCP-ready) · §8 tiers"]
    QM["QueryModel + codegen (pure)"]
    AUTHENG["Authoring engine<br/>view-operation state machine + xml-diff"]
    CMT["CMT / $batch engine + EntityBodyBuilder"]
    DC["DataverseClient · request/requestRaw"]
    TL["AgentTimeline (stream parts)"]
  end
  subgraph wrk["Web Worker (pooled per conversation)"]
    QJS["QuickJS-WASM (asyncified)<br/>restricted dataverse allowlist bridge"]
  end
  subgraph sw["Service worker"]
    PROXY["EXTERNAL_REQUEST proxy<br/>(+ offscreen SSE passthrough)"]
    CORS["3-hop CORS transport"]
  end
  subgraph host["*.dynamics.com page"]
    PE["page-extractor (MAIN) · same-origin fetch + Xrm"]
  end
  MODS --> STORE & BRIDGE & QM & DC
  AUTHMOD --> LG
  LG --> AUTHENG & CMT & REG
  AUTHENG --> DC
  CMT --> DC
  SDK --> REG & BRIDGE & STORE
  SDK -->|custom fetch| PROXY
  REG -->|tool handlers| DC
  REG -->|execute_code| QJS
  QJS -->|restricted query/fetchXml| DC
  QJS -->|pending writes → needsApproval| REG
  SDK --> TL
  QJS -->|stdout/result stream| TL
  DC --> CORS --> PE
  PROXY -->|direct fetch| PROV["AI providers (BYOK)"]
  MCP["MCP client + companion server"]:::later -.v1.1.-> REG
  themes["themes.css tokens (pierce Shadow DOM)"] -.theming.-> MODS
  classDef later fill:#222,stroke:#666,color:#999,stroke-dasharray:4 3;
```

---

## 8. MVP vs later

**MVP (the core IS this):** AI SDK 6 `ToolLoopAgent` floor; the three-layer scoped store + four state fixes (the robustness fix is **non-deferrable**); `needsApproval` ↔ §8 tiers + transparency + transcript; 25 Tools re-homed onto native tool-calling (protocol + `repairJson` deleted); **QuickJS** code interpreter (restricted allowlist + pending-write→gate); LangGraph for Authoring (Slice 7) + Bulk Ops (Slice 8) as lazy subgraphs *if the spike passes*; the manifest CSP + offscreen streaming upgrade.

**Later / v1.1:** MCP (client then companion server); `chrome.storage` checkpointer for cross-session durability; time-travel/branching replay (free once the checkpointer exists).

---

## 9. Explicitly out of scope (over-engineering, cut)

The critique flagged these as power-for-its-own-sake for a one-developer dev tool; **cut or someday-maybe, not "architecture enables":**

- **Pyodide (Python/pandas/matplotlib)** — *cut.* The cited analytical jobs are served by FetchXML aggregates / OData `$apply` (server-side) or QuickJS-JS. ~6-20 MB WASM + 150-350 MB session heap + 4-5s cold-load + a dual-interpreter lifecycle bought a demo, not a workflow. Revisit only if a concrete user story needs pandas that aggregation cannot serve.
- **Multi-agent supervisor graph** — someday-maybe. The product has two Agent-led Modules, not a fleet. Keep agents-as-tools (linear) as the plan.
- **Companion MCP server now** — deferred (§5); only "keep the Registry contract clean," which is a no-op since it already is.
- **Time-travel / branching replay of Approval Flows** — free to add later via the checkpointer; do not let it justify LangGraph on its own.

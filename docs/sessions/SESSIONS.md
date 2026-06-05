# Session Track — Dataverse Toolkit

A map of work sessions so any of us (owner or a fresh agent) can re-enter without re-reading everything.
**Newest on top.** One row per session. Keep entries short — this file is meant to be skimmed in a small context window.

How the chain works: each session usually ends by writing a **handoff** (a temp/durable `.md`), which the next session **loads first**. Durable copies of handoffs live in `./handoffs/`. To split work, start two sessions from the same handoff; to merge, write one handoff that references both.

---

## ▶ NEXT SESSION — start here

**Goal of the rewrite right now:** docs/architecture are done; next is the remaining UX/shell/skills ADRs, then implementation in vertical slices. No rewrite code written yet (`src/` is the OLD build, reference only).

**Load at the start of a fresh rewrite session (in this order):**
1. `docs/PRD.md` — source of truth (supersedes ADR-0001/0002)
2. `CONTEXT.md` — glossary; **vocabulary is load-bearing**
3. `docs/adr/0004-agent-core.md` + `docs/AGENT-CORE.md` — decided agent core
4. `docs/CODEBASE-ATLAS.md` — verified ground truth of the OLD build (salvage ledger)
5. `docs/REWRITE-FOUNDATIONS.md` — stack + deep-module reuse contract
6. `docs/DESIGN-CONCEPT.md` — UX direction distilled from the prototype (firm principles; exact visual still open)
7. `docs/sessions/handoffs/2026-06-04-rewrite-docs-session-handoff.md` — the running self-handoff (decisions locked / not-to-reopen)

**Open next deliverables:** ADR-0003 (UX), ADR-0005 (Workspace shell + state/lifecycle), ADR-0006 (Skill ownership/sharing). Then Slice-0 bundle spike (decides LangGraph lazy-load).

**UX prototype** (throwaway, for reference only): `C:\tmp\dvt-proto` → `start C:\tmp\dvt-proto\index.html`. Brief: `docs/sessions/handoffs/2026-06-04-prototype-handoff.md`.

---

## Sessions (newest first)

| Session | Date | What happened | Handoff written → continued in |
|---|---|---|---|
| `23c94aea` | 06-04 17:32 | **Design distillation.** Read prototype + gave look/feel feedback → wrote **`docs/DESIGN-CONCEPT.md`** (firm principles: one design system, shared Focus + "the wheel", restraint rubric). Open: exact accent/shell visual. | DESIGN-CONCEPT.md (committed) |
| `1d8bbe45` | 06-04 15:19 | **UX prototyping (rounds 1–2).** Built throwaway fake-UI prototypes in `C:\tmp\dvt-proto` (Query, Approval, Safety, Bulk-Ops choreography). Hit usage limits. Rule established: Opus only plans/decides, Sonnet/Haiku code. | (proto outputs) → fed DESIGN-CONCEPT |
| `fd4a7529` | 06-04 ~11:37 (resumed 06-05) | **The big one (717 turns).** Phase-2 grill of the plan; built a knowledge-graph of the OLD codebase → **`docs/CODEBASE-ATLAS.md`**; foundations research (offloaded to Sonnet) → **`REWRITE-FOUNDATIONS.md`**; **ADR-0004 agent core** + PRD reconcile. | `session-handoff.md` + `prototype-handoff.md` → 1d8bbe45 / 23c94aea |
| `292af08a` | 05-24 19:59 | **Scope born.** "new big scope — refactor the whole thing." Tech-stack debate (Vercel vs LangGraph/TS, deep modules), PRD + ADR-0001/0002, local issue-tracker doc. | `handoff-phase2-grill.md` → fd4a7529 |
| `8d4f7f15` | 05-24 17:59 | **Phase 1.** Read phase-1 handoff; product-positioning + vocabulary work ("Skill is a universal term, we keep it"). | (→ 292af08a) |
| `3abc344c` | 05-24 16:22 | Setup: symlink all Matt Pocock skills. | — |
| `3b28345d` | 05-24 15:59 | Setup: learned how the skills/handoff skills work + how to use them. | — |
| `cc6a58f7` | 05-24 15:36 | Setup: update Matt Pocock skills to latest on this machine. | — |

> Session IDs are the Claude Code transcript UUIDs (first 8 chars). Resume one with `claude --resume <full-uuid>`. Full files: `~/.claude/projects/C--Users-jwald-CodeReps-DataversePlugin/<uuid>.jsonl`.

---

## Handoff artifacts

| Handoff | Written by | Read by | Durable copy |
|---|---|---|---|
| `dataverse-toolkit-handoff-phase1.md` | (early) | 8d4f7f15 | **lost** (temp cleaned) — superseded by committed docs |
| `dataverse-toolkit-handoff-phase2-grill.md` | 292af08a | fd4a7529 | **lost** (temp cleaned) — superseded by committed docs |
| `dataverse-toolkit-prototype-handoff.md` | fd4a7529 | 1d8bbe45 | `handoffs/2026-06-04-prototype-handoff.md` |
| `dataverse-toolkit-session-handoff.md` | fd4a7529 | 23c94aea, current | `handoffs/2026-06-04-rewrite-docs-session-handoff.md` |

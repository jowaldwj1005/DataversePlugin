# Handoff: Dataverse Toolkit — UI/UX Prototyping Session

**Date:** 2026-06-04
**Repo:** `C:\Users\jwald\CodeReps\DataversePlugin`
**Your single job:** build **throwaway, fake UI prototypes** of the Dataverse Toolkit's key surfaces so the owner can give **early feedback on the design and (not-only-graphical) interaction/UX direction** — *before* any real implementation starts. Speed and breadth of ideas beat polish.

This is a disposable spike. Nothing you build here ships. Its only product is **feedback that steers the design.**

---

## ⮕ STATUS — ROUND 2 COMPLETE (2026-06-04) — READ THIS FIRST, then skim the rest for background

Round 2 is **built** in `C:\tmp\dvt-proto` (extends round 1, same harness). Run: `start C:\tmp\dvt-proto\index.html`. Top bar = surfaces; bottom pill = variants (`←`/`→`, `C` = compare). **Bulk Ops has an in-frame Timeline player** (play/pause/scrub) — that's where the choreography animates.

**What got built this round**
- **Spine layer** (`spine.css` + `spine.js` → `window.SPINE`): reusable hand-off primitives — `selChip` (shared-selection "Agent sieht: account"), `envChip`, `autoApprovePill`, `wheel(state)` (take-the-wheel/pause), `prov(by)` (provenance "Agent set this · edit"), `tally`, `handoff(dir,text)`, and **`Timeline(barEl, labels, render(i), opts)`** (scrubbable choreography player). Maps 1:1 to future Lit components.
- **Shell** rewritten to the owner-locked **hybrid**: rail + always-visible shared-selection chip + wheel; variants A/B/C are now the docked Agent's **live states** (collapsed Quick Bar → thinking/streaming → full + hand-back). B "Take the wheel" / C "Resume Agent" wire the interrupt↔resume moment.
- **Bulk Ops NEW** (`surfaces/bulk.js`) — the centerpiece "CMT on crack": a 10-frame choreography (scope-pick *where AI stops* → Agent streams filters/ID-remap/schema-diff → **dense 50-record dry-run** → human interrupts/edits/excludes → hand-back → Approval [safe-writes auto, schema-create = dangerous gate] → `$batch` → transcript). 3 scenes: **A** full run, **B** interrupt & hand-back, **C** dense diff (density stress). Dense fake data added to `data.js` (`DVT.bulkMigration`, 50 records).
- **Safety** phantom fixed: `search_entities` → `get_entities`.
- Round-1 surfaces still present: **Query, Approval, Safety** (3 variants each).

**Contract (to extend):** each `surfaces/*.js` is a self-contained IIFE injecting one `<style id="sty-*">` and pushing `{id,icon,title,blurb,variants:[{key,name,render(host),explores,ask}]}` to `window.DVT_SURFACES`. `host` = `.surface` flex-column ~400×734. Globals: `window.DVT` (fake data), `window.ICON(name,cls)`, `window.SPINE`. Tokens lifted from real `src/.../themes.css` into `proto.css`. Verify cheaply: `node --check` + `node C:\tmp\render-check.js` (DOM-shim, lists all surfaces incl. bulk) + headless Chrome screenshots.

**WORKING RULES (owner — load-bearing):**
- **Throwaway & purely VISUAL.** Everything faked, code need not be good, discarded after one look. **Do not gold-plate, do not over-verify.**
- **Delegate coding to Sonnet/Haiku;** the Opus orchestrator only plans/evaluates/decides and keeps its context small (don't pull screenshots in to "judge" — the owner judges in-browser).
- **Vocabulary** stays load-bearing: Workspace/Module/Agent/Authoring/Query/Bulk Ops/Solution-scale; never *tab/wizard/AI/chatbot/plugin* in labels. ("where AI stops" is the allowed PRD doctrine phrase; bulk currently shows "where Agent stops" — harmless, left unfixed.)

**Open questions the owner is now evaluating (the point of round 2):** does the human↔Agent hand-off read as ONE flow or as mode-switches (Shell B/C, Bulk A/B)? Does the dry-run survive 50 records at 400px (Bulk C)? Is "take the wheel" a discoverable, reassuring stop?

**ROUND 3 candidates (NOT started — await owner reaction):** ERD is **deprioritized** by the owner ("kommt später"). Likely next: collapse Bulk to the winning scene + polish the chosen shell hand-off; the shared-selection hand-off *across* modules; **failure/error states** (a step that 400s mid-flow — currently only happy paths). Do not build until the owner reacts.

---

## ⮕ STATUS — this is now ROUND 2 (read first)  *(the round-2 brief below — now superseded by the status block above; kept for background)*

**Round 1 prototypes already exist** at `C:\tmp\dvt-proto\` (open `index.html`). They did their job: laid the direction out across shell / query / approval / safety, each in 3 variants, with a compare mode. The owner has now reacted.

**Round 2 inverts the round-1 instinct: depth over breadth.** Don't add more surface-level variants. The spine of round 2 is the owner's sharpened focus:

> **Prototype how the human/UI and the Agent work *together* — the choreography of collaboration — not just static layouts.**

Build *on* the existing `C:\tmp\dvt-proto` harness (surface registry, compare mode, token CSS) — extend it, don't restart. Where round 1 already has a winner (below), collapse to it and spend the variation budget on the *collaboration*, not on more layout alternatives.

### Owner's reactions to round 1 (carry these as decisions)

- **Shell A (nav rail + docked Agent) = the practical base.** Build the hybrid on top of A.
- **Shell C (agent-arranged canvas) — intriguing but judged *not practical* at ~400px.** Mine its one strong idea — **explicit shared selection** ("Agent is looking at: `account`") — and graft it into A as a lightweight always-visible context affordance. Do *not* build the full rearranging canvas.
- **Shell B (command-palette-first) = weakest; deprioritize.** The owner understood/liked it least. The palette may survive *only* as the expanded state of the Quick Chat Bar, not as the primary shell.
- **Keep the strongest threads:** Query-C's "Agent → filled the builder above ✓" handoff; Approval as one-op/Solution-scale *same surface*; Safety-C's "what if you turned auto-approve off" + honest Environment identity + transcript. (Owner will confirm per-surface, but these are the live ones.)

### My (Claude's) evaluation of round 1 — read for context

Strong: it nailed the brief; it made the doctrine *visible* rather than claimed; two genuine design insights — Safety-C's "what-if you turned auto-approve off" (makes autonomy *legible*) and Query-C's literal "the Agent filled the same builder you'd use" (the whole thesis, visually paid off); clean vocabulary; each variant poses a sharp question. Keep that quality bar.

Gaps round 2 must fix:
- **Breadth, not depth.** Shell modules are stubbed. Commit to the hybrid and push *one full flow* end to end.
- **Density at ~400px is untested** (the NOTES admit it). Every diff is tiny; it looks clean *because* the data is small. Stress it: a 30-column add, a 200-table ERD, a 50-record bulk diff.
- **The two hardest, most design-critical surfaces are MISSING: ERD and Bulk Ops.** They were "if time remains" in round 1 and got cut — but they're exactly where the "smart non-chat UI" thesis lives or dies. Build them.
- **Everything is static.** Collaboration is *movement*; round 2 has to show it moving.
- **Accuracy nit:** Safety-B lists `search_entities` — that tool doesn't exist; it's `get_entities`. Don't let phantoms leak toward the real build.

---

## ROUND 2 — what to build (depth + collaboration)

Organizing principle: **prototype the moments where the human and the Agent hand the wheel back and forth.** Make these *dynamic* — scripted/canned animation is completely fine; the point is to *feel* the choreography, not wire real logic.

1. **The shell hybrid.** A as the base (nav rail + docked Agent that collapses to the Quick Chat Bar). Graft C's **explicit shared selection** as an always-visible "Agent is looking at: `account`" chip. Drop B as the primary. Show the docked Agent in its three live states: collapsed (Quick Bar) → thinking/streaming → full conversation.

2. **The collaboration choreography (the heart of round 2).** Animate these hand-offs, in whichever surface fits each:
   - **Agent → human:** the Agent streams a plan/steps in *live*; the human approves / edits / aborts mid-flow (the Approval Flow, but *moving*).
   - **Human → Agent:** the human builds a query or selects an entity directly; the Agent's visible context updates and it offers the next step ("want me to pivot by industry?").
   - **Agent drives a Module the human watches:** the Agent calls `navigate_module`; the UI switches and highlights; the human takes over.
   - **Interrupt & hand-back:** the human grabs the wheel mid-Agent-flow; the Agent pauses, waits, resumes. *This is the hardest and most important moment — autonomy you can always stop.*
   - **Shared record:** the transcript as the live "who did what" between the two.
   Throughout, make **"where AI stops" vs "where the Agent collaborates" legible in motion.**

3. **ERD as an Agent-operable graph (NEW — build it).** Direct: pan / zoom / click. Agent: "show everything related to Case at depth 2" → the graph expands with new nodes highlighted; "group by ownership" → relayout. Realistic density (50+ entities). The question: *can a graph be jointly driven without feeling like two separate tools?*

4. **Bulk Ops "CMT on crack" (NEW — build it).** The flagship. Human picks scope (source Environment, entity set, filter); the Agent proposes filters + cross-Environment ID remapping + flags schema diffs; dry-run with a *realistically dense* per-record diff; Approval Flow to commit. This is the richest human↔Agent surface — direct-manipulation scope-picking and Agent-driven mapping must interlock.

5. **Approval Flow at realistic density.** Redo with a 6-step Solution-scale plan where one step is a 30-column add and one is a dangerous publish. Does the owner-favored variant survive the volume? (Lean A-stepper / C-document per the owner's pick.)

Everything else (throwaway, fake data, no Dataverse/MV3/build, toggleable variations, `themes.css` tokens, vocabulary discipline) carries over unchanged from the round-1 brief below.

---

## Context in five sentences

The Dataverse Toolkit is a Chrome side-panel developer Workspace for Dynamics 365 / Power Platform, being rewritten from a "vibe-coded" current build. It is **agent-first**: every Module is jointly operable by a human at the keyboard and by an AI Agent through Tools — but (crucial) **every Module is also directly usable via its own UI without asking the Agent**. The product thesis is to *fully follow through on agent-first AND demonstrate why smart UIs are still needed* — the best agent experience is not a chat box, it's smart deterministic surfaces where AI knows where it stops. The product direction was just locked in a central PRD; what is missing is the **UX shape** (how the Modules + the Agent actually look and feel together), which is exactly what your prototypes explore. The owner is a senior Power Platform / D365 developer, bilingual (DE/EN), with a high quality bar and strong opinions on UX.

---

## Read these first (do not duplicate — reference, then design)

In the repo, in this order:

1. **`docs/PRD.md`** — the source of truth. Product thesis, the 12-Module roster, the core doctrine (§4), per-Module scope (§6), the Agent (§7), the write-safety/transparency model (§8), Skills (§9). **Your prototypes are visual hypotheses for this PRD.**
2. **`CONTEXT.md`** — the glossary. **Vocabulary is load-bearing.** Use *Workspace, Module, Agent, Agent-first UI, Agent Tool, Skill, Authoring, Query, Investigation, Bulk Ops, Solution-scale*. Never label anything *tab, wizard, AI, chatbot, plugin* (anti-glossary).
3. **`docs/CODEBASE-ATLAS.md`** — what the current build actually is (so you know what you're redesigning *away from*). Skim §2 (Module catalog) and §7 (dead/surprising). You are **redesigning the surface**, not porting it.
4. **`docs/REWRITE-FOUNDATIONS.md`** — the chosen real stack (Lit 3 + Vite + Vercel AI SDK 6). **You do NOT need this stack for prototypes** — see constraints — but it tells you the eventual component model (web components, scoped styles, design tokens) so your mockups don't drift somewhere unbuildable.

---

## Hard constraints (this is a spike)

- **Disposable.** Build in a scratch folder (e.g. `C:\tmp\dvt-proto\` or a fresh dir). Do **not** touch `src/`. This code gets thrown away.
- **No real Dataverse, no MV3, no extension build.** Plain static HTML/CSS/JS (or whatever the `prototype` skill sets up) opened in a browser. **Fake/hardcoded data only.** No service worker, no content scripts, no API calls, no auth. If you reach for `chrome.*` or `fetch` to dynamics.com, stop — that's out of scope.
- **Several radically different variations, toggleable from one route.** The point is to compare. Don't converge early. Give the owner a switcher to flip between concept A / B / C of the same surface, side by side where possible.
- **Interaction over pixels.** The owner said feedback should be on the design *"not only graphical."* Prioritize information architecture, flow, where-the-Agent-lives, and how human + Agent share a surface — over font/color perfection. Still, make it look credible (use the existing token palette idea from `themes.css`: dark/light, `--color-*`).
- **Fast.** A few surfaces, several variations, low fidelity-to-medium. Get it in front of the owner quickly and iterate on their reaction.

---

## The doctrine your mockups must make visible

(From PRD §4 — restated for what it means *on screen*.)

1. **Agent-first, never agent-only-to-reach.** Show both paths for the same Module: a human clicking through it directly, *and* the Agent driving/augmenting it. Neither is hidden behind the other. The single hardest design question: **where does the Agent live** relative to the Modules (a docked chat? a command bar? an overlay? a per-Module side rail? all of the above?). Explore radically different answers.
2. **"Where AI stops."** Make it obvious which controls are deterministic, instant, no-AI (browse, pick, run a saved query, pan a graph) versus where the Agent adds value (synthesis, multi-step Authoring, explain, "find anomalies"). The design should *teach* this boundary.
3. **Smart non-chat surfaces are the star.** Tables, graphs (ERD), query builders, bulk grids, the Approval Flow — these are first-class Agent-operable UIs, not chat output. Chat is one surface among many.
4. **Redesign, don't port.** The current build's look/UX is explicitly disliked. Feel free to reimagine layout, navigation, density entirely.

---

## What to prototype — priority order

Don't try all 12 Modules. Pick the highest-leverage surfaces that answer the open design questions:

1. **The Workspace shell (highest priority).** How do 12 Modules + the Agent coexist in a narrow side panel? This is *the* unresolved UX question. Produce **3 radically different shell concepts**, e.g.:
   - (A) Module navigation rail + docked Agent Chat that can drive any Module;
   - (B) Command-palette-first (the Agent/Quick-Chat bar is the primary entry; Modules open as needed);
   - (C) Canvas/workspace where Modules are panels the Agent rearranges.
   Include the **Quick Chat Bar** idea (persistent input on every Module, `Ctrl+I`).
2. **A "where AI stops" Module** — pick **Query (Build/Run + Explore/Pivot)** or **Explorer**. Show the deterministic direct-manipulation UI *and* how the Agent augments it (e.g. "build this query from a description" → fills the same builder; results pivot to related records).
3. **An Agent-led Approval Flow** — **Authoring** or **Bulk Ops**. This is novel and design-critical: the Agent proposes steps, the UI shows a **diff per step**, the human does approve / skip / edit / abort. Show both the **single-op** case (one-step) and the **Solution-scale** case (many steps with progress + dry-run) — they must feel like the *same* surface at different sizes (no visible "mode switch").
4. **The write-safety / transparency surface (PRD §8).** This carries a specific owner requirement: the real **Environment name always shown** (never a guessed PROD badge), a persistent **"what's auto-approved this session on `<env-name>`"** indicator, and a clear **record of what the Agent applied** (the Agent Investigation transcript with mutation diffs). Make autonomy *legible* — the owner wants to let the Agent run (e.g. create dummy data / many columns) while always seeing what's configured and what happened.

If time remains: **ERD** (graph as an Agent-operable surface) and the **Security role matrix** (the visual the owner insisted stays as a direct UI).

---

## Open design tensions the prototypes should help resolve

These are the questions feedback should answer — surface them explicitly to the owner:

- **Agent placement:** always-visible docked chat vs invocable overlay vs command palette vs per-Module rail. Trade-off: discoverability vs screen real estate in a ~400px side panel.
- **Module navigation:** 12 Modules is a lot for a side panel — rail? grouped menu? command palette? recents?
- **Shared selection:** when the human selects an entity in Explorer, how does the Agent "see" it, and how is that shared context shown?
- **Approval Flow ergonomics:** how dense can a multi-step diff get before it's overwhelming? Inline vs stepper vs list?
- **Legible autonomy:** how to show "Agent is auto-approving safe-writes" without it feeling either alarming or invisible.
- **Chat vs artifact:** when does the Agent answer inline in chat vs navigate the user to a Module? (PRD: "invisible for data, visible for artifacts.")

---

## Fake-data hints (make it feel real)

Use believable Dataverse vocabulary so the owner reacts to the design, not the placeholders: tables like `account`, `contact`, `incident` (Case), `opportunity`, custom `cr123_auditrecord`; columns with logical names + types (Lookup, OptionSet, DateTime); a Solution like `ContosoCore`; FetchXML/OData snippets; a role matrix (entity × security role with privilege depths Org/BU/User/None); orgs have ~700+ tables, so show search/virtual-scroll affordances.

---

## How to present for feedback

- One entry route with a **concept switcher** (A/B/C) per surface.
- Where useful, **side-by-side** so the owner can compare directly.
- Add a tiny "what this is exploring / what I want feedback on" caption per variation.
- Expect the owner to give terse, opinionated, possibly German feedback and to iterate fast. Build → show → cut/keep → repeat.

---

## Suggested skills

- **`prototype`** — primary. It's built exactly for this: "several radically different UI variations toggleable from one route." Use it to scaffold and to manage the variation-switcher.
- **`frontend-design:frontend-design`** — for distinctive, production-grade-*looking* (but throwaway) UI that avoids generic AI aesthetics. Pair it with `prototype`.

---

## What NOT to do

- Don't write production code, don't touch `src/`, don't set up the MV3 build or the Lit/Vite stack.
- Don't make real Dataverse or AI-provider calls.
- Don't relitigate the PRD's product decisions (positioning, the 12 Modules, agent-first, BYOK, Skills-as-Dataverse-records). You're visualizing them, not reopening them. If a prototype *reveals* a product problem, note it for the owner — don't silently diverge.
- Don't use anti-glossary words (`CONTEXT.md`): no *tab/wizard/AI/chatbot/plugin* in labels.
- Don't converge to one design too early — the value is in the contrast.

---

## Working style

Terse, high autonomy, premium quality bar. Owner is DE/EN bilingual — answer in whichever language they use. Show options, not essays. The deliverable is **fast, varied, throwaway mockups that provoke a clear design reaction.**

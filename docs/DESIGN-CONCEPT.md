# Dataverse Toolkit — Design Concept

> Status: leading direction distilled from the throwaway UX prototype (`C:\tmp\dvt-proto`) + owner feedback 2026-06-04. Principles and interaction model are firm; exact visual (accent, final shell layout) is still open. Feeds ADR-0003 (UX) and ADR-0005 (Workspace shell + state).

---

## 1. Principles (the firm part)

- **From one hand (single-source cohesion).** ONE design system end-to-end: one type scale, one spacing grid, one component set, one state model. There is no "Agent app" beside a "human app" — there is ONE Workspace with two drivers. Everything must feel and be of one piece.

- **A work tool.** Übersichtlichkeit: scannable, low cognitive load, dense-but-legible, consistent, predictable. Information density is a feature; clutter is the enemy.

- **Where AI stops (PRD §4.3).** Deterministic direct manipulation — browse, pick, run a saved Query, pan an ERD — is first-class and instant. No Agent needed. The Agent adds value on synthesis, multi-step Authoring, and judgment. It acts on the SAME surfaces a human uses, never a separate channel.

- **Restraint / clean (anti-slop rubric).** ONE accent hue + ONE Agent hue + ONE neutral ramp. Datatype / HTTP-method / syntax colours collapse near-neutral. Hairline-or-no borders, elevation + whitespace over boxes, 4px grid, at most 3 type sizes per region. No gradients (except the single Agent-avatar mark), no glow, no decorative noise.

---

## 2. The interaction model — shared Focus + the wheel

One Workspace. One Focus. One wheel. Two drivers — human and Agent — that share the same state and the same surfaces. This section is the single coherent answer to "how does Agent-driven and human-driven work share state?"

### Three anchors, one source of truth each

A persistent compact **Workspace status strip** — three equal chips, identical type treatment — sits at the top of every view:

```
┌───────────────────────────────────────────────────────────┐
│  Environment           Focus               Control        │
│  contoso-dev · Sandbox  Explorer · account  Human ◎ manual│
└───────────────────────────────────────────────────────────┘
         ↓                     ↓                    ↓
    "where am I"        shared subject          who holds
                        (both drivers)          the wheel
```

1. **Environment** — honest identity from org metadata (`contoso-dev · Sandbox`). Never a guessed or inferred type badge.
2. **Focus** — what both the human and the Agent are working on right now: Module + subject (`Explorer · account`, `Query · cr123_auditrecord`, `Bulk Ops · 14 records`). The Agent reads and writes the same Focus the human does — no hidden context.
3. **Control** — who holds **the wheel** (`Human` | `Agent`) and the current autonomy level (`manual` | `auto-safe`). Exactly one wheel-holder at a time. Auto-approve is a modifier on this anchor, not a separate element.

### One Workspace, two drivers

State lives in the **Modules**, not in the conversation. The Agent manipulates the same surfaces a human uses — fills the same Query builder, selects in the same Explorer, loads the same Bulk Ops batch. The transcript is the narration and log of that shared work, not a separate application running in parallel. "From one hand" is structural, not stylistic.

### Hand-off is explicit and symmetric

```
Human types request
    │
    ▼
Agent takes the wheel  →  Control chip: Agent ◎ auto-safe
    │  ┌── acts on shared Focus / Modules
    │  └── narrates each step in transcript
    ▼
write / dangerous op / ambiguity?
    │  YES → Approval surface raised on same Module → human approves / edits / aborts
    │  NO  → continues; yields wheel when done
    ▼
Human grabs wheel at any instant  →  Agent pauses, holds plan
    └── human releases  →  Agent resumes or replans
```

Dangerous ops (publish, delete) are NEVER auto-approved regardless of autonomy level.

### The transcript is the shared record

One timeline: who changed what, which writes applied, what was auto-approved on which Environment. It is the honesty and audit layer (PRD §8) and the investigation surface — no separate audit console.

### What this replaces in the prototype

The prototype placed three separate, competing affordances in the `.sh-ctx` row at ~400px:

- `selChip()` — "Agent sieht: account" (Focus, German, oversized)
- `wheel()` — standalone button (Control)
- `autoApprovePill()` — a separate inline pill for autonomy level

All three express parts of the same conceptual trio, with inconsistent sizing and a fourth (`.tag-mode`) adding a third type treatment. The **three-anchor status strip** collapses them into one bar, one type treatment, one source of truth per anchor.

---

## 3. Visual language

- **Direction:** warm-organic neutral (the "Sage" family from SKINS.md) is the current favourite. The firm rule is the principle, not the specific skin: restrained neutral ramp + one accent + one Agent hue that is not magenta. Both Light and Dark are first-class.
- **Colour roles:** semantic (success / warn / error / info) muted, used only on states. Datatype, HTTP-method, and syntax colours near-neutral — no rainbow. The Agent identity is a single quiet hue applied only to Agent-owned affordances (dock header, Control chip when Agent holds the wheel, Agent avatar).
- **SKINS.md** remains the living visual appendix, not a commitment. Skin/density exploration stays open until ADR-0003 locks the accent.

---

## 4. Typography system

- **One family:** system sans stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` — exactly as `proto.css` body declaration) for all UI. Mono (`"SF Mono", "Cascadia Code", Consolas, ui-monospace`) only for data, code, FetchXML, and JSON.
- **Scale:** 14px section head (optional) / 13px Module title / 12px body / 11px labels & chips / 10px micro. At most 3 visible sizes per region.
- **Weights:** 400 body, 500 labels/chips, 600 heads/emphasis. At most 2 visible weights per region.
- **All status chips: one treatment.** Same height, weight 500, sentence case.

**Inconsistency to fix:** `spine.css` and `proto.css` have three chip styles sitting side by side in the context strip:

| Selector | Size | Weight | Case | Note |
|---|---|---|---|---|
| `.selchip` | `11px` | `500` | sentence | "Agent sieht: account" |
| `.wheel` | `11px` | `600` | sentence | "Take the wheel" |
| `.tag-mode` | `9px` | `700` | uppercase via CSS + `letter-spacing:.06em` | used in Explorer Module body; `.tag-mode.stops` variant |

The 9px-uppercase `.tag-mode` beside 11px sentence-case chips reads as mixed design systems. **Decision: all status-strip chips unified to 11px / 500 / sentence case.** `.tag-mode` may survive as an inline label inside a Module body (e.g. Explorer section head), never in the chip row.

- **UI copy:** English only. The prototype mixes German ("Agent sieht: account", "Agent sieht: nichts ausgewählt") with English labels. English throughout.

---

## 5. Density & spacing

- **Target: Compact.** Owner verdict: "clean = the Compact option, possibly pushed further." Design for a denser-than-prototype default. A still-denser mode may follow as a user preference. 4px grid throughout.
- **Status strip chips** are compact, equal-height, equal-weight. No chip is a hero element.
- **Auto-approve is a Control chip modifier, not a separate element.** The current `autoApprovePill()` in `shell.js` renders as an inline `.pill` in the `.sh-ctx` flex row alongside `selChip()` and `wheel()` — three elements competing for the same band. In the three-anchor model, autonomy level collapses into the Control chip: `Human ◎ manual` or `Human ◎ auto-safe` — one element.

---

## 6. Components & decoration

- Hairline or no borders; elevation + whitespace carries structure; one consistent radius (`--radius-md: 4px` / `--radius-lg: 6px` from `proto.css` — keep); restrained shadows (`--shadow-sm`, `--shadow-md` from token layer only); no gradients except the Agent avatar mark.
- Components map 1:1 to the future Lit component set — no prototype-only abstractions that can't become real primitives.
- The `spine.css` collaboration primitives (`.selchip`, `.wheel`, `.handoff-note`, `.tally`, `.dock`) are the seed; unify them into the three-anchor model and de-duplicate, do not extend.

---

## 7. What the prototype taught

**Keep:**
- Shared selection → Focus anchor (generalise and de-duplicate from `.selchip`)
- Take-the-wheel → Control anchor (chip modifier, not a standalone button)
- "Agent filled the SAME builder" — the "→ filled the builder above ✓" strip is the correct mental model made concrete; carry it forward
- Approval as one surface for single-op and Solution-scale (toggle inside the same frame)
- Honest Environment identity from org metadata — never a guessed type badge
- Transcript as shared record: Agent Investigation is the conversation log, not a separate audit screen
- Shell A (nav rail + docked Agent) as base, with Shell C's explicit shared-selection chip grafted on

**Confused the owner (fixed by §2):**
- Three scattered, competing affordances in one band — logically one trio, rendered as three separate elements
- Inconsistent chip typography (§4 fixes this)
- `autoApprovePill()` as a separate element rather than a Control modifier
- German labels ("Agent sieht:") mixed with English UI
- ~400px viewport overwhelmed when dock, context strip, and Module content all competed at full height

---

## 8. Punch-list (carry into the real build)

- [ ] Unify all status-strip chips: 11px / 500 / sentence case. Remove `.tag-mode` from the chip row; keep only in Module body as inline label.
- [ ] Collapse Environment + Focus + Control into the single three-anchor status strip; replace `.sh-ctx` row + separate `selChip()` + `autoApprovePill()` + `wheel()` with one unified component.
- [ ] Auto-approve as a Control chip modifier (`Human ◎ auto-safe`), not a separate element.
- [ ] English-only UI copy; remove all German labels from `spine.js` `selChip()`.
- [ ] Audit `spine.css`: `.selchip` and `.prov` serve overlapping purposes — consolidate to one Focus chip primitive.
- [ ] Extract hard-coded `font-size` values from inline style attributes in surface JS files (`query.js`, `approval.js`, `safety.js`, `bulk.js` — noted in SKINS.md) before those surfaces carry forward.
- [ ] `.rail .gl` group label: `font-size:8px` + `text-transform:uppercase` in `shell.js` — raise to 10px, remove uppercase.
- [ ] `.dense .op`: `font-size:9px` for HTTP-method badges in Bulk Ops diff rows — consolidate to shared `.method` primitive at 10px.

---

## 9. Open / not yet decided (for the ADRs)

- Final accent lock; shell layout details (exact rail width, dock collapse behaviour) — **ADR-0003 (UX)**.
- Module lifecycle, signals store, Bridge wiring for the Focus/wheel state model — **ADR-0005 (Workspace shell + state)**.
- Motion / transition policy (`spine.css` has `fadeup`, `flash`, `slin` as a start; needs a coherent, minimal language).
- Per-Module density tuning (ERD, Bulk Ops diff may need tighter local density than the global default).
- Whether the Workspace status strip lives in the shell chrome or is a sticky inset per Module — architectural question for ADR-0005.

---

## 10. References

- Throwaway prototype: `C:\tmp\dvt-proto` (open `index.html`; `SKINS.md` for the skin/density study).
- `C:\tmp\dvt-proto\spine.css` — collaboration primitives (.selchip, .wheel, .prov, .tally, .dock).
- `C:\tmp\dvt-proto\proto.css` — token layer + shared component primitives.
- `C:\tmp\dvt-proto\surfaces\shell.js` — Round 2 hybrid shell (the source for the auto-approve pill and context strip issues cited in §§5–8).
- PRD doctrine §4 (where AI stops), write-safety §8 (`docs/PRD.md`).
- CONTEXT.md — canonical vocabulary (Workspace, Module, Agent, Focus, Skill, etc.).
- ADR-0004 — agent core (`docs/adr/ADR-0004-agent-core.md`).

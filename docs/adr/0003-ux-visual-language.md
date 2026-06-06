# ADR-0003: UX — accent lock, visual language, density, shell layout

## Status

Accepted (2026-06-06). Locks the visual half of the rewrite. Builds directly on [`DESIGN-CONCEPT.md`](../DESIGN-CONCEPT.md) (firm principles + interaction model) and pairs with [ADR-0005](./0005-workspace-shell.md) (the state/lifecycle skeleton beneath this skin). Numbered 0003 (UX) though authored after 0004/0005 — it was the open "accent + layout" fork DESIGN-CONCEPT §9 deferred here.

## Context

DESIGN-CONCEPT firmed the *principles* (one design system, three-anchor status strip, restraint/anti-slop rubric, compact density) and the *interaction model* (shared Focus + the wheel) but explicitly left **one fork open**: the accent/skin lock and the exact shell layout. A throwaway prototype with an 11-skin live switcher (`C:\tmp\dvt-proto`, `SKINS.md`) drove the look exploration. Everything else — typography, spacing grid, anti-rainbow discipline — was already settled in DESIGN-CONCEPT §3–§6; this ADR records the remaining taste call and the layout defaults so Slice 0 has a fixed target.

## Decision

**1. Accent: the warm-organic "Sage" family.** (Owner decision, 2026-06-06.) One accent hue, one Agent hue, both first-class in Light and Dark:

| Role | Light | Dark |
|---|---|---|
| **Accent** (sage-green) | `#4f8a64` | `#6fb98a` |
| **Agent** (clay-amber) | `#b07b3e` | `#d6a566` |
| **Base** | warm greige (beige-grey) | warm greige |

Sage is the locked default. Its siblings (Clay = terracotta, Eucalyptus = cooler blue-green, Ochre = honey, Olive = deeper) remain a **same-family fallback** if green proves wrong on real surfaces — the *family* (warm-organic greige + one earth accent + clay-amber Agent) is the commitment; the exact green can shift within it without reopening this ADR.

**2. Anti-rainbow discipline (from DESIGN-CONCEPT §1/§3, locked here).** Exactly one accent + one Agent hue + one neutral ramp. Datatype, HTTP-method, and syntax colours collapse to low-chroma earth tones near neutral. Semantic states (success/warn/error/info) are muted, used only on states, ~10–12% alpha tints. The Agent hue appears only on Agent-owned affordances (dock header, Control chip when the Agent holds the wheel, Agent avatar — the single permitted gradient mark).

**3. Density: Compact is the default.** (DESIGN-CONCEPT §5.) Denser-than-prototype baseline on a 4px grid. A still-denser mode may follow as a user preference, not a second design. Type scale (DESIGN-CONCEPT §4): 14 head / 13 Module title / 12 body / 11 labels+chips / 10 micro; weights 400/500/600; ≤3 sizes and ≤2 weights per region. System sans for UI, mono only for data/code/FetchXML/JSON. All status-strip chips: one treatment (11px / 500 / sentence case).

**4. Token system.** Keep the `themes.css` token layer as the single source; the Sage values become its default skin tokens. Tokens pierce Shadow DOM **only with `[data-theme]` on a light-DOM ancestor** (PRD §10 contract). Radius `--radius-md: 6px` / `--radius-lg: 8px`; hairline-or-no borders; elevation + whitespace over boxes; restrained shadows from the token layer only; no gradients except the Agent mark.

**5. Shell layout (defaults — flex within the principles).** Base = DESIGN-CONCEPT §7's "Shell A" (nav rail + docked Agent) with the shared-selection chip folded into the three-anchor strip:
- **Three-anchor status strip** — top, shell-owned, always present (ADR-0005 §1).
- **Nav rail** — left, thin **icon rail (~44px)** with tooltips, expandable to icon+label; the side panel is narrow (~400px), so the rail stays collapsed by default and never competes with Module content.
- **Agent dock** — a **bottom dock** that expands to a panel (a 400px panel can't host a side-by-side dock); the persistent **Quick Chat Bar** (32px, `Ctrl+I`) lives at the very bottom on every Module and is hidden only when the Agent Module itself is active.
- These are starting defaults validated in Slice 0; exact rail width and dock-collapse behaviour may tune without a new ADR.

**6. Motion: minimal and coherent.** Short, quiet transitions only — a small fade/slide-in on mount, a brief flash on a value-changed/applied write, the Agent hand-off pause. No decorative motion, no glow. The prototype's `fadeup`/`flash`/`slin` are the seed; consolidate to one minimal language during Slice 0.

## Alternatives considered and rejected

- **MS-native (Fluent).** Feels native to Dynamics 365 — but that *is* the cost: least own identity, and the product's thesis is a *showcase* of human-Agent interaction, which wants a distinct, calmer surface than the host app. Rejected.
- **Cool-calm (Slate / Aurora).** Strong, modern dev-tool looks (indigo / azure). Rejected against the owner's warm-organic preference; kept on file as the cool alternative if Sage ever reads too soft.
- **Keep the IDE rainbow (status quo).** Rejected — 8+ accent hues + per-datatype colour is the visual noise DESIGN-CONCEPT's restraint rubric exists to kill.
- **Per-skin commitment beyond the family.** Rejected as premature: lock the *family*, let the exact green settle on real surfaces (the sibling skins are the bounded escape hatch).

## Consequences

**Commits us to:**
- **Sage tokens as the `themes.css` default** — the prototype skin override becomes the baseline, not a switchable skin.
- **One accent + one Agent hue everywhere** — every Module's Shadow-DOM styles draw only from the neutral ramp + the two hues; reviewers reject any new categorical colour.
- **Compact as the design target** — components are sized for density first; the "denser" mode is an additive `--fs-*`/`--sp-*` scale (the prototype's `_scale.css` approach), not a redesign.
- **A narrow-panel-first shell** — rail and dock are collapse-by-default because 400px is the real constraint; no layout may assume a wide viewport.

**Forecloses:**
- No rainbow datatype/method/syntax palette; no second accent.
- No decorative motion or gradients beyond the single Agent mark.
- No Module-owned status anchors (shared invariant with ADR-0005).

**Open follow-ups:**
- Final green vs a sibling (Clay/Eucalyptus/Ochre/Olive) — confirmed-or-swapped within the family during Slice 0 on real surfaces.
- Per-Module local density tuning (ERD, Bulk Ops diff may need tighter local density than the global default).
- The consolidated motion language (one minimal set) is authored alongside the Slice-0 shell.
- The punch-list in DESIGN-CONCEPT §8 (extract inline `font-size` values, unify chips, English-only copy) is carried into the Slice-0 build, not this ADR.

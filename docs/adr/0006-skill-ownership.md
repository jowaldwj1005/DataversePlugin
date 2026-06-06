# ADR-0006: Skill ownership — table schema, persistence split, native security, versioning

## Status

Accepted (2026-06-06). The last open ADR fork (PRD [§9](../PRD.md) / [§13](../PRD.md)). PRD §9 already locked the *direction* — "Skills persist as Solution-bundled Dataverse records, reusing the Solution mechanism without inventing a bespoke sharing/permission layer." This ADR records the *mechanism*: the `dvt_skill` table schema, the System-vs-User persistence split, the platform-native security posture, versioning, and cross-Environment transport.

## Context

A **Skill** (CONTEXT.md) is a reusable named recipe — markdown body + frontmatter + linked Agent-Tool ids. The current build's "shared via Dataverse" story is fiction: it persists to `chrome.storage.local` only (Atlas / REWRITE-FOUNDATIONS §4). The salvaged model is `{ markdown, frontmatter, linkedTools }` + four System Skills + a Skill-context builder, carrying two known bugs.

Four sub-decisions were left to this ADR: the **table schema**, the **ownership model** (personal vs team vs Solution-bundled), **security roles**, and **versioning**. The governing instinct (PRD §9): **lean on the platform; invent no bespoke permission/sharing layer.**

## Decision

**1. System Skills ship in the extension; only User Skills are Dataverse records.** This is the load-bearing split that keeps the design simple:
- **System Skills = markdown assets bundled in the extension** (read-only, versioned with the product, always available — even with no Dataverse table imported and no BYOK). They need no persistence; shipping them as managed *data rows* would drag in the awkward managed-solution-data path for zero benefit.
- **User Skills = `dvt_skill` Dataverse records** — the things that actually need persistence, sharing, and ALM transport.

This resolves the "ship System Skills with the product" requirement without forcing every user to import a table, and confines the Dataverse dependency to user-authored Skills.

**2. The `dvt_skill` table** (publisher prefix `dvt`), shipped as a *definition* in the toolkit's managed Solution that the user imports once:

| Column | Type | Purpose |
|---|---|---|
| `dvt_skillid` | Uniqueidentifier (PK) | standard |
| `dvt_name` | Single line (primary) | display name |
| `dvt_uniquename` | Single line, **alternate key** | stable slug → idempotent upsert on re-import (no duplicates) |
| `dvt_description` | Single line | list display + relevance filtering (a real column, not buried in JSON) |
| `dvt_body` | Multiline | the markdown recipe |
| `dvt_frontmatter` | Multiline (JSON) | remaining frontmatter metadata |
| `dvt_linkedtools` | Multiline (JSON array) | linked Agent-Tool **ids** (Tools are product-defined, not Dataverse rows — a relationship is impossible; JSON is correct) |
| `dvt_kind` | Choice: System \| User | provenance |
| `dvt_version` | Whole number | app-managed, bumped on save |
| *(standard)* | `ownerid`, `statecode/statuscode`, `createdon/modifiedon`, `versionnumber` | platform |

**Ownership type = User/Team** (not Organization) — this is what unlocks native row-level security for free.

**3. Security = Dataverse-native, zero bespoke logic.** Because the table is User/Team-owned:
- **Personal** = owned by the creator (default). **Team** = team-owned or shared with a team via standard record sharing. **Org/BU** = standard business-unit + security-role configuration.
- Ship one managed **"Dataverse Toolkit User"** security role granting CRUD on `dvt_skill` at the user/team level (create/read/write/delete own + read team/BU per the org's config).
- The product enforces *nothing* itself — Dataverse ownership, sharing, BU scoping, and roles are the entire access model. The `dvt_kind`/ownership facts are all the UI needs to group "My Skills / Team / Shipped"; there is **no `dvt_scope` field** — scope is derived, not stored.

**4. Versioning.** `dvt_version` is an app-managed integer bumped on each save; the platform `modifiedon` + `versionnumber` rowversion give the audit trail. `dvt_uniquename` as alternate key makes import an **upsert** (re-importing a Skill updates in place rather than duplicating). No bespoke version-history table in MVP — orgs that want full history enable Dataverse auditing on `dvt_skill`.

**5. Cross-Environment transport — two honest paths:**
- **(a) Toolkit-native markdown export/import** (the salvaged JSON/MD export, owned by us) — always works, no ALM knowledge required. This is what we **build** for MVP.
- **(b) ALM** — add `dvt_skill` rows to a Solution / Configuration Migration for users who live in pipelines. This is the *platform's* mechanism; we don't fight it and don't build it. The "Solution-bundled" positioning is satisfied by (b) being available; (a) is the everyday path.

**6. Fix the two salvaged bugs** (PRD §9): `importFromMarkdown` passes a `linkedTools` *array* where `create()` expects an options *object* (imported Skills silently lose their Tools); the relevance filter never narrows (the full Tool list is passed in, so every enabled Skill is always injected — re-scope to the *active* Tools).

## Alternatives considered and rejected

- **System Skills as managed Dataverse data rows.** Rejected: shipping data (not just schema) in a managed Solution needs the Configuration-Migration/solution-data path — real complexity for assets that are read-only product content already in the bundle.
- **A bespoke `dvt_scope` / permission layer (personal/team/org flags enforced by the app).** Rejected (PRD §9): reinvents what Dataverse ownership + sharing + roles already do correctly and securely. Native is both less code and more trustworthy on a security-sensitive tool.
- **`linkedtools` as a child relationship table.** Rejected: Agent-Tool ids are product-defined constants, not Dataverse rows — there is nothing to relate to. JSON column is the honest shape.
- **`chrome.storage.local` (status quo).** Rejected: it is the fiction this ADR exists to replace; no sharing, no ALM, no institutional memory across users/Environments.
- **Full version-history table.** Deferred to v1.1; `modifiedon`/auditing covers MVP.

## Consequences

**Commits us to:**
- **A one-time managed-Solution import** to get the `dvt_skill` table before User Skills can persist — called out in onboarding. System Skills + browse/run work before that import (and without BYOK).
- **A publisher prefix (`dvt`) and a shipped security role** as product artifacts in the managed Solution.
- **Idempotent import via the `dvt_uniquename` alternate key** — the import/upsert path must key on it, never blind-create.
- **The Skill-context builder reads the merged set** (extension System Skills ∪ Dataverse User Skills) with the relevance filter fixed to the active Tools.

**Forecloses:**
- No app-level permission model; no `dvt_scope` field; no bespoke sharing UI — Dataverse ownership/sharing/roles only.
- No managed System-Skill data rows.
- No plugin-gallery-style distribution — Skills travel by markdown export/import (ours) or Solution/ALM (platform).

**Open follow-ups (not blocking):**
- Rich sharing/authoring UX and version history → v1.1 (PRD §12 cut-order).
- Exact managed-Solution packaging (role definition, table in which Solution, prefix registration) is a Slice-10 implementation detail.
- Whether System Skills ever *optionally* materialize as `dvt_skill` rows for org-wide editing — deferred; not needed for MVP.

---

*With ADR-0006 the ADR set is complete (0001–0006). Remaining before implementation: the two Slice-0 spikes (LangGraph bundle, WASM-CSP) from ADR-0004. Skills land in Slice 10 (PRD §12).*

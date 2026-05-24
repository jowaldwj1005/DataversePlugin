# Dataverse Toolkit

A Chrome side panel that turns a live Dataverse environment into a developer Workspace designed end-to-end for human-Agent collaboration. Every Module is an Agent-first UI — jointly operable by a human at the keyboard and by the Agent through Tools. Inspect, query, author, test, and bulk-migrate against the connected Environment; Skills accumulate as institutional memory.

## Language

### Environment & connection

**Environment**:
The connected Dataverse org. Determined by the Dynamics 365 / Power Apps page the side panel is opened against; auth is the host page's session cookies via a same-origin fetch from a MAIN-world page extractor. One Environment at a time.
_Avoid_: org, tenant, instance

**Workspace**:
The side panel as a whole, bound to one Environment. Holds shared state across all Modules (auth, schema cache, selected entity, recent records, Agent conversation) and recontextualizes when the host page navigates to a different Environment.
_Avoid_: session, app, plugin window

**Module**:
A functional surface inside the Workspace — Explorer, Query, Authoring, Request Builder, ERD, Form, Bulk Ops, Agent Chat, Skills, Settings, etc. (full MVP roster is Phase 2's call). Modules share Workspace state and expose their own state via the Module Bridge for the Agent to read or navigate to.
_Avoid_: tab (UI-only term), feature, plugin

**Agent Chat**:
A special Module — the conversational surface for the Agent. Unlike other Modules, it operates *across* Modules: from inside Agent Chat the Agent can read any other Module's state, drive it through Agent Tools, and navigate the user to it. Agent Chat is one Agent-first UI among many; the Agent participates in other Modules without requiring the user to be in Agent Chat.
_Avoid_: AI tab, chat panel, copilot

### Agent & extensibility

**Agent**:
The AI collaborator that participates in every Module. Reads Module state, drives Modules through Agent Tools, navigates between them, and persists learned behavior as Skills. Central to the product's identity; not a side feature. Required for Authoring. The inspect / Query / Request Builder / ERD / Form / Bulk Ops Modules also work without an Agent configured, but every one of them is *designed* to be jointly operable when an Agent is present.
_Avoid_: AI, copilot, chatbot, assistant

**Agent-first UI**:
A UI designed so a human or the Agent can operate it interchangeably. Module state is exposed via the Module Bridge; every meaningful user action is also available as an Agent Tool; there are no human-only affordances and no Agent-only affordances. Agent-first UIs include non-chatbot surfaces — tables, graphs, forms, code editors, bulk grids — not just chat. A defining trait: *a perfect Agent-first UI knows where AI stops* — browsing entities, picking fields, running a saved query, navigating a graph are deterministic visual operations and never require chatting. The Agent collaborates on synthesis, multi-step flows, and Authoring; it stays out of pure navigation and inspection.
_Avoid_: AI UI, chat UI, copilot UI

**Agent Tool**:
A callable function the Agent can invoke — `execute_fetchxml`, `create_record`, `navigate_module`, etc. A *Tool* is a capability; a *Module* is a UI surface. Distinct concepts, often paired (most Modules expose a few Tools).
_Avoid_: function, capability, action

**Skill**:
A reusable, named recipe — markdown plus links to Agent Tools — persisted in Dataverse so the Agent can reuse it across Workspaces, users, and Environments. System Skills ship with the product; User Skills are authored by users and shared via Dataverse. Skills are the product's *dynamic extensibility mechanism*.
_Avoid_: prompt template, macro, snippet, plugin

**BYOK**:
Bring your own key. Users supply their own AI provider credentials (OpenAI, Azure OpenAI, Anthropic, OpenAI-compatible custom). The product never proxies AI traffic through a backend it controls.

### Work shapes

**Authoring**:
Creating or editing tables, columns, relationships, security roles, forms, and views. Distinct from Query (read-only). Always Agent-driven. Most individual Authoring actions are *Agent-only* mode (e.g. *add column*, *add relationship*) with optional UI for visualization or confirmation; Solution-scale Authoring is *Agent-led, UI-augmented* (the Agent runs the multi-step flow, the UI shows diffs and accepts interventions). Agent-driven *generation* of forms and views is in scope (one-shot create forms for many entities). A click-by-click WYSIWYG form/view *editor* is **not** — that surface stays with make.powerapps.com.
_Avoid_: schema editing, customization, designer

**Query**:
Read-only fetching of Dataverse data via FetchXML or OData. Distinct from Authoring (mutates schema) and from CRUD (mutates records).
_Avoid_: read, fetch (too generic)

**Investigation**:
Diagnostic work against a live Environment, in two flavors. *Data Investigation*: generic inspection of Dataverse data — any tables, any rows, any relationships — including audit-log records (which are just one type of data among many). *Agent Investigation*: auditing what the Workspace Agent itself did — a Claude-Code-style transcript of Tool calls, decisions, and mutations, with possible extensions beyond what Claude Code offers. Out of scope: auditing external AI agents (Foundry, Copilot Studio, third-party); those are not our concern.
_Avoid_: debugging, troubleshooting

**Bulk Ops**:
Batch operations against many records at once — `$batch` requests, conditional mass updates, mass deletions, and the headline use case: *Configuration Migration* (moving config records between Environments, the job Microsoft's Configuration Migration Tool does). The product's take: CMT-style migration with Agent-driven filtering, mapping suggestions, schema-aware translation, and Solution-scale awareness — "CMT but on crack". A flagship Agent-first UI: human selects scope, Agent filters/maps/explains, either can drive.
_Avoid_: batch ($batch is the lower-level mechanism), wizard

**Solution-scale**:
Operations spanning multiple entities, relationships, or records belonging to one Dataverse Solution. Authoring "at Solution-scale" means creating many tables and relationships in one flow, not one at a time. The product's unit of bulk work.
_Avoid_: bulk (reserved in code for `$batch` semantics — narrower)

### Interaction modes

Every capability in the Workspace lives in one of three modes. Phase 2 will tag each Module / Tool with its mode; the taxonomy is the design contract.

**Agent-only**:
The capability is invoked *only* through the Agent. May still have a dedicated UI surface — for visualization, confirmation, diff display, or to let the human cancel mid-flight — but no direct human action triggers it. Example: *add column*. The Agent calls the Tool; a UI surface may show the column appearing in the entity. The human asks; they do not click.

**UI-led, Agent-augmented**:
A direct-manipulation UI is primary; the Agent can also drive it through Tools, prefill it, or explain it. The UI is fully usable with no Agent configured. Example: *Query Builder, Request Builder, ERD, Form inspector, Explorer*. Most "where AI stops" surfaces live here.

**Agent-led, UI-augmented**:
The Agent orchestrates a multi-step flow; a UI surface participates — showing progress, diffs, intermediate state, and accepting human interventions (approve / skip / edit / abort). Example: *Solution-scale Authoring*, *"CMT on crack" config migration*. The Agent runs; the human steers.

## Anti-glossary — terms we deliberately avoid

- **Session**: Implies time-bounded ephemeral work. The Workspace persists across days; some Authoring jobs span weeks. Use *Workspace* for the surface or name the work shape (*Authoring*, *Query*, *Investigation*, *Bulk Ops*).
- **AI-native**: Buzzword. Say *Agent-first* — which means something specific (every Module is jointly human + Agent operable, with both non-chatbot surfaces and deterministic controls), not just "has AI in it".
- **Chatbot / Chat UI**: Implies the only Agent surface is a text input. The chat surface is *one* of many Agent-first UIs — most of them are non-chat (tables, graphs, forms, code editors, bulk grids).
- **Optional Agent**: Misleading. Some Modules still function without an Agent configured, but the *design* is never "agent on the side" — every UI is built for joint operation, even when no key is set.
- **Plugin system**: Implies XrmToolBox-style installable third-party plugins with a gallery and version skew. Our extensibility is *Skills*, persisted in Dataverse and versioned with the org.
- **Platform**: Vague and overloaded ("Power Platform" already owns this word in our space).
- **Tab**: UI-only term. The user-facing surface is a *Module*; *tab* is just how it happens to render.
- **Form designer / View designer / WYSIWYG editor**: Implies a click-by-click direct-manipulation editing surface for forms or views. We deliberately don't build one — Authoring goes through the *Agent* + *Skills*. make.powerapps.com remains canonical for visual form design.
- **Wizard**: Avoid for any new Module. The existing Bulk Ops "wizard" is the cautionary example — modal stepper boilerplate that an Agent-first UI replaces. Use *flow* or just describe the surface concretely.

## Example dialogue

> **Dev**: I want to add an audit table to my Solution.
>
> **Agent**: Opening Authoring. The Environment is `contoso-dev`. Want default columns, or shall I list options first?
>
> **Dev**: Defaults. And add a many-to-one to `account`.
>
> **Agent**: Created `cr123_auditrecord` with `name`, `createdon`, `owner`, `payload`, and a many-to-one to `account`. Save this as a Skill — *"Audit table + account relationship"* — so we can rerun it in `contoso-test`?
>
> **Dev**: Yes. And now query the last 100 audit records this Agent has touched in this Environment — I want to inspect what it did before I trust the Skill.
>
> **Agent**: That's an Investigation. Switching to Query, FetchXML against `audit` filtered by `userid eq <agent-application-user-id>` ordered by `createdon desc` limit 100. Running…

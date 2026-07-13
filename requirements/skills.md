# Skills System

Skills are the unit of productization. A skill is a typed, named, versioned capability — something the platform can run with structured input and structured output, with optional human approval before its output is released.

This doc is the **product spec** for skills (concept-level). For the **developer guide** to authoring plugin skills, see [`writing-a-plugin.md`](../docs/guides/writing-a-plugin.md). For prompt-skill authoring, see [`docs/workspace.md`](../docs/workspace.md#add-a-new-operation).

## What a skill carries

| Property | Authored where |
|---|---|
| `slug` + `name` + `description` | YAML manifest (both flavors) |
| `category` (`query` / `mutation` / `composite`) | YAML manifest |
| `status` (`active` / `disabled` / `draft`) | YAML manifest |
| `model`, `temperature`, `provider` | YAML manifest |
| `requiresApproval` | YAML manifest — gates output behind the review queue |
| `inputSchema` | YAML manifest (prompt skills) or Zod (plugin skills) |
| `outputSchema` | Plugin skills only — prompt skills return free-form text |
| Prompt template | `prompt.md` (prompt skills) or skill code (plugin skills) |
| Eval fixtures | `evals/` next to the skill (Phase 3 v0.2) |
| Version history | git — every `workspace:apply` records a SHA, stamped on every `skill_run` |

## Two flavors

**Prompt skills** are YAML + markdown in `workspace/<org>/skills/<slug>/`. The runtime interpolates `{{vars}}` and calls one LLM. Authored by humans (or by the meta-agent in Phase 7).

**Plugin skills** are TypeScript modules implementing `Skill<Input, Output>` from `@/libs/plugins`. Custom logic, multiple LLM calls, structured I/O, external API access. Distributed as npm packages.

If both exist for the same slug, the plugin wins. Clean upgrade path — start with a prompt; promote to a plugin when logic outgrows it. Same `skill_run` rows, same review queue, same audit trail.

## Categories

Categories are advisory — they help the UI filter and help reviewers anticipate side-effects. Runtime treats all skills the same.

| Category | Means | Examples |
|---|---|---|
| **query** | Read-only, no side effects | Summarize account, find prior escalations, pull roadmap evidence, answer contract question |
| **mutation** | May cause side effects via connectors or actions | Create ticket, send follow-up email, update CRM record, draft + send QBR |
| **composite** | Multi-step; mixes reads + writes | Renewal risk brief, support triage, inbound lead processing, customer-risk audit |

`requiresApproval: true` is independent of category — a `query` skill that costs $5/run might want gating; a `mutation` that's idempotent + reversible might not.

## Productization signals

A skill is "productized" when it has all of:

- A stable `slug` that won't churn
- A version number (`version: 1` → bump on breaking input/output changes)
- Eval fixtures with expected outputs (Phase 3 v0.2)
- Documented input/output (prompt skills: free text; plugin skills: enforced via Zod)
- Clear ownership (plugin skills: package + maintainer; prompt skills: git blame + repo CODEOWNERS)

## Catalog (what MetaCTO has built or specced)

Active in the reference tenant:

- `discovery_summary` — Zoom transcript → structured 8-section summary
- `draft_followup_email` — discovery summary → Chris-voiced follow-up with case studies
- `draft_mvp_proposal` — discovery summary → 12-section client-ready proposal
- `find_related_conversations` — search across Gmail/Slack/HubSpot
- `search_everything` — broad cross-source retrieval

Specced (placeholders in the catalog, prompts pending):

- `summarize_deal`, `draft_proposal_brief`, `inbox_triage`, `aging_pipeline`, `draft_lead_response`, `capability_asset_selection`, `account_timeline`, `objection_analysis`

Sample plugin shipped:

- `transcript_highlights` — chunking + multi-LLM-call + structured output (in `src/plugins/samples/`)

For Algren's NINJIO-account work (planned): `meeting_prep_pack`, `urgency_classifier`, `account_health_summary`, `thread_sentiment`, `stakeholder_activity_summary`. See [internal case study](../docs/internal/use-cases/algren.md).

## Related

- [`writing-a-plugin.md`](../docs/guides/writing-a-plugin.md) — plugin SDK developer guide (typed contract, registry, executor, evals)
- [`docs/workspace.md`](../docs/workspace.md) — prompt-skill authoring guide
- [`object-model.md`](./object-model.md) — what skills operate on (business object types)
- [`product-surfaces.md`](./product-surfaces.md) — `/dashboard/skills` UI spec

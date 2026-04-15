# Algren — Customer Account Agent for NINJIO

Second case study on top of Vocion after Ziggy. Where Ziggy runs the sales pipeline, **Algren** runs a single high-value customer account relationship — acting as the exec-sponsor's assistant: reviewing noise across every channel, producing meeting prep, flagging what needs attention, summarizing account health weekly.

**The name:** Nathan Algren — the American captain in *The Last Samurai* who, sent to modernize the Japanese army, instead crosses over and learns their world from the inside. Algren the agent is the exec's embedded operator in the NINJIO relationship — fluent in both MetaCTO's delivery posture and NINJIO's operations. Ziggy-sibling naming: one name, memorable, a specific personality. Bonus: NINJIO teaches cybersecurity through ninja framing, so sending a Last Samurai agent into it is on-brand.

**Status:** spec only. No code yet. Triggers Phase 2 Teams connector work + Phase 4 feedback loop.

## Architecture decision: per-customer named agent, shared skills + workflows

**Decision:** Each customer account gets its own agent definition (YAML) with a clever per-customer name. Skills and workflows are shared across accounts by slug reference — authored once, reused everywhere. The customer-specific context (channels, cadence, stakeholders) lives in a `business_object` row of `type=account` and is injected into the agent's prompt at runtime.

NINJIO's agent is Algren. A future customer "Acme" would get its own agent ("Gatsby", "Watson", whatever fits their brand) — same skills, same workflows, different name + per-account data.

### Why per-customer agent, not one shared template

- **Personality matters in a relationship-centric role.** The exec sponsor is the human; the agent is its extension. A named persona per account is more legible than "account_manager #47."
- **Small incremental cost.** Agent manifest is YAML + one markdown system prompt — 30 lines per account. Everything heavy (skills, workflows) is shared.
- **Still scales.** Adding a customer = new `agents/<name>.yaml` + new `accounts/<slug>.yaml` + new connector OAuth. No new skills, no new workflows.
- **Easier to iterate tone.** Each account's system prompt can reflect the specific relationship dynamics (formal vs casual, technical vs exec, cadence preferences) without fighting a shared template.

### What lives where

| Where | What |
|---|---|
| `context/metacto/agents/algren.yaml` | NINJIO's agent: name, system prompt, shared skill + workflow slugs, connector sources |
| `context/metacto/accounts/ninjio.yaml` | NINJIO account data (new primitive — seeds a `business_object` row on context:apply) — Slack + Teams IDs, stakeholders, renewal date, recurring meetings |
| `business_object` row, `type=account` | Runtime representation of the NINJIO account — what Algren's skills operate on |
| Shared `context/metacto/skills/meeting_prep_pack/` etc. | Skills authored once, called by Algren, Gatsby, and any future account agent |
| Shared `context/metacto/workflows/account_*` | Same pattern for workflows — authored once, parametrized by `account_id` at run start |

NINJIO becomes `business_object` row:

```json
{
  "type_slug": "account",
  "title": "NINJIO",
  "status": "active",
  "metadata": {
    "slack_workspace": "T0XXXXXX",
    "slack_channels": ["C0...shared-ninjio", "C0...ninjio-support"],
    "teams_tenant": "ninjio.onmicrosoft.com",
    "teams_groups": ["NINJIO-MetaCTO-Exec", "NINJIO-Support"],
    "exec_sponsor": "chris@metacto.com",
    "primary_contact": "...",
    "sla_tier": "enterprise",
    "contract_renewal_date": "2026-09-30",
    "recurring_meetings": [
      { "title": "NINJIO/MetaCTO Weekly", "cadence": "weekly:friday:14:00-ET" },
      { "title": "NINJIO Exec QBR", "cadence": "quarterly" }
    ]
  }
}
```

---

## Inputs (connectors needed)

| Connector | Status | Purpose |
|---|---|---|
| Slack (MetaCTO workspace) | exists | Internal discussion about NINJIO |
| Slack (NINJIO shared workspace) | **new** — multi-workspace OAuth | Joint channels with NINJIO team |
| Teams chats | **new** | NINJIO stakeholders communicate here |
| Teams calendar | **new** | Exec sponsor calendar, NINJIO meetings |
| Teams email (M365) | **new** | NINJIO thread |
| Zoom/Teams meeting recordings | exists (Zoom) / new (Teams) | Prior meeting transcripts for prep |
| Gmail (chris@metacto.com) | exists | NINJIO emails that land here |

**Connector plan:** add Teams via Microsoft Graph API (one source plugin covering chats + calendar + mail + recordings). Add multi-workspace Slack support.

## Workflows

### 1. `account_meeting_prep`

**Trigger:** (v1) manual — "prep me for the NINJIO weekly at 2pm Friday." (v2) event on calendar.event.approaching (30 min before).

**Inputs:** `account_id`, `meeting_id` or `meeting_title` + approximate time.

**Steps:**
1. Resolve the meeting event via Teams calendar
2. Pull attendees + meeting history (prior recurrences)
3. Multi-search across all connectors for recent activity:
   - Recordings from last N days
   - Slack messages in relevant channels
   - Emails matching participants
   - Teams chats with participants
4. `meeting_prep_pack` skill — LLM synthesizes the prep
5. **HITL approve** — send to Chris's inbox (Teams message or email with the pack)

**Output:** structured prep pack: what this meeting is about, what's changed since last time, who's attending + their recent activity, open issues/risks, talking points, questions to ask.

### 2. `account_daily_triage`

**Trigger:** scheduled daily at 7am ET.

**Steps:**
1. Scan last 24h of activity across all connectors scoped to the account
2. `urgency_classifier` skill — scores each item as critical / high / normal / noise
3. For `critical` + `high`: generate a suggested response draft (if it's a message that warrants one)
4. **HITL approve** per flagged item before sending
5. Compose a "morning brief" message to Chris with the flagged items + drafts

**Output:** posted to a dedicated Teams DM or email thread.

### 3. `account_weekly_summary`

**Trigger:** scheduled Sunday evening.

**Steps:**
1. Aggregate last 7 days across all connectors
2. `account_health_summary` skill — LLM writes the weekly narrative:
   - What shipped / changed
   - Open issues + owners
   - Executive-level risks
   - Customer sentiment signals (from chats / emails)
   - Revenue + renewal watch (if in-window)
3. **HITL approve** — Chris reads, may ask for revisions
4. Deliver as email to Chris (or store as a business_object `weekly_brief`)

### 4. `account_risk_flag` (composed into triage)

Not a separate workflow — runs inside `account_daily_triage`. Listed here because the classifier is reusable and may run ad-hoc.

**Classifier criteria (initial):**
- Explicit escalation language ("urgent", "SLA", "outage", "legal", "renewal")
- Exec stakeholders in thread (from known-stakeholder list in account metadata)
- Negative sentiment spike vs baseline
- Long-running thread with no response from MetaCTO
- Time-sensitive: contract/renewal dates approaching

## Skills

| Skill | Kind | Notes |
|---|---|---|
| `meeting_prep_pack` | plugin (complex) | Multi-retrieval, multi-LLM-call, structured output |
| `urgency_classifier` | plugin or prompt | Could start as prompt, promote to plugin if we need per-source scoring heuristics |
| `draft_account_response` | prompt | Reuses Chris's voice rules from `draft_followup_email` — extract shared voice block into a reusable prompt include |
| `account_health_summary` | prompt | Weekly-cadence narrative |
| `thread_sentiment` | plugin | Scores message threads; feeds classifier. May wrap a cheaper model |
| `stakeholder_activity_summary` | prompt | Per-person recent activity — useful within prep pack |

## Learning / feedback — platform concern, not agent-specific

Chris asked: "can/should it learn and be self-improving — after-meeting feedback, iterate/HITL, or just review? does this need to go into core?"

**Yes, core platform.** Every skill/workflow benefits, not just this agent. Proposed as a new roadmap phase. Shape:

1. `skill_run.feedback` column — `{ rating: thumb_up|thumb_down, note: string, submitted_by, submitted_at }`
2. UI hooks in review queue + post-hoc ("this prep pack was useful" / "missed X") to write feedback
3. `improve_skill` meta-skill — periodically (weekly?) reviews last N runs of a skill, aggregates feedback, proposes prompt diffs → opens a PR-style context change (writes branch, not main, so humans review)
4. Eval harness runs the proposed vs current prompt on a holdout set before merge

**When:** new Phase 4 in the roadmap (before Plugin SDK v0.2). Unblocks both this agent's post-meeting improvement and Ziggy's email-draft improvement.

**What NOT to do (yet):**
- No autonomous prompt updates (too risky, breaks audit)
- No per-user personalization (single-tenant prompts for v1)
- No continuous fine-tuning (API-model-based, not economical at our volume)

## HITL boundaries

| Activity | Approval needed? |
|---|---|
| Sending an email / message on behalf of Chris | always |
| Meeting prep delivery (internal-only) | no (informational to Chris) |
| Weekly summary delivery (internal-only) | no |
| Urgency flagging | no (advisory) |
| Draft responses | yes, before send |
| Any context edits (prompts, workflows) | yes, PR-style via MCP |

## Sequencing against current roadmap

- **Phase 3 work in-progress** unlocks Plugin SDK (needed for `meeting_prep_pack` complexity)
- **Teams connector** = Phase 2b work (after Slack bot or as its own thing) OR ships as a source plugin once Plugin SDK v0.2 lands
- **Multi-workspace Slack** = Phase 2 connector enhancement
- **Feedback loop** = new Phase 4 (proposed)
- **Algren agent + NINJIO data + workflows** = lands after connectors + Plugin SDK v0.2

## First build slice (when we start)

When Algren gets built, the minimum viable sequence:

1. Add Teams connector (Microsoft Graph) as a source plugin
2. Seed `business_object` NINJIO account row via context-as-code — new `context/metacto/accounts/ninjio.yaml` → seeded as `business_object` on apply (new context primitive: object instances)
3. Author `context/metacto/agents/algren.yaml` with account-aware system prompt
4. Ship `meeting_prep_pack` as a plugin skill
5. Ship `account_meeting_prep` workflow (manual trigger)
6. Dogfood Algren on the real NINJIO weekly meeting
7. Collect feedback → iterate prompts

Daily triage + weekly summary come after prep pack is validated.

## Open questions

- **Seeding business objects via context-as-code?** Today `context/` covers agents/skills/object-types/workflows but NOT object *instances*. Should per-account data be a context primitive (YAML seeds), or a runtime admin UI write? Probably YAML for the permanent metadata (channel IDs etc.) and runtime for transient status.
- **Slack multi-workspace:** does each customer get their own OAuth install, or do we federate under a single Vocion app?
- **Teams recording access:** Microsoft Graph permissions for Teams recordings require tenant-admin consent. Need to scope carefully — NINJIO controls their tenant, MetaCTO needs per-customer consent setup.
- **Where does the prep pack get delivered?** Teams DM to Chris? Email? A dedicated web UI view? The agent shouldn't care — channel is an adapter decision.

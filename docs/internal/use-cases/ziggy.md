# Ziggy — sales ops

First packaged GTM agent built on Vocion. Acts as sales coordinator + proposal ops specialist + follow-up analyst for MetaCTO.

**Jump to:** [Overview](#overview) · [Connectors & actions](#connectors--actions) · [Object model](#object-model) · [Skills](#skills) · [Workflows](#workflows) · [Sprint plan](#sprint-plan)

---

## Overview

### Positioning

- **Vocion** = the reusable enterprise context platform (connectors, objects, skills, workflows, HITL, observability)
- **Ziggy** = the first vertical package built on top of it (Sales Ops / RevOps)

### What Ziggy can do (end state)

- Qualify and respond to inbound leads
- Schedule discovery calls
- Collect and summarize discovery call context
- Draft follow-up emails with capabilities collateral
- Trigger and monitor NDA (DocuSign)
- Draft proposal deck from template + discovery context
- Send proposal with email copy
- Schedule proposal delivery / sales follow-up
- Monitor inbox daily for sales follow-up, escalate to HITL
- Keep HubSpot in sync (move objects down funnel)
- Drive aging/cold leads, prospects, deals, proposals forward

### Platform vs Ziggy boundary

**Platform (build once, reuse across clients):** auth and tenancy, connector framework, object model engine, skill registry, workflow engine (Temporal), HITL inbox, audit/logging, eval and feedback loop, admin UI, chat/work UI shell, permissions model, action execution layer, notifications, run history.

**Ziggy (configure + lightly extend per use case):** HubSpot object mappings, Gmail actions, Calendly scheduling logic, Zoom transcript ingestion, proposal generation skill, NDA workflow, sales follow-up workflow, daily inbox triage, funnel stage rules, escalation rules, proposal delivery process.

### Code vs configure vs managed services

**Build in code once (platform):** API layer, auth/RBAC, connector adapters, object mapping engine, run engine, approval framework, feedback framework, audit logging, notification framework, workflow runner (Temporal), agent runner (LangGraph), observability integration, admin UI shell, work UI shell.

**Configure per use case (Ziggy config):** connector credentials, canonical object mappings, stage definitions, prompts, skill schemas, template choices, approval rules, escalation rules, source scopes, retrieval rules, playbooks, email tone/persona, proposal template, case study selection rules.

**Build as reusable managed-service codelets:** HubSpot adapter pack, Gmail outbound pack, Zoom transcript parser, Gamma proposal generator, Calendly scheduling pack, DocuSign NDA pack, sales follow-up analyzer, inbox triage classifier, objection escalation logic, stage progression rules.

---

## Connectors & actions

### Required connectors

**Phase 1 — connected**

| Connector | Purpose |
|-----------|---------|
| HubSpot | CRM — contacts, companies, deals, tasks, notes, pipeline |
| Gmail | Email threads, send/draft emails |
| Google Drive | Capabilities PDFs, case studies, sample work |

**Phase 1 — pending**

| Connector | Purpose | Notes |
|-----------|---------|-------|
| Gamma | Proposal template, deck generation | API integration (no Onyx connector needed) |
| Google Calendar | Meeting context, attendees, scheduling | No Onyx connector — build custom or use API |
| Calendly | Meeting scheduling, availability, booking links | No Onyx connector — build custom or use API |
| Zoom | Meeting records, transcripts | No Onyx connector — build custom connector |

**Phase 2**

| Connector | Purpose |
|-----------|---------|
| DocuSign | NDA send, status tracking, completion |
| Slack | Internal notifications, escalation alerts |

### Required actions

| Action | Type | Approval required |
|--------|------|-------------------|
| Create/update HubSpot contact | Mutation | No |
| Create/update HubSpot company | Mutation | No |
| Create/update HubSpot deal | Mutation | No |
| Create HubSpot task/note | Mutation | No |
| Move deal stage in HubSpot | Mutation | Phase 2: No, Phase 3+: Configurable |
| Fetch deal timeline | Query | No |
| Fetch meeting details | Query | No |
| Fetch Zoom transcript | Query | No |
| Fetch Google Calendar events | Query | No |
| Create Google Calendar event | Mutation | Configurable |
| Fetch Calendly scheduling links | Query | No |
| Send Calendly scheduling link | Mutation | Configurable |
| Draft Gmail email | Mutation | Yes (Phase 2-3), Configurable (Phase 4) |
| Send Gmail email | Mutation | Yes |
| Generate Gamma from template | Mutation | Yes |
| Create DocuSign envelope | Mutation | Yes |
| Schedule follow-up task | Mutation | No |
| Push Slack notification | Mutation | No |

### Autonomy progression

**Phase 2-3:** all outbound comms require HITL approval.

**Phase 4:** selected auto-send actions.

*Auto-run (no approval):* send initial polite acknowledgment, send scheduling link, post notes to HubSpot, create internal tasks, remind on aging deals, notify owner of inbox items.

*Still require review:* custom proposal email, pricing statements, solution commitments, objection handling, scope changes, anything legal beyond standard NDA.

---

## Object model

### Core sales objects

| Object | Description | Primary source |
|--------|-------------|----------------|
| Lead | Inbound prospect before qualification | HubSpot |
| Contact | Individual person at a company | HubSpot |
| Company | Organization / account | HubSpot |
| Deal | Sales opportunity with stage and value | HubSpot |
| Meeting | Scheduled call or meeting | Google Calendar + Calendly + Zoom |
| Calendar Event | Scheduled event with attendees and context | Google Calendar |
| Transcript | Recording transcript from a call | Zoom |
| Proposal | Generated proposal deck | Gamma |
| NDA | Non-disclosure agreement | DocuSign |
| Email Thread | Conversation thread | Gmail |
| Follow-up Task | Scheduled action item | HubSpot + Internal |
| Capability Asset | Sample work, case study, capabilities PDF | Google Drive |
| Case Study Asset | Past project write-up | Google Drive |
| Objection | Customer concern or blocker | Gmail + Zoom |
| Sales Stage | Funnel position | HubSpot |
| Next Best Action | Recommended next step | Derived |

### Object links

- Lead ↔ Contact
- Contact ↔ Company
- Deal ↔ Company
- Deal ↔ Email Thread
- Deal ↔ Meeting
- Meeting ↔ Transcript
- Deal ↔ Proposal
- Deal ↔ NDA
- Deal ↔ Follow-up Tasks
- Deal ↔ Capability Assets
- Deal ↔ Objections
- Deal ↔ HubSpot Stage

### Derived objects

Generated by Ziggy and represent high-value intelligence:

| Object | Description |
|--------|-------------|
| Deal Brief | Comprehensive deal summary across all sources |
| Discovery Summary | Structured output from transcript analysis |
| Solution Hypothesis | Proposed approach based on discovery |
| Proposal Brief | Inputs for proposal generation |
| Risk Flags | Identified risks for a deal |
| Escalation Item | Issue requiring human judgment |
| Follow-up Recommendation | Suggested next touch with rationale |

---

## Skills

### Query skills (read-only)

| Skill | Inputs | Sources | Description |
|-------|--------|---------|-------------|
| Summarize Deal | Deal name | HubSpot, Gmail, Zoom, Drive | Full deal brief across all touchpoints |
| Discovery Summary | Transcript | Zoom | Structured extraction: pains, budget, timeline, features |
| Account Timeline | Company name, time range | HubSpot, Gmail, Zoom | Chronological view of all interactions |
| Find Similar Deals | Deal characteristics | HubSpot | Past deals with similar profile for reference |
| Inbox Triage | Time range | Gmail | Classify inbox threads by urgency and deal |
| Aging Pipeline Report | Stage, age threshold | HubSpot | Deals needing attention |
| Objection Analysis | Deal name | Gmail, Zoom | Extract and categorize objections |

### Mutation skills (take action)

| Skill | Inputs | Action | Approval |
|-------|--------|--------|----------|
| Draft Lead Response | Lead context | Gmail draft | Yes |
| Draft Follow-up Email | Deal context, purpose | Gmail draft | Yes |
| Draft Capabilities Package | Discovery summary | Gmail draft + Drive attachments | Yes |
| Generate Proposal | Discovery summary, template | Gamma creation | Yes |
| Send Scheduling Link | Contact, meeting type | Gmail + Calendly link | Configurable |
| Update Deal Stage | Deal, new stage | HubSpot mutation | Configurable |
| Create Follow-up Task | Deal, description, due date | HubSpot task | No |
| Log Note to Deal | Deal, note content | HubSpot note | No |

### Composite skills (read + write)

| Skill | Description |
|-------|-------------|
| Process Inbound Lead | Enrich → classify → draft response → create records |
| Post-Discovery Follow-up | Summarize transcript → select assets → draft email |
| Proposal Package | Generate brief → create deck → draft delivery email |
| Pipeline Health Check | Scan all deals → flag risks → draft follow-ups |
| Daily Sales Briefing | Inbox scan + pipeline review + action recommendations |

---

## Workflows

All workflows use Temporal for durability (retries, schedules, approvals, pauses).

### 1. Inbound Lead Triage

```
Trigger: New lead arrives in HubSpot
Steps:
  1. Create / match HubSpot records (contact, company)
  2. Enrich context (check existing deals, email history, company info)
  3. Classify lead quality
  4. Draft initial response
  5. -> HITL: Approve response
  6. Send response via Gmail
  7. Create follow-up task (3 business days)
  8. Update HubSpot stage
```

### 2. Discovery Workflow

```
Trigger: Discovery call completed (Zoom meeting ends)
Steps:
  1. Pull Zoom transcript
  2. Generate discovery summary (pains, budget, timeline, features needed)
  3. Extract solution hypothesis
  4. Draft capabilities follow-up email
  5. Attach relevant: sample work + capabilities PDF + feature highlights
  6. -> HITL: Review draft and attachments
  7. Send follow-up via Gmail
  8. Create HubSpot tasks for action items
  9. Update deal fields and stage
```

### 3. NDA Workflow

```
Trigger: Manual or deal reaches NDA stage
Steps:
  1. Determine if NDA needed (check company, deal value)
  2. Prepare DocuSign envelope with standard NDA
  3. -> HITL: Approve NDA send
  4. Send via DocuSign
  5. Monitor completion status (poll or webhook)
  6. On completion: notify, update HubSpot, unlock proposal workflow
  7. On timeout (7 days): remind, escalate
```

### 4. Proposal Workflow

```
Trigger: NDA complete OR manual trigger
Steps:
  1. Gather context: discovery summary, deal brief, requirements
  2. Generate proposal brief from master prompt
  3. Populate Gamma template with proposal content
  4. Draft proposal delivery email
  5. -> HITL: Review deck + email
  6. Send proposal via Gmail with deck attached/linked
  7. Schedule proposal delivery follow-up (3 business days)
  8. Update HubSpot stage to "Proposal Sent"
  9. Create follow-up task
```

### 5. Sales Inbox Triage (multi-daily)

```
Trigger: Scheduled (every 3 hours during business hours, 8am–6pm ET)
Steps:
  1. Scan Gmail inbox for sales-related threads since last run
  2. Classify each thread: needs_response / fyi / escalation / cold
  3. For "needs_response": draft reply with deal context, queue for HITL
  4. For "escalation": post to Chris's Slack DM, no auto-reply
  5. For "fyi": summarize, log to deal record, no draft
  6. For "cold": link to cold-deal touch-base workflow
  7. Update HubSpot deal context with new information
```

### 6. Aging Pipeline Review (daily)

```
Trigger: Scheduled (daily, 9am ET)
Steps:
  1. Query HubSpot for deals by stage and last activity
  2. Identify: cold leads (7+ days), stalled proposals (5+ days),
     unresponded threads (3+ days), aging deals (14+ days no movement)
  3. For each: generate follow-up recommendation
  4. Draft follow-up messages where appropriate
  5. Queue recommendations for HITL review
  6. Auto-create internal reminders for high-priority items
```

### 7. Cold Deal Touch-Base (weekly)

```
Trigger: Scheduled (Monday 7am ET) OR upstream from Sales Inbox Triage
Steps:
  1. Query HubSpot for deals matching cold-state buckets:
     - discovery_held + no_proposal_appt (no follow-up call booked)
     - proposal_sent + no_response (>5 business days)
     - nda_sent + not_signed (>7 days)
     - intro_call_no_show + no_reschedule
     - any_stage + last_touch >14 days
  2. For each cold deal: pull last interaction context (last call summary,
     last email, deal stage, dollar amount)
  3. Pick the right touch-base template based on bucket + dollar value
  4. Draft a personalized touch-base email referencing prior thread
  5. -> HITL: review batch in /dashboard/review (one row per deal)
  6. On approve: send via Gmail; log activity to HubSpot deal
  7. Schedule next touch-base in 7 days if still cold
```

### 8. Weekly HubSpot Hygiene (weekly, HITL-heavy)

```
Trigger: Scheduled (Friday 4pm ET) OR manual before sales meeting
Steps:
  1. Query all open deals
  2. Run hygiene checks per deal:
     - Missing or stale required fields (close_date, deal_amount, stage,
       next_step, primary_contact)
  3. Detect anomalies:
     - Stage older than typical for this deal type
     - Close date in the past
     - Conflicting source data (HubSpot deal stage vs Zoom evidence vs
       email evidence)
     - Duplicate or merge candidates
  4. For each issue: propose a fix (update field, advance/regress stage,
     suggest merge)
  5. -> HITL: bulk-review proposed updates in /dashboard/review
  6. On approve: write changes to HubSpot, log audit trail
  7. Generate hygiene report (what was fixed, what's still flagged)
```

### 9. Weekly Pipeline Report (Mondays before sales meeting)

```
Trigger: Scheduled (Monday 8am ET, before weekly sales sync)
Steps:
  1. Pull pipeline snapshot from HubSpot
     - Open deals by stage, value, age
     - Won/lost since last week
     - New deals created
     - Stage movements (forward + backward)
  2. Pull recent activity context
     - Discovery calls held since last meeting
     - Proposals sent
     - No-shows and rescheduled meetings
  3. Identify discussion-worthy items:
     - Top 5 deals by value (with status + risks)
     - Stuck deals needing decisions
     - Wins to celebrate, losses to debrief
     - Capacity / commit signals
  4. Generate meeting brief (Markdown + Gamma deck)
  5. -> HITL: review brief, edit highlights
  6. On approve: post to #sales Slack channel + email to attendees
```

### HITL checkpoints (required)

| Checkpoint | When |
|------------|------|
| Qualification edge cases | Lead doesn't fit standard profile |
| Pricing and packaging | Any pricing mention |
| Custom feature commitments | Beyond standard offering |
| Legal or procurement questions | Anything beyond standard NDA |
| Objections affecting scope/terms | Customer pushback on key terms |
| Proposal final approval | Before sending deck |
| Stage moves with revenue significance | Enterprise deals, renewals |

---

## Sprint plan

2-week sprints. Assumes platform foundation (Phase 1) is in progress in parallel.

### Sprint 1: Model and visibility (Weeks 1-2)

- [ ] Define Ziggy sales object model in DB schema
- [ ] Define HubSpot stage map (Lead → Contact → Discovery → NDA → Proposal → Negotiation → Closed)
- [ ] Connect HubSpot (contacts, companies, deals, tasks, notes)
- [ ] Connect Gmail (read inbox, threads)
- [ ] Connect Zoom (meeting records, transcripts)
- [ ] Connect Google Drive (read capabilities PDFs, case studies, sample work)
- [ ] Ingest existing sales assets into context layer
- [ ] Build deal context view (pull HubSpot + Gmail + Zoom data for a deal)
- [ ] Basic ask/search for deal context ("tell me about the Acme deal")

**Milestone:** Ziggy can see and answer questions about any deal.

### Sprint 2: Assisted drafting (Weeks 3-4)

- [ ] Transcript summary skill (Zoom → structured discovery summary)
- [ ] Follow-up email draft skill (context → Gmail draft)
- [ ] Capability asset selection skill (discovery → relevant samples/PDFs)
- [ ] Proposal brief skill (discovery + deal context → proposal brief)
- [ ] Build approval UI (review/edit/approve/reject flow)
- [ ] Wire Gmail send action (draft → HITL approve → send)
- [ ] Wire HubSpot note/task creation

**Milestone:** Ziggy drafts, Chris reviews and approves.

### Sprint 3: Proposal ops (Weeks 5-6)

- [ ] Connect Gamma API
- [ ] Build proposal template system (master prompt + Slides template)
- [ ] Proposal generation workflow (brief → deck → email → HITL → send)
- [ ] HubSpot stage sync (auto-update stage on key events)
- [ ] Proposal delivery email skill
- [ ] Follow-up scheduling after proposal send
- [ ] Connect Calendly for scheduling links

**Milestone:** End-to-end proposal flow from discovery to delivery.

### Sprint 4: Inbox and follow-up (Weeks 7-8)

- [ ] Daily inbox scan workflow (Temporal scheduled, 8am)
- [ ] Inbox thread classifier (needs response / FYI / escalation)
- [ ] Objection/escalation detection and routing
- [ ] Aging pipeline workflow (daily, identify stalled items)
- [ ] Follow-up recommendation generator
- [ ] HITL escalation queue view
- [ ] Dashboard: pipeline health, aging deals, pending approvals

**Milestone:** Ziggy monitors the pipeline daily and surfaces what needs attention.

### Sprint 5: NDA + autonomy rules (Weeks 9-10)

- [ ] Connect DocuSign
- [ ] NDA workflow (prepare → HITL → send → monitor → complete)
- [ ] Policy engine: define which actions auto-run vs require approval
- [ ] Selective auto-send (acknowledgments, scheduling links, internal notes)
- [ ] Better stage progression rules
- [ ] Eval dashboard (run quality, approval rates, escalation frequency)
- [ ] Feedback loop (track corrections, missed context, wrong recommendations)

**Milestone:** Ziggy operates semi-autonomously within defined policy boundaries.

### Ongoing after launch

**Weekly:** review bad runs and escalations, fix object mappings, tune prompts, adjust approval rules, inspect stalled workflows.

**Monthly:** refresh case study / capability asset library, update proposal template logic, review funnel metrics, expand skill pack.

**Quarterly:** improve scoring and classification, add connectors, refine stage models, package into repeatable client offer, compare performance against human baseline.

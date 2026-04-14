# Ziggy Workflows

All workflows use Temporal for durability (retries, schedules, approvals, pauses).

## 1. Inbound Lead Triage
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

## 2. Discovery Workflow
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

## 3. NDA Workflow
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

## 4. Proposal Workflow
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

## 5. Sales Inbox Triage (multi-daily)
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

## 6. Aging Pipeline Review (daily)
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

## 7. Cold Deal Touch-Base (weekly)
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

## 8. Weekly HubSpot Hygiene (weekly, HITL-heavy)
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

## 9. Weekly Pipeline Report (Mondays before sales meeting)
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

## HITL Checkpoints (Required)

| Checkpoint | When |
|------------|------|
| Qualification edge cases | Lead doesn't fit standard profile |
| Pricing and packaging | Any pricing mention |
| Custom feature commitments | Beyond standard offering |
| Legal or procurement questions | Anything beyond standard NDA |
| Objections affecting scope/terms | Customer pushback on key terms |
| Proposal final approval | Before sending deck |
| Stage moves with revenue significance | Enterprise deals, renewals |

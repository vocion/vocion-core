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

## 5. Daily Inbox Scan
```
Trigger: Scheduled (daily, 8am)
Steps:
  1. Scan Gmail inbox for sales-related threads
  2. Classify each thread: needs response / FYI / escalation
  3. For "needs response": draft response, queue for HITL
  4. For "escalation": create escalation item, notify Chris
  5. For "FYI": summarize and log
  6. Update deal context with new information
```

## 6. Aging Pipeline Review
```
Trigger: Scheduled (daily, 9am)
Steps:
  1. Query HubSpot for deals by stage and last activity
  2. Identify: cold leads (7+ days), stalled proposals (5+ days),
     unresponded threads (3+ days), aging deals (14+ days no movement)
  3. For each: generate follow-up recommendation
  4. Draft follow-up messages where appropriate
  5. Queue recommendations for HITL review
  6. Auto-create internal reminders for high-priority items
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

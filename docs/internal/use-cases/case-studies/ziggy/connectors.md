# Connectors & actions

## Required Connectors

### Phase 1 (v1) — Connected
| Connector | Purpose | Status |
|-----------|---------|--------|
| HubSpot | CRM - contacts, companies, deals, tasks, notes, pipeline | Connected |
| Gmail | Email threads, send/draft emails | Connected |
| Google Drive | Capabilities PDFs, case studies, sample work | Connected |

### Phase 1 (v1) — Pending
| Connector | Purpose | Notes |
|-----------|---------|-------|
| Gamma | Proposal template, deck generation | API integration (no Onyx connector needed) |
| Google Calendar | Meeting context, attendees, scheduling | No Onyx connector — build custom or use API |
| Calendly | Meeting scheduling, availability, booking links | No Onyx connector — build custom or use API |
| Zoom | Meeting records, transcripts | No Onyx connector — build custom connector |

### Phase 2 (v2)
| Connector | Purpose |
|-----------|---------|
| DocuSign | NDA send, status tracking, completion |
| Slack | Internal notifications, escalation alerts |

## Required Actions

| Action | Type | Approval Required |
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

## Autonomy Progression

### Phase 2-3: All outbound comms require HITL approval
### Phase 4: Selected auto-send actions
Auto-run (no approval):
- Send initial polite acknowledgment
- Send scheduling link
- Post notes to HubSpot
- Create internal tasks
- Remind on aging deals
- Notify owner of inbox items

Still require review:
- Custom proposal email
- Pricing statements
- Solution commitments
- Objection handling
- Scope changes
- Anything legal beyond standard NDA

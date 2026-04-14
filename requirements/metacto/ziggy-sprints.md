# Ziggy Sprint Plan

2-week sprints. Assumes platform foundation (Phase 1) is in progress in parallel.

## Sprint 1: Model and Visibility (Weeks 1-2)

- [ ] Define Ziggy sales object model in DB schema
- [ ] Define HubSpot stage map (Lead -> Contact -> Discovery -> NDA -> Proposal -> Negotiation -> Closed)
- [ ] Connect HubSpot (contacts, companies, deals, tasks, notes)
- [ ] Connect Gmail (read inbox, threads)
- [ ] Connect Zoom (meeting records, transcripts)
- [ ] Connect Google Drive (read capabilities PDFs, case studies, sample work)
- [ ] Ingest existing sales assets into context layer
- [ ] Build deal context view (pull HubSpot + Gmail + Zoom data for a deal)
- [ ] Basic ask/search for deal context ("tell me about the Acme deal")

**Milestone:** Ziggy can see and answer questions about any deal.

## Sprint 2: Assisted Drafting (Weeks 3-4)

- [ ] Transcript summary skill (Zoom -> structured discovery summary)
- [ ] Follow-up email draft skill (context -> Gmail draft)
- [ ] Capability asset selection skill (discovery -> relevant samples/PDFs)
- [ ] Proposal brief skill (discovery + deal context -> proposal brief)
- [ ] Build approval UI (review/edit/approve/reject flow)
- [ ] Wire Gmail send action (draft -> HITL approve -> send)
- [ ] Wire HubSpot note/task creation

**Milestone:** Ziggy drafts, Chris reviews and approves.

## Sprint 3: Proposal Ops (Weeks 5-6)

- [ ] Connect Gamma API
- [ ] Build proposal template system (master prompt + Slides template)
- [ ] Proposal generation workflow (brief -> deck -> email -> HITL -> send)
- [ ] HubSpot stage sync (auto-update stage on key events)
- [ ] Proposal delivery email skill
- [ ] Follow-up scheduling after proposal send
- [ ] Connect Calendly for scheduling links

**Milestone:** End-to-end proposal flow from discovery to delivery.

## Sprint 4: Inbox and Follow-up (Weeks 7-8)

- [ ] Daily inbox scan workflow (Temporal scheduled, 8am)
- [ ] Inbox thread classifier (needs response / FYI / escalation)
- [ ] Objection/escalation detection and routing
- [ ] Aging pipeline workflow (daily, identify stalled items)
- [ ] Follow-up recommendation generator
- [ ] HITL escalation queue view
- [ ] Dashboard: pipeline health, aging deals, pending approvals

**Milestone:** Ziggy monitors the pipeline daily and surfaces what needs attention.

## Sprint 5: NDA + Autonomy Rules (Weeks 9-10)

- [ ] Connect DocuSign
- [ ] NDA workflow (prepare -> HITL -> send -> monitor -> complete)
- [ ] Policy engine: define which actions auto-run vs require approval
- [ ] Selective auto-send (acknowledgments, scheduling links, internal notes)
- [ ] Better stage progression rules
- [ ] Eval dashboard (run quality, approval rates, escalation frequency)
- [ ] Feedback loop (track corrections, missed context, wrong recommendations)

**Milestone:** Ziggy operates semi-autonomously within defined policy boundaries.

## Ongoing After Launch

### Weekly
- Review bad runs and escalations
- Fix object mappings
- Tune prompts
- Adjust approval rules
- Inspect stalled workflows

### Monthly
- Refresh case study / capability asset library
- Update proposal template logic
- Review funnel metrics
- Expand skill pack

### Quarterly
- Improve scoring and classification
- Add connectors
- Refine stage models
- Package into repeatable client offer
- Compare performance against human baseline

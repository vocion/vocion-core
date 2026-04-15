# Overview — Ziggy (sales ops)

## What Ziggy Is

Ziggy is the first packaged GTM agent built on the Vocion platform. It acts as a sales coordinator + proposal ops specialist + follow-up analyst for MetaCTO.

## Positioning

- **Vocion** = the reusable enterprise context platform (connectors, objects, skills, workflows, HITL, observability)
- **Ziggy** = the first vertical package built on top of it (Sales Ops / RevOps)

## What Ziggy Can Do (End State)

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

## Platform vs Ziggy Boundary

### Platform (build once, reuse across clients)
- Auth and tenancy
- Connector framework
- Object model engine
- Skill registry
- Workflow engine (Temporal)
- HITL inbox
- Audit/logging
- Eval and feedback loop
- Admin UI
- Chat/work UI shell
- Permissions model
- Action execution layer
- Notifications
- Run history

### Ziggy (configure + lightly extend per use case)
- HubSpot object mappings
- Gmail actions
- Calendly scheduling logic
- Zoom transcript ingestion
- Proposal generation skill
- NDA workflow
- Sales follow-up workflow
- Daily inbox triage
- Funnel stage rules
- Escalation rules
- Proposal delivery process

## What Is Code vs Configure vs Managed Services

### Build in Code Once (Platform)
- API layer, auth/RBAC, connector adapters, object mapping engine
- Run engine, approval framework, feedback framework, audit logging
- Notification framework, workflow runner (Temporal), agent runner (LangGraph)
- Observability integration, admin UI shell, work UI shell

### Configure Per Use Case (Ziggy Config)
- Connector credentials, canonical object mappings, stage definitions
- Prompts, skill schemas, template choices, approval rules
- Escalation rules, source scopes, retrieval rules, playbooks
- Email tone/persona, proposal template, case study selection rules

### Build as Reusable Managed-Service Codelets
- HubSpot adapter pack
- Gmail outbound pack
- Zoom transcript parser
- Gamma proposal generator
- Calendly scheduling pack
- DocuSign NDA pack
- Sales follow-up analyzer
- Inbox triage classifier
- Objection escalation logic
- Stage progression rules

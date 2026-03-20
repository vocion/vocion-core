# Roadmap

## Phase 1: Foundation

**Goal:** Ship the platform shell. Customer can connect systems and manage scopes. MetaCTO can operate safely.

**Build:**
- Onyx deployment on AWS
- CoreContext API layer
- Auth and tenancy (Clerk organizations)
- Connector admin UI
- Object store / metadata DB (PostgreSQL + Drizzle)
- Audit/event pipeline
- Feedback capture
- Basic admin console

**Milestone:** Customer can connect systems, manage scopes. Platform is operationally safe.

---

## Phase 2: Ask + Find

**Goal:** Ship the first visible value. A user can ask real business questions and inspect source context.

**Build:**
- Main chat/work UI (conversation pane)
- Search UI with filters
- Context drawer (evidence panel)
- Citations/evidence display
- Business-object-aware scoping
- 3-5 starter assistants
- 10-15 starter query skills

**Milestone:** Users can ask real business questions and explore grounded answers with evidence.

---

## Phase 3: Act

**Goal:** Turn answers into actions. A user can go from answer to ticket/email/CRM update/report in one flow.

**Build:**
- Action bar on answers
- Skill forms (input variables, output display)
- Mutation skills
- Approval model (basic)
- Run history
- Notifications
- Audit trail for actions

**Milestone:** Users complete work from within CoreContext, not just get answers.

---

## Phase 4: Automate

**Goal:** Turn skills into repeatable systems. Business processes run reliably, not just interactively.

**Build:**
- Temporal-backed workflows
- Schedules
- Event triggers
- Hooks/webhooks
- Retries and idempotency
- SLAs
- Human-in-the-loop approvals
- Run monitoring

**Milestone:** Repeatable business processes run on schedule with durability guarantees.

Note: This lives outside Onyx because Onyx's own workflows are still "coming soon."

---

## Phase 5: Govern + Optimize

**Goal:** Make it enterprise-grade and sticky. This is now a managed program, not a pilot.

**Build:**
- Policy packs
- Domain ownership model
- Analytics dashboards
- Eval workbench
- Skill/version governance
- Connector health monitoring
- Usage dashboards
- Adoption reporting

**Milestone:** Full governance layer. Enterprise-ready managed program.

---

## Phase 6: Verticalize

**Goal:** Turn the platform into vertical offers.

**Build vertical packs for:**
- Sales
- Support
- Product Ops
- Customer Success
- Finance/Procurement

**Each vertical pack includes:**
- Object model
- Connector bundle
- Skill pack
- Workflow pack
- Dashboard pack
- Training pack

**Milestone:** Repeatable go-to-market per vertical.

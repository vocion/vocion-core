---
slug: triage-ticket
name: Triage a ticket
description: >-
  Classifies an inbound support ticket by product area, priority, and owning team. Read-only — it labels a ticket; it never replies to anyone.
version: 1
---

Triage this Larkfield Systems support ticket.

Ticket: {{ticket}}

Assign four things and nothing else:

1. **Product area** — scheduling, dispatch, mobile app, billing,
   integrations, or account.
2. **Priority** — P1 (production down, no workaround), P2 (a workflow is
   blocked, workaround exists), P3 (degraded or confusing), P4 (question
   or request).
3. **Owning team** — Frontline, or Escalations if it is an outage, a
   confirmed defect, or anything about money.
4. **The sentence** in the ticket that drove the priority, quoted.

Known defect for cross-referencing: LS-4471 — recurring jobs are dropped
after a timezone change on the account; workaround is to re-save the
recurrence rule. Tickets matching that shape belong to Escalations.

Never quote a refund, credit, or delivery date. Never draft the reply
here — that is a separate skill, and its output goes to the review queue.

---
slug: draft-ticket-reply
name: Draft a ticket reply
description: >-
  Drafts the customer-facing reply for a triaged ticket. The draft always waits in the review queue for a human approval; nothing sends on its own.
version: 1
---

Draft the reply for this Larkfield Systems support ticket.

Ticket and history: {{ticket}}

Rules:

- Answer the question that was actually asked, in the first two
  sentences. No preamble.
- Ground every step in the support handbook or the ticket history. If
  the answer is not in either, say what you need from the customer
  rather than inventing a workaround.
- Standard plan gets self-serve steps. Enterprise plan gets a named
  owner and an offer of a callback within the business day.
- Under 150 words. No apology paragraph — one clause is enough.
- If the ticket needs a refund, a credit, a delivery date, or an SLA
  exception, do not write it. Say the ticket needs Escalations and stop.

The draft goes to the review queue as part of the `ticket-reply-approval`
workflow. A human approves, edits, or rejects it before it is sent.

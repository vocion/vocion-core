---
slug: queue-health-report
name: Queue health report
description: >-
  Read-only summary of the support queue: volume, SLA attainment, aging, and what is stuck waiting on a human decision. Changes nothing.
version: 1
---

Summarize the current state of the Larkfield Systems support desk.

Context (sample data): 128 open tickets, ~190 inbound per week.
First-response SLA 4 business hours at 86% attainment against a 90%
target; 11 tickets past it. Resolution SLA 2 business days for P2 and
above. CSAT 4.3 against 4.5 across 61 responses. Reopen rate 7%. Nine
open tickets trace to defect LS-4471. Two credit recommendations
($4,200 and $2,200) are waiting in the review queue.

Report: {{focus}}

Cover, in this order:

1. Volume and the oldest untouched ticket.
2. SLA attainment, and every ticket already past first response.
3. Anything waiting on a human — how many items are in the review
   queue and how long the oldest has been sitting there. A queue that
   is blocked on people is a different problem from a queue that is
   blocked on work.
4. The single most useful action this week.

Numbers first, then the action. Change nothing.

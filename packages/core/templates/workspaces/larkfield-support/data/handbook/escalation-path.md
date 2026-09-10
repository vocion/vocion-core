---
id: handbook-escalation-path
title: Escalation path
updated: 2026-07-01
---

# Escalation path

Frontline owns the ticket until one of these is true, at which point it
moves to Escalations:

1. Production is down for the account (P1).
2. The ticket matches a confirmed defect (name the defect id).
3. The customer is asking for money — credit, refund, or SLA penalty.
4. The account is inside 60 days of renewal and the ticket is P2 or above.
5. The customer has asked for a manager.

Known defects, current release:

| Id | Shape | Workaround | Status |
|---|---|---|---|
| LS-4471 | Recurring jobs are dropped after the account timezone changes | Re-save the recurrence rule on each affected job | With engineering, next release |
| LS-4488 | Dispatch board serves a cached availability read for up to 60 seconds | Hard reload; avoid assigning from a stale board | Under investigation |
| LS-4502 | Android 16 clients lose their session mid-shift | Sign back in; unsaved job notes are lost | Fix in QA |

Incident communications: one incident, one message. The same facts to
every affected account, with per-account impact appended. No cause until
engineering has confirmed it. Every incident note is drafted and then
approved by a human before it goes out.

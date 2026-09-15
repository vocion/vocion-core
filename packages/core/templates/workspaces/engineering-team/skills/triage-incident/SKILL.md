---
slug: triage-incident
name: Triage an incident
description: >-
  Classifies an open incident by severity and blast radius and assembles the recent-change timeline. Read-only — it never touches a running system.
version: 1
---

Triage this incident for the on-call engineer.

Incident: {{incident}}

Return four things and nothing else:

1. **Severity** — SEV1 (customer-facing outage, no workaround), SEV2
   (major degradation or a blocked workflow with a workaround), SEV3
   (partial or internal degradation), SEV4 (no customer impact). Quote
   the line of the severity matrix that decides it.
2. **Blast radius** — which services, which environments, roughly how
   many customers, and since when. Say "unknown" where it is unknown.
3. **Recent changes** — every deploy, merged pull request, or config
   change in the 24 hours before the first symptom that could plausibly
   be involved, by id, most suspicious first, each with one line saying
   why it is on the list.
4. **Next diagnostic step** — the single cheapest check that would
   distinguish between the top two hypotheses.

Do not propose a fix action, a rollback, or a restart. Name the option
and hand the decision to the on-call engineer.

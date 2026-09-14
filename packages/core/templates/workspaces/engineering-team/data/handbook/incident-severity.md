---
title: Incident severity matrix
owner: Platform team
updated: 2026-07-30
---

# Incident severity matrix

| Severity | Definition | Response |
|---|---|---|
| SEV1 | A customer-facing capability is unavailable and there is no workaround | Page on-call immediately; incident channel; status page inside 15 minutes |
| SEV2 | Major degradation, or a customer workflow is blocked but a workaround exists | Page on-call in business hours; status page if it lasts over an hour |
| SEV3 | Partial degradation, elevated errors, or an internal system down | Ticket, handled next business day |
| SEV4 | No customer impact — noisy alert, cosmetic defect | Ticket, no page |

Severity is decided by impact, never by cause. A one-line configuration
mistake that takes checkout offline is a SEV1.

Severity is re-evaluated every 30 minutes while an incident is open, and
may go down as well as up.

## Known defects referenced by open incidents

| Id | Symptom | Workaround |
|---|---|---|
| PLAT-3312 | Scheduled jobs are skipped for an hour after a daylight-saving transition | Re-save the schedule |
| PLAT-3350 | Bulk import times out over 10,000 rows | Split the file |

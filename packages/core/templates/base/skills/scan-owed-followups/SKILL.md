---
slug: scan-owed-followups
name: Scan Owed Follow-Ups
description: >-
  Read follow-up tracker rows and rank what is owed right now: aging computed against the calling mission SLA, breaches first. Pure read over structured tracker state.
playbooks:
  - warming-etiquette
version: 1
---

# Scan Owed Follow-Ups

Rank owed follow-ups from structured tracker rows.

Input: follow-up tracker rows (from lookup_objects, type "follow-up"),
today's date, and the calling mission's SLA in days (default 4).

For each open row compute:

- days_owed = days from event_date (or last_touch, when later) to today
- sla_breached = today is past due_date

Output a ranked list: SLA breaches first, then priority high before normal,
then oldest first. For each row show contact, company, the owed action, the
source event and its date, days owed (marking breaches), and the personal
hook the touch should be built on. End with a one-line summary: N owed, M
breaching the SLA.

Rules:

- Rank ONLY the rows provided; never invent, merge, or drop a row.
- If a row is missing the dates needed to compute aging, list it in a
  "needs data" section rather than guessing.
- Never search raw sources; this is a pure read over tracker state.

---
slug: extract-event-debrief
name: Extract Event Debrief
description: >-
  Turn a raw event debrief (notes, activity log, transcript) into structured tracker rows: one event record plus one follow-up row per contact owed a touch.
version: 1
---

# Extract Event Debrief

Turn a raw event debrief into structured tracker rows.

Input: debrief text (meeting notes, a wiki activity log, a transcript, a
dossier) plus optional source references and an SLA in days from the calling
mission (default 4).

Output JSON with two keys:

- "event": { title, date, location, event_type, role, attendees,
  contacts_met, debrief_source }
- "follow_ups": one row per contact met or owed a touch, each with
  { contact, company, contact_title, owed_action, channel, source_event,
  event_date, due_date, priority, relationship_status, personal_hook,
  linkedin_url }

Rules:

- Extract only people and facts present in the debrief; never invent a
  contact or a hook.
- due_date = event_date plus the SLA. Flag rows missing the data to compute
  it instead of guessing.
- Writing the rows is a separate, reviewable step; you only structure them.

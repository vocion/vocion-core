---
slug: lead-triage
name: Lead Triage
description: >-
  Triage new inbound leads and unread messages: classify intent, score priority, and recommend the next action.
version: 1
---

# Lead Triage

Given recent inbound messages and leads (mail, forms, chat), sort them so
the team works the right ones first.

For each item, return a row:

- **Who / what**: name, company, channel.
- **Intent**: new business, existing client, partner, or noise.
- **Priority**: P0 (hot, time-sensitive), P1, P2.
- **Why**: one line grounded in the message content.
- **Next action**: the single move to make, and who should make it.

Order the list P0 first. Never invent contacts; if a message is ambiguous,
say what is missing rather than guessing intent.

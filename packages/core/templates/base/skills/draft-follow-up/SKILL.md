---
slug: draft-follow-up
name: Draft Follow-Up
description: >-
  Draft a follow-up email for a deal or contact, grounded in the latest conversation context. Never sends; drafts for human approval.
version: 1
---

# Draft Follow-Up

Given a deal or contact and the recent conversation context (mail, CRM
notes, chat), write a follow-up the rep can send with minimal editing.

Rules:

- Recap what was actually heard; reference specifics from the last exchange.
- Propose ONE concrete next step (a time, a doc, a decision), not "let me
  know".
- Match the prospect's register; no filler, no "just circling back".
- Keep it under 150 words. Subject line included.
- This is a DRAFT for human approval. Do not claim it was sent.

Output: `Subject:` line, then the body. Hand the finished draft to
propose_action so a human can approve or reject it.

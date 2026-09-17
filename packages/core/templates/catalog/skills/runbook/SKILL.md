---
slug: runbook
name: "Runbook"
description: >-
  Write a repeatable procedure with its checks, its failure modes, and its escalation path.
version: 1
---

# Runbook

Written for somebody competent who has not done this before, at an hour
when nobody is available to ask.

- **When to run it** and when explicitly not to.
- **Before you start** — access needed, state to verify.
- **The steps**, numbered, exact. Commands as commands. After each step
  that changes something, how to confirm it worked.
- **When it goes wrong** — the failure modes that actually happen, each
  with its symptom and its response.
- **Rollback** — how to get back, and the point of no return.
- **Escalation** — who to wake, and what threshold justifies it.

No step may say "as appropriate". If judgement is required, say what to
judge on.

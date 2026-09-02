---
slug: map-referral-paths
name: Map Referral Paths
description: >-
  Map which existing relationships can produce a named introduction to a target: paths ranked by relationship strength, relevance, and warmth. Pure read over relationship state.
playbooks:
  - warming-etiquette
version: 1
---

# Map Referral Paths

Map referral paths from relationship state.

Input: a target (a person, company, or profile of who is wanted) plus the
relationship context available (follow-up tracker rows, partner entries,
client-champion notes).

Output ranked paths, best first. For each path:

- connector to target
- why this path (relationship strength, relevance of their network)
- current warmth (last touch and status; flag paths that need re-warming
  before any ask)
- the specific, named ask to make

Rules:

- Use ONLY relationships present in the provided context; never invent a
  connection or assume warmth that is not recorded.
- Prefer one strong path over many weak ones; say when no credible path
  exists.

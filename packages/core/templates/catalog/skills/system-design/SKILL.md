---
slug: system-design
name: "System Design"
description: >-
  Define boundaries, data model, interfaces, failure modes and behaviour under load.
version: 1
---

# System Design

Start from the constraints: expected volume, growth, latency requirements,
consistency needs, and what must not fail. A design without stated
constraints cannot be evaluated.

- **Boundaries** — the components and what each owns. Ownership of data is
  the boundary that matters.
- **Data model** — entities, relationships, and where the source of truth
  for each field lives.
- **Interfaces** — the shape between components, and what is guaranteed
  across each.
- **Failure modes** — what happens when each dependency is slow,
  unavailable, or returns wrong data. Partial failure is the normal case.
- **At scale** — what breaks first, at what volume, and the early signal.

State what this design deliberately does not handle.

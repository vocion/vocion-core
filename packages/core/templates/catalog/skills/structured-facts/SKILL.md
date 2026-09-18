---
slug: structured-facts
name: "Structured Facts"
description: >-
  Audit and author the canonical machine-readable facts about an entity, and find where they contradict each other.
version: 1
---

# Structured Facts

Answer engines assemble from whatever they can find. The job is to make the
findable version correct and consistent.

- **Inventory.** Where facts about the entity exist — the site, the
  profiles, the directories, the third-party pages that rank.
- **Contradictions.** The same fact stated differently in two places. Name
  the field, both values, and which is authoritative. This is the finding
  that matters most and the one nobody looks for.
- **Gaps.** Facts a reader would reasonably want and no source states.
- **Machine-readability.** Whether the canonical version is expressed in a
  form a parser can take, not only in prose.

Author the canonical set as one document with a single owner, so the next
contradiction has somewhere to be resolved against.

**Never invent a fact to fill a gap.** An unstated fact is a task for a
person; a plausible one is a contradiction you created.

Order fixes by how often the wrong version is likely to be read.

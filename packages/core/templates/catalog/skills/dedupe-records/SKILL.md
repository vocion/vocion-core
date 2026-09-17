---
slug: dedupe-records
name: "Dedupe Records"
description: >-
  Identify duplicate records and propose merges with the survivor rule shown.
version: 1
---

# Dedupe Records

Match on the authored keys, strongest first. Report the strength of each
match — an exact identifier match and a fuzzy name match are not the same
claim and must not be presented as one.

For each candidate pair: what matched, what differs, and which record
should survive under the authored rule. Show the field-level conflicts,
because that is where a merge loses data.

**Never merge automatically.** A merge is usually irreversible. Present
candidates grouped by confidence and let somebody decide each group.

Where the rule does not resolve a conflict, say so and leave it to a
person rather than picking.

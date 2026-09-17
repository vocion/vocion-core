---
slug: dedupe
name: "Duplicate Check"
description: >-
  Check an incoming item against known issues and existing records before it is routed.
version: 1
---

# Duplicate Check

Search before routing, three ways: by symptom or subject, by the person or
organisation it came from, and by area.

Order the shortlist by overlap, then judge whether it is genuinely the
same. Fail open — where it is unclear, treat it as new. A duplicate in the
queue can be merged; a real item discarded as a duplicate is gone.

On a match: link rather than open, add anything new the report contributes,
and raise priority if it adds urgency. Tell the person it is known and
being tracked — being linked to an existing item without being told reads
as being ignored.

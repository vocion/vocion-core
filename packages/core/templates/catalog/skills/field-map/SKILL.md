---
slug: field-map
name: "Field Map"
description: >-
  Introspect the live schema and report what this organisation actually uses.
version: 1
---

# Field Map

Read the schema from the connected system itself. Never assume the vendor's
defaults are in play — most organisations have renamed, added, and
abandoned fields.

Report: the fields that exist, their human labels alongside their API
names, their types and allowed values, and which are required.

Then the part nobody has: **which fields are actually populated**, and how
often. A required field that is blank on most records is not a required
field in practice, and a custom field nobody fills is a trap for anyone
building a report on it.

Flag fields whose label and contents disagree. They are where migrations go
to die.

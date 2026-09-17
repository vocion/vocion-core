---
slug: profile-dataset
name: "Profile Dataset"
description: >-
  Report a dataset's shape, null rates, duplicates, distributions and quality flags.
version: 1
---

# Profile Dataset

Answer first: how many rows, what one row represents, and what period it
covers.

Per column: type, null rate, distinct count, and for numerics the range and
the distribution shape. For categoricals, the top values and how much of
the data they cover.

Flag what will bite: duplicate keys where uniqueness was assumed, dates
outside a plausible range, values that are technically valid and obviously
wrong, columns that are entirely null, and columns whose name and contents
disagree.

Say which columns are safe to analyse and which need cleaning first. A
profile that does not end in that judgement leaves the work undone.

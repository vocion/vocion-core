---
slug: analysis-qa
name: "Analysis QA"
description: >-
  Review methodology, aggregation logic and bias before an analysis is shared.
version: 1
---

# Analysis QA

Check the reasoning, not just the arithmetic:

- **Does the data support the claim?** Correlation presented as cause is
  the most common failure and the most expensive.
- **Aggregation.** Averages hiding bimodal distributions; sums across
  different grains; ratios of ratios.
- **Selection.** Who or what is missing from the dataset, and would their
  inclusion change the answer.
- **Period.** Are the windows comparable, and does the trend survive a
  different but equally reasonable choice.
- **Survivorship.** Are the things that disappeared being counted.

End with a plain judgement: is this safe to act on, safe with caveats, or
not yet. Hedging here is what lets a weak analysis ship.

---
slug: sanity-pass
name: "Sanity Pass"
description: >-
  Check computed results for the errors that produce confident wrong numbers.
version: 1
---

# Sanity Pass

Run before anything is shown. These are the failures that actually happen:

- **Partial periods.** An incomplete current period against a full prior
  one always looks like collapse. Match the windows or label it loudly.
- **Double counting.** Two systems describing one event. Pick one as the
  source of that figure and say which.
- **Vanished groups.** A category with no rows this period must appear as
  zero, not disappear. A missing row reads as a data problem.
- **Totals that do not tie.** If the parts do not sum to the whole, say so
  rather than publishing a number you cannot defend.
- **Absent read as zero.** An empty or truncated response is a fact about
  the data, not about the business.

Report what you checked, not only what failed. A clean sanity pass is
information.

The four numbers on top answer the question. Everything under them is the
evidence for those numbers.

Every figure here is in model spend, and every one of them is either
**estimated** (the planner's `estimateCents` on each task, summed onto the
request, or the run's cap standing in where the planner wrote none) or
**measured** (the `cents` every worker run reported, summed over every run
each task took, then summed onto the request). A request with no actual has
not had a run end yet; an empty cell is honest. The total under each tag is
the cumulative spend on everything that carried it, and a request with two
tags is counted under both. Waste is money that was spent and then answered
rather than shipped; a zero there is a real answer, not a missing one.

**The two autonomy measures are not one measure.** Work autonomy is how much
reached an outcome and how much of that a person had to decide. Human
attention is what being in the loop cost a person: the decision minutes owed,
and how many decisions are still waiting. A single blended percentage would
hide whichever one is bad, so neither number is averaged into the other. The
team's own measures with their provenance, member by member, are on the core
report at [/dashboard/team-report](/dashboard/team-report), and the earned
autonomy ladder is at [/dashboard/autonomy](/dashboard/autonomy).

What people's time cost is here only in minutes. Per-run token counts are on
[Activity](/dashboard/p/activity), beside the run that spent them.

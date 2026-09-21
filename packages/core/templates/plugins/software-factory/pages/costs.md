Every figure here is in model spend, and every one of them is either
**estimated** (the planner's `estimateCents` on each task, summed onto the
request — or the run's cap standing in where the planner wrote none) or
**measured** (the `cents` every worker run reported, summed over every run
each task took, then summed onto the request). A request with no actual has
not had a run end yet; an empty cell is honest. The total under each tag is
the cumulative spend on everything that carried it, and a request with two
tags is counted under both. What people's time cost is not here — that is
the decision budget on the Backlog, in minutes.

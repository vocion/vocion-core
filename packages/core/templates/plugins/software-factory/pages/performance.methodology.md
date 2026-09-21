**Every figure is model spend, in cents.** A task's `actualCents` is the sum
of the `cents` each worker run reported for it, and a request's is the sum
over its tasks, rolled up by core and stamped `rollupsUpdatedAt`. A request
with no actual has not had a run end yet, and the empty cell is honest.
`estimateCents` is the planner's figure, or the run's cap standing in where
the planner wrote none.

**Cost per shipped outcome is a ratio, not an average.** The numerator is the
spend measured on shipped requests; the denominator is how many shipped, the
same number printed beside it. A shipped request with no measured spend counts
as a shipped request costing nothing, rather than being dropped from the
denominator. Divide the two figures and you get the third; that is the point.
Spend on work still building is not mixed in, and the `building` group in the
table shows how much of it there is.

**Rework, not waste.** Rework is spend that produced no accepted outcome and
had to be discarded or repeated: the tasks that ended `rejected` or
`abandoned`. Money spent investigating a request that was then answered
honestly is not rework. A request the factory looked at, understood and
declined for a written reason is a delivered outcome, and charging it as waste
would penalise exactly the judgement the factory is supposed to have.

**Ask to ship is measured, not modelled.** Business objects keep no history of
their state changes, so there is no record of the moment a request became
`shipped`. The honest stand-in is the release: `shippedAt` is the
`releasedAt` of the earliest release whose `requestIds` names the request.
Requests with no ask date or no release are left out of the median rather than
given a made-up one, so the figure is the median of what can be measured.

**Accepted first pass** counts only shipped requests that took at least one
task. A request that shipped without one had no implementation to accept, so
it is in neither half of the fraction.

**Defects reported** counts requests filed as a bug or an incident. Nothing in
the data links a bug back to the release that introduced it, so this cannot
distinguish a fault the factory shipped from one a person found in older work.

**Tags are filters, not sections.** A request carries as many tags as fit, so
tag totals double count: the same work appears under `naming` and under
`stamp`, and the same observability work under `observability` and
`analytics`. The table groups by outcome instead, where every request sits
once and the group totals sum to the page totals. Tags are still a column, and
spend by tag, model, agent, product and run is on Activity.

**The window is a cohort.** It selects the requests that ARRIVED inside the
chosen span, and every figure and every row on the page is over that set.
Arrival is the one date every request carries, so no two numbers here are
computed over different rows. A request asked before the window and shipped
inside it is not counted, and a longer window is one click away.

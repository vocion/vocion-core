What is running, what is proposed, and what just landed. Three tabs; a row is
one outcome, and opening it opens that outcome end to end, with its decisions,
tasks, runs, checks, pull request and cost.

**In progress puts what has stopped first.** A request whose state says
`building` while none of its tasks is running is not building, whatever the
state field claims — the lane reads that off the tasks themselves, badges the
row **Blocked**, and says how many of the lane have stopped. A stopped run
costs a day; a running one costs nothing to leave alone.

**Waiting on you is a badge, not a tab.** An outcome whose recommendation
nobody has decided is not moving, and it leads the Proposed tab wherever its
state sits. The decisions themselves are still taken in
[Review](/dashboard/inbox), one batch at a time, never here.

**Proposed is ordered**, and only work whose reason was recorded is ranked. A
request with no recorded reason cannot be argued to be the second most
important thing we do, so it queues unnumbered and the tab's note says how
many are in that state. That is the one place this page reports the gap; it
does not repeat it on every row.

Probes, smoke tests and end-to-end records are not shown. They are real
history and they belong in [Activity](/dashboard/p/activity), with the
finished work that has scrolled past the cap.

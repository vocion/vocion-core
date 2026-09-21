One queue. The outcome is the object: a row is a request the factory owes or
is delivering, and the engineering tasks underneath it are counted on the row,
not listed beside it. **Report** on any row opens that outcome end to end, and
the tasks, the runs, the checks and the pull requests are there.

The groups are the request's own state. Next is `new`, `triaged` and
`in_scope`; in progress is `building`; recently done is `shipped` and
`answered`. **Waiting on a person** cuts across all of them, so it is a
counter on top rather than a group: it is the number of rows the Product
manager has recommended and nobody has decided. Those decisions are taken on
Needs you (`/dashboard/inbox`), one batch at a time, never here.

**Why** is the point of the row. It is a reason code from a closed list, not a
score: `user_request`, `production_bug`, `blocks_goal`, `breaks_promise`,
`required_for_dogfood`, `manual_toil`, `platform_leverage`,
`factory_reliability`, `observed_behaviour`. Beside it, **Why, in words** is
the Product manager's own sentence. A request ranked before the codes existed
shows an empty codes cell and its sentence; the empty cell is the honest
reading, and the priority integer it replaced is deliberately not on this page.

The bottom of the evidence stack. Everything the factory did is here, which is
what lets Factory, Products, Work, Review and Performance stay calm.

A run says four independent things and they are four separate columns:
**execution** (did the worker reach a verdict), **verification** (did the
checks pass), **output** (a pull request, work preserved on a branch, or no
changes) and **task disposition** (accepted, rejected, retried). A row that
reads "execution completed, verification failed, work preserved, retried" is
saying four true things at once, where the old single status column had to
pick one and get the other three wrong.

The unit is the task. Every attempt is still here, grouped under the work it
was an attempt at, so five tries at one rename read as one piece of work.

A failure names its cause: **contract** (refused before work started),
**environment** (the machine could not be made ready), **verification** (the
work happened and the checks said no), **worker** (it broke or went quiet) or
**control** (Vocion, a deadline or a spend cap stopped it). Beside it,
whether the factory recovered on its own. Use the views above the summary to
read one cause at a time, or Unresolved for the only list that is actually
waiting on someone.

The agent, the model, the tokens, the heartbeat, the lease, the contract and
the worker's own paragraph are inside each row, under Evidence.

The other half of this section is [Releases](/dashboard/p/releases), every
deploy that reached people. Decisions are in the
[review queue](/dashboard/inbox).

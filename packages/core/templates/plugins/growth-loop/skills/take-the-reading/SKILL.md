---
slug: take-the-reading
name: Taking the reading, and writing the verdict
description: >-
  How a published brief is judged: when the reading is due and why the date is
  written in advance, taking it from the source and under the attribution model
  the brief named, establishing normal variation before calling anything a
  change, checking the boring explanations first, why a rate built on four
  events is not reported, when the verdict is unmeasurable and what that answer
  has to name, how the verdict reason is written, and how cost is reported
  against return without inventing a ratio. Read before writing any verdict, and
  whenever a number is about to be reported without its source.
playbooks: [measure-before-you-make]
version: 1
---

# Taking the reading, and writing the verdict

A brief's second verdict is the one that matters. The gate said the piece was
fit to publish; this says whether publishing it was worth doing.

## When

`readAfterDays` from `publishedAt`. The date is written with the brief for one
reason: a piece measured after three days and a piece measured after ninety are
not comparable, and without a fixed date the window quietly becomes "whenever
somebody looked", which is always a window that flatters the work.

More than one reading is normal. A number moves; one reading is an anecdote. Add
each to `readings` with its source and the date it was taken.

## Under which model

State the attribution model **before** the number, every time. First touch, last
touch, multi-touch and a holdout produce different winners from identical data.
Read the brief under the model its own brief named — not the one that flatters
it, and not a different model from the one used on the brief you are comparing
it with.

## Normal variation first

Before calling anything a change, know what the number does when nothing
happens. A movement inside normal variation is `no_effect`. Saying so is the
job; it is not a failure to find a result.

Then check the boring explanations before the interesting one:

- Did the **measurement** change — a new event, a renamed property, a filter?
- Did the **source** change — a different tool, a different date range default?
- Was **something else running** the same week? A number beside another campaign
  is not this brief's number, and the note field is where you say so.
- Is the **volume** large enough for a ratio to mean anything? Never report a
  rate built on four events. Report the four events.

## `unmeasurable` is a real verdict

Where no source exists, or volume is too small for any reading to mean anything,
the verdict is `unmeasurable` and the reason names **the instrument that is
missing** and what it would cost to have it.

> `unmeasurable` — the pricing page has no form event, so nothing distinguishes a
> demo request that came through it from one that came through the docs. The
> instrument is one event on the pricing form; until it exists no brief targeting
> that page can be judged.

That is honest and actionable. A channel quietly left out of the report reads as
a channel with no return — a lie by omission, and the most common one in growth
reporting.

## The verdict reason

Three sentences at most, naming the reading, the baseline it is compared with,
the window and the attribution model. On `no_effect`, say what would have had to
be true for the piece to work. On `hurt`, say it plainly and say it first: that
is the reading the team most needs and least wants.

## Every number carries its source

A figure you could not read this turn is not a figure you may report. Nothing is
estimated silently; where you estimate, label it and say from what.

## Cost against return

The cost is already on the record — core writes `actualCents` when a run for the
brief ends, beside the `estimateCents` somebody wrote in advance. Report the two
figures and let the ratio be read. Do not sum costs into a cost-per-outcome
nobody can re-derive; a ratio nobody can check is a number nobody should act on.

Name the channel that is not working, including the one somebody senior likes.
That is the reason the report exists.

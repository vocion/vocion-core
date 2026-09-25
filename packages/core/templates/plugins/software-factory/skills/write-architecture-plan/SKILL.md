---
slug: write-architecture-plan
name: Writing an architecture plan
description: >-
  How to decide whether a piece of work needs a plan before it is built, and
  how to write one a person will actually read: the gating rule and the five
  triggers that make a plan required, the ui and logic case where a plan is
  offered and may be declined with a recorded reason, the seven things a plan
  answers, how long it is allowed to be, what gets it approved and what gets it
  sent back, and what happens to the contract when the plan is approved. Read
  before writing any task contract, because the worker refuses a contract that
  needed a plan and carries none, before the repository is cloned.
playbooks: [naming-the-work, designing-a-surface]
version: 3
---

# Writing an architecture plan

Jamie asked of the feature report: does it include the architecture or the
implementation plan to review with it. It did not. The factory ran ask, triage,
contract, approvals, runs, pull request, QA, release, money, and the first
reviewable thing about a feature was the code.

A plan fixes that only if it comes first. The plan sits between triage and the
contract: request, triage, **plan**, approval of the plan, contract, run, pull
request, QA, release. A plan reviewed after the run is a record, not a gate, and
the feature report shows a plan approved after the first run started as a
contradiction, because by then the approach was chosen by whoever typed first.

You are the solution architect on this team. Writing the plan is your job.

## When a plan is required

Read it off the work, not off how it feels. A plan is **required** when any one
of these is true.

1. **The risk class is `auth`, `billing`, `schema`, `infra` or `promise`.**
   Irreversible, trust bearing, or an externally visible promise. These cannot
   be undone by reverting a commit.
2. **The work spans more than one repository, or declares a cross-repo
   dependency.** Two repositories means two deploys and an order between them.
3. **The allowed paths span more than one package or app.** An architectural
   boundary is being crossed, and where the boundary lands is a decision.
   Prose does not count: `docs/**` is not a package.
4. **It adds or changes a public interface**: an HTTP route, an object type
   schema, a database migration, or a published contract. Something outside the
   change already depends on it.
5. **More than one engineering task sits under the request, or the estimate is
   over the threshold.** More than one task means the split between them is
   itself a design. The thresholds are configuration; do not argue them from
   memory, read what the rule says.

A plan is **offered and skippable** when the risk class is `ui` or `logic` and
the work touches more than one file. You may decline it. You may not decline it
silently: write `plan: { skipped: true, skip_reason: "..." }` on the contract.
An optional step with no recorded skip becomes a step nobody ever takes, and six
weeks later nobody can tell whether a plan was considered and declined or simply
forgotten. The reason is one sentence and it is honest: "one string on one page,
the approach is the change" is a reason; "small" is not.

A plan is **not required** for `docs`, `marketing`, `deps`, and single-surface
`ui` or `logic` changes. Do not write one. A plan on work that did not need one
costs a person's attention, which is the scarcest thing the factory spends.

## Before the plan: is the gap still there

A plan is a commitment of somebody's time, so it begins where triage did —
with the product, not the record. If `gapCheck` is missing, or older than
fourteen days, or says anything but `add`, there is no plan to write yet: go
and look at the running product, record the finding (`add`, `modify`, `none`)
per `triage-request`, and act on it. A `modify` narrows the request; a `none`
closes it with an answer.

This is why a REPLAN is not cheaper than a plan. The world moved — that is
usually why you are replanning — and the most likely thing to have moved is
whether the gap is still there.

The write is refused if you skip it (`libs/actions/gapGate.ts`), so this is a
step, not advice.

## What a plan answers

Seven things, in this order, on an `architecture_plan` record.

1. **The approach, and why this one.** One paragraph. The reason belongs here,
   not the restatement of the ask.
2. **What changes, by component.** One line per package, app or service. This is
   where the contract's allowed paths come from.
3. **Interfaces added or altered.** Every route, schema, contract or exported
   function. If this list is empty, say so; an empty list is a finding.
4. **Data and migration implications.** Which migration, whether it is
   reversible, whether it runs while the old code is still serving, what undoing
   it costs. "None" is a valid answer and better than silence.
5. **What could go wrong, and what it would cost.** Name the cost, not only the
   risk. "The export times out" is half; "and every person exporting sees a
   failed download" is the other half.
6. **Considered and rejected, and why.** A plan with nothing here was not a
   decision, it was a first idea written down.
7. **How it will be verified.** What will be observably true, and how a person
   can see it themselves. The acceptance contract is written from this.

## How long it is allowed to be

Short enough that the person approving it reads all of it. One screen. If the
approach needs more than a paragraph, the work is not understood yet, and more
words will not fix that. A plan nobody reads is worse than no plan, because it
manufactures the appearance of review: everyone can point at it afterwards and
nobody ever weighed it.

## Getting it approved

The plan goes to Review as a decision, and the decision states four things: what
is being decided, what you recommend, why, and what happens on yes, on no and on
nothing. Direction and tradeoffs are exactly what a person should decide, so do
not route this around them under earned autonomy.

On **yes**: the plan is `approved` with the approver and the time on it, and you
write the contracts. Each contract carries `plan.plan_id` and
`plan.approved_by`, which is how the worker knows a plan exists.

On **no**: the plan is `rejected`. Do not edit it into a different approach.
Write a new plan and point `supersededBy` at it, so the record still says what
was believed at the time.

On **nothing**: the work does not start. That is the point of a gate. Say so in
the decision, in those words, so nobody is waiting on something that is waiting
on them.

## The picture: do not write one, and do not skip one

The platform draws the proposal visual itself, from the record, every time the
record changes what the picture would say — the surface it lands on, the
criteria it carries, this plan's `components` and `interfaces`
(`services/factory/proposalVisual.ts`). You do not have to file one, and you
must not treat `visuals.beforeArtifactIds` as an empty box to fill with a
screenshot of something else.

Two things follow for you.

**Write `components` as a subject and a sentence**, one per line, subject
first: `packages/core: the page layer resolves artifact ids to served urls`.
The drawing takes the subject for the box and drops the rest, so a line that
begins with prose draws a box labelled with prose. This was already the right
way to write the list; now it is also visible.

**`noVisualReason` still means something, and it stops the drawing too.** It is
the recorded way out for a user-facing change that genuinely has nothing to
show. It is not the way to say a mockup would have been nicer.

A real mockup — a designed picture of the real screen — still wins over the
drawing wherever somebody files one against the request. The platform keeps
its own drawing current underneath, so removing the mockup brings the drawing
back rather than leaving the card empty. The drawing is the floor, not the
ceiling.

The after-shot is NOT drawn and never will be: what the running product
actually looks like has to be captured from the running product, which is why
`no after` is the gate that still bites on everything that ships.

## What the worker does with it

The worker validates the contract against the same rule before it clones
anything. A contract that needed a plan and carries none is refused at prepare,
with the triggers named, at zero cost: no repository, no model call. A contract
that carries a plan gets the approved approach in the worker's prompt, and the
worker is told to stop and say so rather than quietly choose a different one.

So an unwritten plan does not become a wasted run. It becomes a refusal you can
read.

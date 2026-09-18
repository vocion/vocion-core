# Vocion Design Principles

> **Powerful systems should feel simple.**

Vocion is built for serious work. Underneath, it may involve agents, models, policies,
permissions, context, evals, traces, budgets, workflows and distributed systems. The person using
it should not have to think about any of that.

**Complexity belongs in the platform, not in the experience.** And the purpose of the platform is
not automation for its own sake — Vocion exists to improve outcomes for people and businesses.

This document is the bar for every product decision in this repository: features, pages, defaults,
entity fields, agent behaviour, and the workspaces built on top of it. When a proposal, brief or
pull request cannot pass [the test](#the-test), it is not finished.

## How to read this

Four **values** and twelve **principles**, in the shape the Agile Manifesto uses.

The values settle arguments. Read them the way that manifesto is read: there is value in the thing
on the right, and we value the thing on the left more. The principles say what the values mean when
you are actually building, and each carries an example from work already done — a principle with no
example is a slogan.

## What good looks like

Five products we use every day, and the one thing each gets right. None is a feature list — each
made a single decision and held it, which is the whole argument for having four values rather than
twenty.

| Product | What it gets right | What it gives us |
|---|---|---|
| ChatGPT | Focus. One thing. You never leave the chat page. | Never outside the conversation |
| Claude Code | Long-running, parallel, goal-based work. | Give it an outcome, not a task |
| OpenClaw | Chain of thought and tool use, visible, for creative solutions. | Show your work |
| Claude Code Mobile | Simple escalation — one decision, well framed. | Ask a person one clear question |
| ElevenLabs | A beautiful UI expressing complex work, simply. | Hide complexity, never hide truth |

---

# The four values

## Value 1 — Outcomes people own *over* work the system performed

A system that reports activity is asking to be judged on effort. Every meaningful outcome carries a
name, a measure, a baseline and a target — and a person who is accountable for it.

**Autonomous cannot mean unowned.**

## Value 2 — One obvious path *over* every possible option

Every additional choice has a cost, paid by everyone who did not need it. Prefer a useful default
to a setting, one obvious action to five, and one shape used everywhere to a pattern per screen.
Work happens where you already are: clicking from content to sidebar to modal to form to reach the
next input is the anti-pattern, not the product.

**Serious software can still be a pleasure to use.**

Simplicity is the second value rather than the last on purpose. It is not a finishing pass applied
to a built thing; it is a choice made before there is anything to simplify.

## Value 3 — Evidence you can reach *over* answers you must trust

The simplest useful reading comes first, and the thing behind it is always one move away. A number
carries what it is a number *of* and how fresh it is. A claim carries its source.

**Hidden is fine. Unreachable is not.**

## Value 4 — Autonomy that was earned *over* automation that was configured

Trust is demonstrated, not switched on. An agent climbs from suggesting, to acting within bounds,
to acting alone, and each rung is paid for with evidence a person can inspect. Every correction,
approval and rejection is training data.

**The product gets more capable because it was used, not because it was configured.**

---

# The twelve principles

### 1. Every outcome has an owner, and every agent knows why it exists

An agent exists because an outcome needs owning, never because a task can be automated. It can say
what it is responsible for, who owns the result, and how it is measured.

> **In the work** — the Outcome Contract: purpose, owner, KPI, baseline, target, permissions,
> quality threshold, escalation policy, current performance, autonomy rung.

### 2. If it matters, measure it — with a baseline, a target and a provenance

A number with no target is decoration. A number with no provenance cannot be acted on. `verified`,
`observed`, `human-confirmed` and `agent-reported` are different kinds of fact and are never
rendered as the same one. Improve the business and the person doing the work; a system that raises
throughput while making the work worse has not improved anything.

> **In the work** — team KPIs carry baseline and target; measures render their provenance;
> unavailable is never rendered as zero.

### 3. People manage outcomes; the system manages machinery

Say what you want accomplished. Do not orchestrate the parts. And optimise the system, not the
task: local automation that creates a global bottleneck has made things worse.

> **In the work** — missions carry goals; a person approves an outcome ("enroll this lead"), never
> the steps that carry it out.

### 4. Simple beats flexible

Every additional choice has a cost, paid by everyone who did not need it. Prefer a useful default
to a setting, and one obvious action to five possible ones.

> **In the work** — the workspace nav cut to five entry points; the activity log demoted off the
> daily path.

### 5. Never outside the conversation

The sharpest single test of value 2. No digging through forms, sidebars and modals to reach the
next input. Where structure is genuinely
needed it arrives as a card in the flow — and the conversation can still change it.

> **In the work** — the review card decided in place; the rail on every record page; "keep the
> brief beside me" instead of a tab you have to leave.

### 6. One shape, used everywhere

Two surfaces doing the same job is a defect, not variety. Extend the shape rather than building a
second one beside it — especially when the gap is real, because a real gap closed generically
improves the platform while the same gap closed locally degrades it.

> **In the work** — one `ListRow` across Review, Search, Artifacts and Learnings. The failures are
> just as instructive: two send-label paths, two recommendation renderers and two meta rows all
> drifted apart inside a single week.

### 7. Capability compounds — the next kind costs a descriptor, not a subsystem

Vocion's vocabulary is small and should stay small: **record, artifact, ask, conversation, run,
measure**. A new feature maps onto one rather than adding another. Implementing versioning,
editing, preview or a history list a second time is the tell that you are duplicating a noun
instead of extending one.

> **In the work** — the research brief became an artifact and inherited version history, restore,
> the preview panel, `@mention` and export for free. Worked examples in
> [`design/reduction.md`](./design/reduction.md).

### 8. Make the important things obvious, and beautiful is functional

At any moment a person should know what needs them and what to do next. Hierarchy, space and
restraint are how that gets communicated — beauty here is not decoration, it is the mechanism.

> **In the work** — hairlines not boxes; one primary action per screen; a bordered surface never
> contains another bordered surface.

### 9. Hide complexity. Never hide truth.

Thresholds, model ids, run ids, token counts and connector field names are how we debug, not how a
person decides. They live behind progressive disclosure and never inside a sentence someone has to
read to do their job. **Less evidence should produce a smaller output, not a longer explanation of
why evidence is missing.**

> **In the work** — "Web search was unavailable for this run" on the page; the environment variable
> behind the evidence drawer, where it belongs.

### 10. Show your work

Every claim is traceable to what produced it, in one move from where it is read. A stated fact
carries its source; a source is a link to the thing itself, not the name of a system; anything
dated is shown with its date when quoted out of its own context. *"I could not establish this"*
always beats a confident guess.

> **In the work** — the failure that made this a principle: an agent with no clock read a days-old
> briefing and served its schedule as today, with nothing on screen to trace it back.

### 11. Automation is earned, and every interaction teaches

Begin with evidence, not maximum autonomy, and climb one rung at a time. An approval, a correction
and a rejection are all information, and a system that cannot show it is learning is not learning.

Design for the end state, not the training state: a review queue exists to become empty, so the way
a person works with it should not change on the day the agent is trusted to run alone. *(Jamie
Schiesel, 2026-09-16.)*

> **In the work** — the autonomy ladder stated where the work happens; feedback becoming proposed
> rules; the alignment score that says how often you agreed.

### 12. Build what use demanded

Roadmaps drift toward what sounds important; building something real tells the truth. A feature
earns its place by being needed to finish actual work. If a change cannot name the thing it
unblocked, it is not ready to build.

And keep the specifics at the edge: anything true of only one industry, customer or vertical
workflow is a **concretion**, and belongs in a template, workspace or the marketplace, never in the
core. Every vertical added to the core is paid for by every workspace that will never use it.

> **In the work** — the changes shipped this month came from hitting walls at 8am trying to run
> real prospecting, not from a backlog.

---

# The test

Four questions, before shipping anything.

1. **Is this an outcome, or an activity?** And who owns it?
2. **Is this one obvious path, or another option?** A default beats a setting; one shape beats a pattern per screen.
3. **Can a person check it?** In one move, from where the claim is read.
4. **Did real work demand this, and did we earn it?** Can the change name the thing it unblocked?

**If a proposal survives all four, build it. If it cannot, it is not finished.**

---

## The loop this serves

**Outcome → Work → Measure → Learn → Improve → Automate → New capability**, and then repeat. The
system should become more useful, more capable, more trusted, more automated and more valuable with
every turn of it.

It is also an architectural pattern, not only a design philosophy:
**Outcome → Accountability → Measurement → Learning → Automation → Capability.** Every agent carries
an Outcome Contract that makes this visible in the platform itself.

| Field | Question it answers |
|---|---|
| Purpose | What outcome am I responsible for? |
| Owner | Who owns the result? |
| KPI | How do we measure it? |
| Baseline | Where did we start? |
| Target | What does good look like? |
| Permissions | What decisions can I make? |
| Quality threshold | What standard must the work meet? |
| Escalation policy | When should I hand off to a person? |
| Current performance | How am I doing now? |
| Autonomy level | Which rung of the earned-automation ladder am I on? |

Where these already exist in the platform they are the same fields under this name — an agent's
`description` and its team's `goal` are the purpose; `accountableUser` is the owner; team `kpis`
carry KPI, baseline, target and current performance; `approvalPolicy` / `trust.yaml` are the
permissions; a mission's `autonomyPolicy.level` is the autonomy rung. Where they do not yet exist,
they are the next things to build.

---

*Changes to this document are product decisions: propose them as a pull request and say which
value or principle you are changing, and why.*

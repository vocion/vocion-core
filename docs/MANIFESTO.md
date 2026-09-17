# Vocion Product Design Manifesto

> **Powerful systems should feel simple.**

Vocion is built for serious work. Underneath, it may involve agents, models, policies,
permissions, context, evals, traces, budgets, workflows, and distributed systems. The person
using it should not have to think about any of that.

**Complexity belongs in the platform, not in the experience.**

And the purpose of the platform is not automation for its own sake. Vocion exists to improve
outcomes for people and businesses.

This document is the bar for every product decision in this repository — features, pages,
defaults, entity fields, agent behaviour, and the workspaces built on top of it. When a
proposal, brief, or pull request cannot pass [the test](#the-test) at the end, it is not finished.

---

## 1. Outcomes over activity

The system should optimize for what matters, not how much work it appears to do.

Every agent, workflow, and feature should ultimately connect to an outcome:

- Revenue generated
- Cost reduced
- Time saved
- Risk reduced
- Quality improved
- Customer experience improved
- Employee effectiveness improved
- Better decisions made

Tasks, messages, tool calls, tokens, and completed workflows are operational metrics. They are
not the goal. **Work should always roll up to an outcome.**

## 2. If it matters, measure it

Every important workflow should have a measurable definition of success. The system should know:

- What are we trying to improve?
- What does good look like?
- How are we performing now?
- Are we getting better?

Measurement should be designed in from the beginning, not added afterward. Vocion should make
the impact of AI visible.

Not: *The agent completed 8,214 tasks.*

But: *Response time fell 62%. Human review fell 38%. Conversion increased 11%. Errors decreased 27%.*

## 3. Accountability must have an owner

Autonomous systems cannot mean unowned systems. Every meaningful outcome should have clear
accountability. Every agent should have:

- A purpose
- An owner
- A defined scope
- Success metrics
- Quality standards
- Escalation rules
- Permission boundaries

At any point, it should be obvious: What is this agent responsible for? How is it performing?
Who owns the result?

**AI should make accountability clearer, not blur it.**

## 4. Simple beats flexible

Every additional choice has a cost.

- Prefer a clear path over a configurable one.
- Prefer a useful default over another setting.
- Prefer one obvious action over five possible actions.
- Expose complexity only when the user needs it.

If Vocion can make a decision safely and correctly for the user, it should.

**The reduction pass** — how this is actually done, with worked examples of the
five ways a surface gets bloated and the rule that *less evidence should produce
a smaller output, not a longer explanation of why evidence is missing* — is in
[`docs/design/reduction.md`](./design/reduction.md).

## 5. Serious software should still be fun

Work does not need to feel like enterprise software. Vocion should feel responsive, alive, and
satisfying to use. Progress should be visible. Actions should have clear outcomes. Agents should
feel like capable teammates accomplishing things with you.

Borrow from great games:

- Clear goals
- Immediate feedback
- Visible progress
- Growing capability
- Increasing mastery
- A sense of momentum

Never add gamification for its own sake. **The reward is getting better at the work.**

## 6. Every interaction should make the system smarter

An approval is information. A correction is information. A rejection is information. An
escalation is information. An exception is information. A manual override is information.

Human interaction should improve the system:

- Useful patterns should become reusable knowledge.
- Repeated corrections should become rules.
- Repeated exceptions should become known cases.
- Repeated work should become automation.

**A person should rarely have to teach Vocion the same thing twice.**

## 7. Capability should compound

Vocion should become more valuable the longer it is used. Agents understand more. Context gets
richer. Evals get stronger. Workflows improve. Exceptions become known. Automation expands.

Human effort should steadily move from **Doing → Reviewing → Supervising → Managing outcomes**.

The system should continuously ask: *What can we safely handle next?*

## 8. Automation is earned

Do not begin with maximum autonomy. Begin with evidence. Progress through:

**Observe → Recommend → Assist → Execute with approval → Execute within bounds → Operate autonomously**

Every increase in autonomy should be justified by demonstrated performance. Trust should grow
with competence. Automation should never be granted because the technology can do something. It
should be granted because the system has proven it can do it well.

## 9. Improvement must be visible

A learning system should be able to prove that it is learning. Vocion should show:

- What improved?
- Why did it improve?
- What changed?
- What did we learn?
- What became automated?
- What still requires human judgment?

Improvement should be measurable over time. The user should be able to see the system becoming
more capable.

## 10. Humans should manage outcomes, not machinery

People should tell Vocion what they want accomplished. They should not have to orchestrate
prompts, models, context windows, chains, tool calls, infrastructure, or retry logic.

The ideal interaction is: *Here is the outcome I want.* Vocion determines how to get there.
Humans provide judgment where judgment matters. **The machinery disappears.**

## 11. Make the important things obvious

At any moment a user should understand:

- What is happening?
- What needs me?
- What changed?
- Did it work?
- Are we on track?
- What happens next?

Do not make people interpret system internals to understand business reality. The interface
should surface **decisions, outcomes, exceptions, and next actions**.

## 12. Hide complexity. Never hide truth.

Simple does not mean opaque. Vocion should present the simplest useful explanation first, with
deeper evidence underneath.

| Who | What they need |
|---|---|
| An executive | Claims automation is improving margin. |
| An operator | 92% straight-through processing, 41 exceptions this week. |
| A manager | Quality increased 4.7% while human review decreased 22%. |
| An engineer | The full execution trace. |

Same system. Different depth.

## 13. Measure the business and the person

Vocion should improve organizations. It should also improve the experience of the people inside
them.

Business outcomes matter: revenue, margin, throughput, quality, risk, speed, customer
satisfaction.

Human outcomes matter too: less repetitive work, fewer interruptions, faster decisions, reduced
cognitive load, more time spent on judgment and creativity, greater ability to accomplish
meaningful work.

A successful automation should not simply make a process cheaper. **It should make the
organization and the people inside it more capable.**

## 14. Every agent should know why it exists

An agent should never exist simply because a task can be automated. Every agent should be able
to answer: *What outcome am I responsible for?* Then:

- How do we measure it?
- What decisions can I make?
- What are my boundaries?
- When should I escalate?
- Am I improving?

Agents should behave like accountable members of an organization, not scripts with
personalities.

## 15. Optimize the system, not the task

Local automation can create global problems. An agent should understand the larger workflow it
participates in.

- Faster is not better if quality declines.
- More leads are not better if conversion falls.
- Lower cost is not better if customer experience suffers.
- More automation is not better if risk increases.

**Vocion should optimize for the total outcome.**

## 16. Beautiful is functional

Beauty creates clarity. Every screen should have hierarchy. Every object should have space.
Every interaction should feel intentional.

- Avoid dashboards filled because data exists.
- Avoid settings because the underlying platform supports them.
- Avoid complexity disguised as sophistication.

Show what matters now. **A powerful platform should feel calm.**

## 17. Enterprise underneath. Approachable everywhere else.

Vocion should be production infrastructure without feeling like infrastructure.

Security. Identity. Permissions. Auditability. Observability. Versioning. Evals. Rollback.
Budgets. Reliability. Governance.

These are foundational requirements. They should exist by default. The user should benefit from
them without needing to understand their implementation. **Production-grade should be the
foundation, not the user experience.**

---

## 18. Implementation is the forcing function

Roadmaps drift toward what sounds important. Building something real tells the truth.

A feature earns its place by being needed to finish actual work — a deployment, a client
outcome, a dogfood use case — not by being proposed. Use the product, find where it fails, and
close that gap. The backlog should read as a record of what implementation demanded, not a wish
list written in advance.

- Prefer the gap you hit today over the gap you predict for next quarter.
- A capability nobody hit a wall without is speculation.
- Feedback from real use becomes work, not just a reply (§6).
- If a feature cannot name the thing it unblocked, it is not ready to build.

This is why Vocion runs inside its own company before anyone else's. **If we did not need it to
finish something, we do not need it yet.**

## 19. Extend the core. Keep the specifics at the edge.

Two questions before any new surface: **How can we simplify this? How can we make this
universal?**

Every screen, component and interaction pattern should be one of a small number of shapes, used
everywhere. When a need does not fit one, the answer is almost always to extend the shape rather
than build a second one beside it — and that holds *especially* when the gap is legitimate. A
real gap closed generically makes the whole platform better. The same gap closed locally makes
one screen better and the platform worse.

- Extend a core component before adding a custom one.
- Extend an interaction pattern before inventing a second way to do the same job.
- Two surfaces doing the same job is a defect, not a choice (§4).
- A one-off is a core gap someone decided not to fix.

But universal does not mean everything belongs in the core. Anything true only for one industry,
one customer, or one vertical workflow is a **concretion**, and concretions do not belong in the
platform. They belong in templates, workspaces and the marketplace, where they can be specific,
opinionated and disposable without taxing everyone else.

- The core holds the general capability. A template holds the specific application of it.
- If it names an industry, a customer, or a single workflow, it is not core.
- Every vertical added to the core is paid for by every workspace that will never use it.

**Generalize into the core. Specialize at the edge.**

In practice this starts with the vocabulary: Vocion has a small set of nouns —
record, artifact, ask, conversation, run, measure — and a new feature maps onto
one of them rather than adding another. The worked example, and the tell that you
are duplicating a noun rather than extending it, are in
[`docs/design/reduction.md`](./design/reduction.md).

## The Vocion loop

Every part of Vocion should reinforce the same cycle:

**Outcome → Work → Measure → Learn → Improve → Automate → New capability**

And then repeat. The system should become more useful, more capable, more trusted, more
automated, and more valuable with every cycle.

## The core model

The manifesto is also an architectural pattern, not only a design philosophy:

**Outcome → Accountability → Measurement → Learning → Automation → Capability**

Every agent carries an **Outcome Contract** that makes the manifesto visible in the platform
itself:

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
permissions; a mission's `autonomyPolicy.level` is the autonomy rung. Where they do not yet
exist, they are the next things to build.

## The test

Before shipping anything, ask:

1. What outcome does this improve?
2. Can we measure whether it worked?
3. Who is accountable for the result?
4. Can this be simpler?
5. Did real work demand this, or did we imagine it?
6. Can this extend something we already have, instead of adding a second way to do the same job?
7. Is this general enough for every workspace, or is it a concretion that belongs in a template?
8. Does the user know what to do next?
9. Did this interaction teach the system something?
10. Will repeated use reduce unnecessary human effort?
11. Can the system safely become more capable because of it?
12. Does this improve the business or the person doing the work?
13. Is complexity hidden without hiding the truth?
14. Does this feel good to use?
15. Would we be proud to use this every day?

**If we cannot answer those questions, it is not finished.**

---

*Author: Chris Fitkin, September 2026. Changes to this document are product decisions; propose
them as a pull request and say which principle you are changing and why.*

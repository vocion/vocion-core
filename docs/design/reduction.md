# Making it dramatically simpler

Two practices, both concrete, both with worked examples. The Manifesto states the
principles — §4 *simple beats flexible*, §7 *capability should compound*, §12
*hide complexity, never hide truth*, §19 *extend the core, keep the specifics at
the edge*. This document is how we actually do it, and what it looks like when we
have not.

---

## Part 1 — The reduction pass

> **Less evidence should produce a smaller output, not a longer explanation of
> why evidence is missing.**

That is the rule. Everything below follows from it.

A surface that knows four facts should be four facts long. When an agent knows
little, the temptation — for a model and for the person prompting it — is to
narrate the absence: to explain, carefully and at length, everything that could
not be established. That reads as verbose rather than rigorous. It buries the one
intelligent thing the system did under several thousand characters of hedging.

### The five failures, and what to do instead

**1. Repeating an absence.** A research brief once said "we could not establish
what this company does" in seven different sections, in slightly different words.
Say it **once**, in the section that owns it, and let every other section be
shorter because of it. If two sections would both describe the same gap, they are
one section.

**2. Narrating instead of grading.** "Performance is not measured yet — state the
workspace outcome and give each team a measure and a target, and this section
fills in" is a paragraph where a state belongs. If a section has nothing to say,
**remove the section**. Do not make a person read an empty state every morning to
learn nothing. The renderer should have no empty-state branch to reach.

**3. The raw number as the headline.** "What needs me — 661" makes a person feel
they have acquired 657 direct reports. The honest and shorter version is
"3 decisions need you today · 658 lower-priority items queued", then the three.
A count is not a headline; a count of things that need *judgment* is.

**4. Reporting state where change is the point.** "$3.52M open pipeline" is useful
once. Tomorrow the question is whether it moved. Prefer a delta over an absolute
on anything recurring, and compute the delta rather than asking a model to
describe one.

**5. Showing the workings.** Thresholds, model ids, run ids, token counts,
connector field names and agent slugs are how we debug, not how a person decides.
They go behind progressive disclosure — an Evidence or Run-details drawer — and
they never appear in a sentence a person is expected to read to do their job.
"Weighted forecast unavailable · Why?" is the surface; the schema field name is
behind the *Why*.

### The worked example

A lead where the system genuinely knew four facts produced: Prospect, Research
That Matters, Recommended Angle, Opening Question, Case Study, Missing, Claims,
Confidence, Timeline, CRM Context, a second Missing, and Reference Articles.

The reduction:

> **What we know** — one or two sentences of confirmed fact.
> **What we couldn't verify** — one or two sentences, once.
> **Recommended angle** — one sentence.
> **Sources** — three chips.
> **Research confidence: Low**

Everything else moved to Evidence. The recommendation underneath was good — *we
know almost nothing about this company, so do not fabricate personalization, ask
an honest question* — and the old page hid it. A system confident enough to say
"we verified four facts and could not establish the rest" reads as more mature,
not less.

### The test

Before shipping a surface, ask: **what would this look like if it knew half as
much?** If the answer is "the same size, with more explanation", it is wrong. And:
**can a person get what they need in under thirty seconds?** If the ingredients
are all present but stacked rather than sequenced, that is the same failure.

---

## Part 2 — Map onto the nouns we have

> **When something needs to be referenced, edited, versioned, previewed or cited,
> it is an artifact. Do not invent a second noun for it.**

Vocion has a small vocabulary, and it should stay small:

| Noun | What it is |
|---|---|
| **Record** | a thing in the world — a contact, a deal, a meeting, a document |
| **Artifact** | content the system produced — versioned, authored, editable, citable |
| **Ask / proposal** | a decision waiting on a person |
| **Conversation** | the talking |
| **Run** | a unit of agent work, with its cost and trace |
| **Measure** | a number with a target and a provenance |

A new feature earns a new noun only when it genuinely is not one of these. Almost
nothing is.

### The worked example

*Should the personalization research brief use the artifacts system?*

Yes — and the reasoning generalises. A research brief is markdown produced by an
agent, edited by a human, that needs versions, authorship, a change summary, a
stable id and citation. That is the artifact contract exactly. Giving briefs their
own table and their own editor would be the §19 mistake: a real gap closed
locally, leaving the platform worse. Using artifacts closes it generically, and
the brief inherits, for free, everything artifacts already have — version history,
restore, the preview panel, `@mention` in the composer, the artifacts log, export.

That is §7 *capability should compound* made mechanical: the next content type
costs a descriptor, not a subsystem.

It also makes a chain literal that was previously only narrative:

**Evidence → Brief → Recommendation → Draft → Human decision → Action**

Each link an artifact with a version and an author, and the decision pinning the
exact versions it approved. The audit then answers *what did the person actually
approve*, not *what does this look like now* — which is §3 *accountability must
have an owner* and §12 *hide complexity, never hide truth* enforced by the
schema rather than by a paragraph.

### The second worked example, and where the analogy stops

*Should Briefings just be a special artifact type, or an object-oriented
extension of one?*

Mostly the first — but the interesting part is the one place the analogy breaks,
because getting that wrong would quietly destroy the feature.

A briefing's **content** is an artifact: agent-produced, typed, previewable,
citable, exportable, and worth versioning when a person edits it. So a briefing
edition is an artifact of a typed kind, and it inherits the panel, the log and
the mention for free.

But a briefing is not *only* content. It is content **published on a cadence to
an audience**, and those two extra facts decompose onto nouns we already have
rather than justifying a new one:

| Part of a briefing | The noun it already is |
|---|---|
| the document | **artifact** (typed) |
| the work that produced it | **run** |
| the recurrence | **automation** |
| the delivery | **surface** (the app, email, Slack) |
| the numbers inside it | **measures**, with their provenance |

**Where the analogy stops: an edition is not a version.** Tuesday's briefing is
not version 2 of Monday's. They are siblings in a series, not revisions of one
document. A version is *the same statement, corrected*; an edition is *a new
statement about a new window*. Collapse them and three things break at once:
restoring "version 3" would mean restoring last Tuesday; the delta join has
nothing to join against, because yesterday is no longer a separate object; and
the archive turns into one document's history instead of a record of what was
said and when.

So the model is: **a series of editions, each an artifact, each versioned
independently.** Editing Tuesday's briefing makes Tuesday v2 and leaves Monday
alone. The delta is computed between *editions*, which is exactly where "since
the last brief" lives.

This is the general shape of the question. When something looks like an existing
noun, decompose it into the nouns it is made of, and then look hard for the one
axis that does not fit. There usually is one, it is usually the interesting part
of the design, and it is almost never a reason to start a new subsystem.

### Extending a noun is allowed; duplicating one is not

Mapping onto an existing noun will usually reveal something the noun cannot do
yet. Artifacts were conversation-scoped, and a brief belongs to a record — so
artifacts learn to attach to a record. That is the right kind of work: one
extension, every future artifact benefits. Writing a parallel `brief` table
because artifacts did not quite fit would have been the wrong kind.

The tell that you are duplicating rather than extending: you find yourself
implementing versioning, or editing, or a preview, or a history list, a second
time.

### A note on vocabulary

§19 uses **concretion** for something true only of one industry, customer or
vertical workflow — the thing that belongs in a template rather than the core.
This document is not that. These are practices, and the artifact example is an
extension of the core rather than a specific application of it. Keep the word for
what §19 means by it.

---

*Referenced from `docs/MANIFESTO.md` §4, §7, §12 and §19, and from `CLAUDE.md`.
Changes here are product decisions: propose them as a pull request and say which
principle you are applying.*

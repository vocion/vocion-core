# Earned autonomy

> "If I make these decisions, is the system learning and aligning as well as
> getting unblocked? Do we have an alignment or confidence score around
> recommendations? And the ability to unlock automation by risk and type?"
> — product owner, 2026-09-15

Yes, yes, and yes. This guide is how.

The [manifesto](../DESIGN-PRINCIPLES.md) says automation is earned (#8), every
interaction should make the system smarter (#6), and improvement must be
visible (#9). Earned autonomy is those three principles as one mechanism: every
human decision becomes evidence, the evidence is shown next to every
recommendation, and a workspace steps an action kind up the ladder when — and
only when — the evidence says it is safe to.

## The ladder

**Observe → Recommend → Assist → Execute with approval → Execute within bounds → Operate autonomously**

The rung is a property of an *action kind* in an org — `hubspot.update`,
`personalization.enroll` — not of an agent or a mission. Every kind starts at
**Execute with approval**: the agent proposes, a person decides, the review
queue is where that happens. At **Execute within bounds** a proposal whose
confidence clears the kind's floor runs without waiting — audited, listed under
*Executed automatically*, reversible. Below the default, a person has parked
the kind on purpose; climbing back up to the default needs no evidence.

What a rung means operationally is one thing only: whether the `trust_rule`
`ActionService` reads is enabled (see [trust rules](../entities/trust.md)).
The other four rungs are stated intent — where you want a kind to be — and
they show on the page and the team report, but the gate has two states.

## What counts as evidence

Every decision a person takes on something an agent recommended is written to
the **alignment ledger** (`decision_alignment`), comparing the recommendation
with the decision:

| Where the decision was made | Subject | What was recommended | Agreed when |
|---|---|---|---|
| Review queue — approve, edit-then-approve, reject on an `action_run` | `action` / the action id | `proposal.suggestedDecision`; when the agent stated none, an *implicit* `approve` (an agent only proposes work it wants run) | the outcome matches: approve or edit ↔ `approve`, reject ↔ `reject` |
| Needs-you page — an answer to an ask | `ask` / the ask kind | the option marked `recommended` | the chosen option is that one |

Every row carries who decided, whether a note came with it (a correction the
classifier can read), the recommendation's confidence, and whether the run had
*already auto-executed* under a trust rule when the person saw it.

Skip, save, snooze, rewrite and regenerate decide nothing, and are not
evidence. An ask with no recommended option is counted as decided but has
nothing to agree with.

The adoption dashboard's *agreement* metric deliberately ignores implicit
recommendations, because it measures the quality of what the agent *said*.
The ledger deliberately keeps them, labelled, because the autonomy question is
different: *had this run without you, would you have let it?* An approval
answers that whether or not the agent spelled out "approve".

## The score

`AlignmentService.scoreFor({ agentSlug, subjectKey, window })` returns
`{ agreementRate, n, window }` — the share of decided recommendations of that
kind, from that agent, that the person agreed with. It is shown wherever a
recommendation is shown, inline, without new chrome:

- **Review card** — under the confidence meter: *87% · agrees with you 92% · n=48*.
- **Ask sheet** — under the question: *Recommended with 72% confidence · agrees with you 92% · n=48*.
  An ask states its confidence with `options[].confidence` (0–1) on the
  recommended option (`POST /api/v1/asks`).
- **Team report** — the Autonomy column on each member row: the rung of each
  action kind the agent has had decided in 30 days, and the agreement behind
  it. The team's contract shows the union.

Nothing shows until there is at least one decided recommendation; a kind with
no history says so rather than showing 0%.

## When the next rung is earned

`AutonomyService.eligibility(org, actionId)` reads the ledger and judges it
against the kind's **risk tier**. The defaults:

| Tier | Decisions (30d) | Agreement | Rejections | Confidence floor | Evidence can reach |
|---|---|---|---|---|---|
| **low** | n ≥ 20 | ≥ 90% | none in 14 days | 0.85 | Operate autonomously |
| **medium** | n ≥ 40 | ≥ 95% | no *high-confidence* rejection (at or above the floor) in 30 days | 0.95 | Execute within bounds |
| **high** | — | — | — | 0.99 | never above Execute with approval without an explicit `trust.yaml` rule |

Tier defaults come from the registry (`services/autonomy/rungs.ts`,
`DEFAULT_RISK_TIER`): `hubspot.update` low; `gmail.send`,
`personalization.enroll`, `objects.propose_candidate`, `qc.release` medium;
anything external and unlisted high. A workspace overrides any of them in
`trust.yaml` (`risk:` on a rule, or the top-level `risk:` map).

Some kinds are held at Execute with approval by the platform whatever the
evidence — the never-auto list in `libs/actions/neverAuto.ts`. The ladder page
says *held here by the platform* instead of counting toward a promotion that
would never fire.

## Promotion

`/dashboard/autonomy` lists every action kind with its rung, tier, confidence
floor, 30-day alignment, and one plain sentence about the next rung — *Earned:
promote to Execute within bounds* or *Needs 12 more decided recommendations
(8 of 20)*. The **Promote** button is rendered only when the sentence starts
with *Earned* — and `AutonomyService.promote` refuses otherwise, so an API
caller cannot promote past the evidence either. **Demote** is always there.
Both are admin-only; the page itself is readable by every member.

A promotion writes the `autonomy_policy` row (rung, tier, floor, who, and the
alignment numbers it was earned on), the matching `trust_rule`, and an
`autonomy.promoted` adoption event. A demotion does the same in reverse and
disables the rule, keeping the threshold so re-promoting needs no retyping.

## Demotion, automatic

Two rejections demote a kind on their own, one rung, and flag it for a look:

- a person rejects a run that had **already auto-executed** — the trust rule
  was wrong about it;
- a person rejects a proposal of a **high-risk** kind that sits above the
  default.

The floor for an automatic demotion is Execute with approval. The system takes
automation away; it never takes away the ability to propose — pushing a kind
further down is a person's call. The flag shows on the page with the reason
and clears with *Seen*, or with the next promote/demote.

## Learning on agreement

Corrections already flow to the feedback classifier: a rejection or an "other"
with a note becomes a learning candidate. Agreement now flows too. Every ten
agreed decisions per (agent, kind), the ledger queues one *reinforce* candidate
— *"hubspot.update proposals from crm-agent are consistently accepted: 40 of
42 decisions agreed (95%). Keep doing what works here, and consider raising
this kind's autonomy."* — through the same pipeline as a thumbs-up, keyed on
the day so a kind proposes at most one a day. A person still adopts or rejects
it on `/dashboard/learnings`; nothing is written into an agent's rules on its
own.

## The manifesto test

- **What outcome does this improve?** Less human review on the kinds that
  have proven safe, with the risk of a wrong auto-execution bounded by tier and
  reversed on the first rejection. Time saved, risk reduced.
- **Can we measure whether it worked?** Yes — the ledger is the measurement,
  and the page shows it per kind.
- **Who is accountable?** The admin who promoted, named on the row with the
  evidence; the person whose rejection demoted, in the adoption stream.
- **Can it be simpler?** Two verbs, one appears only when earned. Defaults by
  tier instead of a settings page.
- **Does the user know what to do next?** Every row says what the next rung
  takes, in one sentence.
- **Did this interaction teach the system something?** Every decision is a
  ledger row; every tenth agreement is a learning candidate.
- **Is complexity hidden without hiding truth?** The score is one line; the
  evidence, the tier rule and the policy row are underneath it.

## Where it lives

- **Tables:** `decision_alignment`, `autonomy_policy` — migration `0099`.
- **Services:** `services/alignment/AlignmentService.ts` (record, score,
  evidence, reinforce), `services/autonomy/rungs.ts` (the ladder, tiers,
  eligibility — pure), `services/autonomy/AutonomyService.ts` (policy,
  promote, demote, automatic demotion, trust.yaml sync).
- **Hooks:** `ReviewService.decide` (actions), `AskService.decideAsk` (asks),
  `libs/workspace/applier.ts` (trust.yaml on apply).
- **UI:** `/dashboard/autonomy`; the confidence box on the review card; the
  line under an ask's question; the Autonomy column on `/dashboard/team-report`.
- **API:** `router.autonomy.list | promote | demote | acknowledgeFlag`;
  `options[].confidence` on `POST /api/v1/asks`.
- **Events:** `autonomy.promoted`, `autonomy.demoted` (with `automatic`).

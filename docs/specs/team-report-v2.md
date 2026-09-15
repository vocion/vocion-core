# Team report — product review (Chris Fitkin, 2026-09-15)

> Verbatim review of the shipped `/dashboard/team-report` (PR #326 / release 2026-09-15). This is the spec for v2.

I would not ship this yet as the canonical **Team report**. The underlying idea is right, but the page is currently a **configuration/status inspector wearing the clothes of a performance report**.

A revenue leader should be able to open this page and answer, in about 10 seconds:

**What are my AI teams supposed to accomplish? Are they accomplishing it? What is it costing me? How much human help do they need? Where is something going wrong?**

Right now the page mostly answers: **how are the YAML files configured?**

## The biggest problems

| Area | Current state | Problem |
|---|---|---|
| Outcome | Purpose + optional KPI | Too weak to establish accountability |
| Performance | "Not measured" | No operational scorecard |
| Economics | Spend + tokens | Cost without value is accounting, not ROI |
| Autonomy | Human-gated + permissions + autonomy | Three concepts blur together |
| Human involvement | Link to inbox | No measurement of human burden |
| Quality | Missing | A team could produce lots of bad work and look productive |
| Workforce | Agents mostly hidden | It barely feels like a workforce |
| Evidence | Runs/tokens | Technical evidence, not business evidence |
| Setup | YAML instructions everywhere | Product leaks implementation details |
| Empty state | Full report with zeroes | Makes the product feel dead instead of unfinished |

The biggest structural issue is that **"outcome contract" is a stronger idea than the implementation shown here**.

An actual outcome contract should answer:

> **This team exists to cause X, measured by Y, at a target of Z, within these quality/cost/risk constraints, with this level of autonomy, accountable to this human.**

Your current contract is closer to:

> This team does some stuff. KPI: pitches.

That distinction matters a lot.

---

## 1. Your metrics are mostly activity metrics, not outcomes

This is probably my biggest product objection.

You call these **outcome contracts**, but:

**Deal Desk:** KPI = pitches · **Founder GTM:** KPI = referrals · **Marketing:** KPI = MQLs · **RevOps:** KPI = discovery calls

These are at different levels of the funnel and several are simply counts of work produced.

For Deal Desk, for example:

**Weak** — 12 pitches

**Better** — 12 proposals delivered · 92% accepted internally without material rewrite · 4 advanced to commercial discussion · median turnaround 14 minutes · $6.40 AI cost / proposal

The outcome framework should probably support four measurement dimensions:

| Dimension | Example |
|---|---|
| **Outcome** | Qualified opportunities created |
| **Quality** | 94% accepted without major revision |
| **Velocity** | Median turnaround 11 minutes |
| **Economics** | $4.81 per completed work item |

Then layer **autonomy/risk** over that rather than treating autonomy itself as performance.

That gives you something much more defensible:

> Is this AI team producing useful business work, correctly, quickly, economically, and safely?

That is a real workforce operating model.

---

## 2. Do not let agents grade themselves

This line worries me:

> add `kpis:` (key, target, and a `counts.<key>` the workers report)

If I understand the architecture correctly, you're relying at least partly on the worker to emit the count that establishes its own performance.

That is dangerous as the foundation of an accountability framework.

A worker saying `pitches: 7` is evidence that the worker **claims it produced seven pitches**. It is not necessarily evidence that: seven artifacts exist · seven were actually delivered · seven were useful · the CRM reflects seven opportunities · any human accepted them.

Vocion should have a **measurement provenance** concept:

- **Verified** — CRM says meeting booked.
- **Observed** — Vocion saw an email sent.
- **Human-confirmed** — User approved the artifact.
- **Agent-reported** — Worker emitted a count.

You could even show a tiny confidence/source indicator next to performance. That would materially strengthen your claims around traceability and accountability.

The product philosophy should be:

> **Agents do the work. Systems of record measure the outcome whenever possible.**

---

## 3. "Spend weighed against outcome" needs much more rigor

You cannot meaningfully compare 8 pitches · 3 referrals · 14 MQLs · 5 discovery calls as raw "outcome share." They are different units. So `0% of spend · outcome not measured` becomes problematic once real data exists. If Founder GTM produces 3 referrals and Marketing generates 40 MQLs, Marketing hasn't necessarily generated 93% of the outcome.

Use two different concepts.

**Within each team** — *Cost per outcome*: $142 spend · 8 qualified referrals · **$17.75/referral**. And *Target attainment*: 8 / 10 referrals · **80% of weekly target**.

**Across the workspace** — only aggregate normalized performance if there is an explicit weighting model (e.g. "Workspace goal contribution: 23%"). That requires teams to map into a workspace goal. Otherwise don't pretend heterogeneous outcome units can be mathematically combined.

---

## 4. The workspace goal should be central

Currently: "No workspace goal stated yet — add `goal:` to `workspace.yaml`."

This should be one of the most important ideas on the entire page. The hierarchy:

**Workspace objective → Team outcomes → Agent responsibilities → Runs / decisions / actions → Evidence**

Imagine the Revenue Team goal were **Create $1.5M of qualified pipeline this quarter.** Then Founder GTM: $400k qualified pipeline from founder network · Marketing: $300k marketing-sourced qualified pipeline · RevOps: improve qualified-opportunity conversion 18% → 24% · Deal Desk: reduce qualified-opportunity-to-proposal cycle time 4 days → 1 day.

Now this becomes a management system instead of an agent dashboard.

---

## 5. Performance needs to become the visual center of gravity

Once configured, each team section should lead with something like **7 / 10 referrals** · 70% of weekly target · ↑2 vs prior week — or **84%** proposal acceptance · target ≥90% — or **12 min** median turnaround · target <30 min. Performance should be the largest thing in each team section.

Present hierarchy: Team name → purpose → owner → configuration status → autonomy → permissions → escalation → evidence.

Change to: **Team → outcome → performance → quality/economics/human burden → control → evidence.**

---

## 6. You are missing the most important AI-workforce metric: human burden

You show "Every outward action waits for a person" but not **how often, for how long**. The promise of an agent workforce comes down to useful work divided by human intervention. Measure:

- **Human interventions** — 18 approvals
- **Human review time** — 46 min
- **Intervention rate** — 14% of work items required human input
- **Escalation rate** — 3.2%
- **Blocked time** — 2h 14m waiting for people

Then you can say: "This team completed 86% of its workload without human intervention." Make **human load** a first-class measurement in Vocion.

---

## 7. Permissions and autonomy are muddled

Separate explicitly:

- **Autonomy** — what may the agent decide? Recommend only · Act with approval · Act within policy · Fully automatic
- **Permissions** — what systems/actions can it technically access? Gmail: draft · HubSpot: read/write · Slack: send · DocuSign: no access
- **Escalations** — what currently needs human attention? **2 pending** · oldest 31m

On this page, collapse the first two into a **Control** summary ("**Human approval required** · 5 action types · 0 auto-execute") and drill into detailed policy elsewhere.

---

## 8. "Anything needing a person is in the inbox" is not report data

Orange means *something needs attention*. Use orange only when there is actual human work: "**3 items need review**". If nothing: "No pending escalations" in neutral gray or green. The inbox link sits beside that.

---

## 9. There isn't enough "workforce" on the workforce page

Expose the roster immediately: **Founder GTM · 4 agents** — Founder GTM Lead · Event Debrief · Outreach · Referral Mapper. Distinguish **Human owner** (Chris Fitkin), **AI team lead** (Founder GTM Lead), **Roster** (4 agents).

---

## 10. The zero-data state is actively hurting the product

Every section reads 0% · Not measured · Nothing decided · 0 runs · $0.00 · 0 tokens, repeated four times. Have a separate **setup state**:

**Revenue workforce setup — 3 things needed before performance can be measured**

| | Status |
|---|---|
| Workspace outcome | Missing |
| Team measures | 0 of 4 configured |
| Unassigned agents | 2 |
| Autonomy policy | Human approval default |

→ **Configure workforce**. Teams underneath in a lighter roster view. Graduate into the actual report once meaningful runs exist.

---

## 11. Stop exposing YAML in the primary business UI

"add `kpis:` … to `teams/revops.yaml`" belongs in developer mode. Default: "**Performance isn't configured yet.** Add a measure and target." → **Add measure**. Advanced users see "Edit `teams/revops.yaml`" under a secondary menu. Vocion can be Git-backed without looking Git-backed everywhere.

---

## 12. Tokens are too low-level for this page

Workforce management cares about **AI spend · Tool spend · Cost per completed outcome** (later: total operating cost). Tokens live inside Evidence or Activity. Emphasizing tokens in the executive report undermines model-agnostic positioning.

---

## 13. "Evidence" should be much richer

Keep the word. But `0 runs · $0.00 · 0 tokens` is telemetry, not evidence of effectiveness. Evidence should connect **Goal → outcome → work item → agent decision → action → artifact → evaluation → human approval → external system result**. For Deal Desk: **Proposal: Acme expansion** · Generated Sep 14 · 3 source calls cited · Human approved with 1 edit · Sent to prospect · Opportunity advanced to Proposal stage · $4.18 AI cost. You can prove what happened.

---

## What I would make the page look like

# Team performance

**Revenue Team** — *Create $1.5M qualified pipeline this quarter.*

| Outcome | Value |
|---|---:|
| Teams on target | **2 / 4** |
| Goal progress | **$417k / $1.5M** |
| AI operating cost | **$384** |
| Human review time | **2h 18m** |
| Auto-completed work | **78%** |
| Needs attention | **3** |

### Founder GTM
**Turn Chris's network and event activity into qualified introductions.**

**8 / 10 qualified referrals** — 80% of weekly target · ↑3 vs prior week

| Quality | Velocity | Economics | Human load |
|---|---|---|---|
| 92% accepted | 18m median | $6.14/referral | 17m review |

**4 agents** · Founder GTM Lead, Event Debrief, Outreach Drafter, Referral Mapper
**Control:** Approval required before external outreach · **Needs you:** 2 pending · oldest 24m
**Evidence ▾** 31 work items · 27 completed · $49.12

---

## Vocabulary

| Current | Use |
|---|---|
| Current performance | **Outcome** or **Performance** |
| Spend | **Operating cost** or **AI cost** |
| Evidence | **Evidence** ✓ |
| Permissions | **Control** on this page |
| Escalation | **Needs you** |
| Owner | **Accountable owner** |
| Outcome share | Remove unless rigorously normalized |
| Not on a team | **Unassigned agents** |
| Purpose | **Mission** |
| KPI | **Measure** / **Primary outcome** |

"Outcome contract" stays as the internal concept and on detail pages.

---

## The metric architecture to bake into Vocion

Every team declares:

```text
Mission · Accountable owner
Primary outcome · Target · Measurement source
Quality threshold · Cycle-time target · Budget / cost target
Autonomy policy · Permissions / action boundary
Escalation policy · Human-response SLA
Roster · AI team lead
```

Vocion derives:

```text
Goal attainment · Trend · Outcome cost · Quality rate
Human intervention rate · Autonomous completion rate
Escalation rate · Blocked time · Budget variance
```

---

## Outcome lineage (uniquely Vocion)

Click **8 qualified referrals** → 11 outreach conversations → 17 approved messages → 22 recommendations → 31 agent runs → $49.12 total model/tool cost → 17 minutes human review. Click one referral and trace **context → reasoning/decision → action → human approval → resulting business event**. That connects traceability, evals, cost, accountability, autonomy, and outcomes.

---

## Priority order

| Priority | Change | Why |
|---|---|---|
| **P0** | Define a rigorous outcome/measurement model | Everything else rests on it |
| **P0** | Separate setup state from operating report | Current empty state looks broken |
| **P0** | Add quality + human burden | Runs/spend alone cannot evaluate an AI workforce |
| **P0** | Stop relying on worker-reported counters as authoritative outcomes | Accountability |
| **P1** | Redesign team sections around target/actual/trend/cost | Makes this useful to managers |
| **P1** | Surface team roster + AI lead | Makes workforce tangible |
| **P1** | Clarify autonomy vs permission vs escalation | Current model is confusing |
| **P1** | Move YAML/config language behind advanced controls | Executive usability |
| **P2** | Add outcome lineage | Could become a major Vocion differentiator |
| **P2** | Normalize workspace goal contribution | Enables real portfolio-level reporting |

**Vocion should not tell me whether my agents ran. It should tell me whether my AI workforce is earning its keep, whether I can trust it, and exactly why it believes that.** That is the standard this page is designed around.

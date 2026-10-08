# The weekly org review — the team looking at itself

> An agent nobody has used in six weeks still sits on the roster. Another hits
> its cap every afternoon doing work people accept; a third spends real money
> on proposals people turn down. A rulebook grows to 747 rules, a third of
> them saying the same thing and some saying the opposite.

None of that is a decision anyone took. It is what a team drifts into when
nobody looks at it as a team. The org review looks, once a week, and files
what it finds as **proposals a person decides** — never as changes it makes on
its own.

## What it does

Once a week per workspace (Mondays 14:00 UTC unless the workspace says
otherwise), the `org.review` job:

1. **Reads the evidence core already stores** — nothing new is collected
   (`services/orgReview/signals.ts`):

   | Signal | Read from |
   |---|---|
   | When each agent last worked | the latest of a chat turn (`conversation`), a tool call it made (`tool_call` — a specialist reached only through its lead counts), a worker run, a mission run it led, a proposal it made, an ask it filed — all time |
   | What it spent | assistant turns' cost (`conversation_message.micro_cents`) and worker runs' cents over 30 days; today's counter and the cap in force (`agent_budget`) |
   | What people decided on its work | the alignment ledger (`decision_alignment`) per action kind over 30 days, and the reasons people gave when they turned a proposal down |
   | What it escalates | asks it filed in 30 days, and how they were answered |
   | How each team is doing | the team's primary measure, read by the team report's own reader, and the catalog roles the team has not hired |

2. **Derives findings in code** (`findings.ts`), each a typed fact with a
   number behind it:

   | Finding | When | Changes it can justify |
   |---|---|---|
   | `idle` | no sign of work for `idleDays` (14); never the workspace lead, never an agent younger than the window | retire the agent |
   | `spend` | at its daily cap while people agree with ≥ 80% of its work (raise the cap), or ≥ $5 spent while people agree with < 50% (cut it) — both need ≥ 5 decided recommendations | re-scope its budget; for poor return also retire it or adopt a rule |
   | `rejections` | one kind of proposal turned down ≥ 3 times and at least half the time, *and* people said why | adopt a standing rule |
   | `escalations` | ≥ 5 asks filed in 30 days, *and* some were answered | adopt a standing rule that answers it in advance |
   | `measures` | a team below 50% of its primary measure's target with a catalog role it has not hired | hire that role |

   A measure that cannot be read is left out — a team is never called behind
   on a reading nobody took.

3. **Has a small model judge them** (`judge.ts`). The `classifier` model reads
   the findings — typed facts, already dated — and answers through one forced
   tool call: for each finding, which allowed change (or `none`), and the words.
   Code then routes on those fields: the change must be one the finding
   allows, the agent is the finding's own, a hire must be a role the catalog
   offered, a cap must be between $1 and $1,000 a day, a rule must be a
   sentence. The model chooses and words; it never decides what counts as
   evidence. If the read fails, the review files each finding's **fallback** —
   the change code can state alone (retire an idle agent; raise or halve a
   cap) — so a failed model call never ends the review silently.

4. **Files each change as an `org.change` proposal on Needs you**, strongest
   finding first, at most `maxProposals` (5) a week. The proposal carries the
   finding's evidence — each line linked to where a person can check it, the
   date it was read on the card — and goes through the same proposal and
   trust path as every other action.

5. **Tidies the rulebook** when its learning compaction is due (below), so a
   deployment without the feedback worker still compacts.

## The `org.change` action

One action, four kinds, each reversible:

| Kind | What approving does | Undo |
|---|---|---|
| `retire_agent` | Makes the agent inactive — the state apply gives an agent the workspace stopped shipping — and records a hold (`agent.paused_at/by/note`) that `workspace:apply` keeps: a deploy does not bring back an agent a person retired, and the apply summary says so | `active` and the hold go back to what they were |
| `set_budget` | Sets the agent's daily cap (soft and hard) | The previous caps are written back; a row the change created is removed |
| `hire_agent` | Hires a catalog role at its allowance — `team.hire_agent`'s act | Removes the agent, its budget and any team the hire created |
| `adopt_rule` | Adopts the rule through the feedback loop's pipeline — `learning.adopt_rule`'s act, duplicate judge and occurrence counting included | Un-adopts it |

**It waits for a person.** `org.change` is `medium` risk, so no confidence
releases it on the platform default. Each kind keys the ladder on its own
ledger — `org.change.retire_agent`, `org.change.set_budget`, … — so a
workspace can let budget re-scopes earn their way while retirements always
ask; a `trust.yaml` rule on the bare `org.change` covers every kind with none
of its own.

**The evidence is core's.** `evidence` is internal input: the review fills it
from the rows it read, and it is stripped from any other proposer. An agent
proposing an org change on its own arrives with no evidence and is refused; a
person asking for one themselves is not held to it — the person's word runs.

**A decision stands.** A declined change is not filed again for 30 days, and a
change that was made is given a month to show its effect. A change still
waiting is refreshed in place by next week's review rather than filed twice.

Proposals are filed under the review's own seat, `org-review`, so the
*agrees with you* score on them is the review's own, not any agent's.

## Learning compaction

Every suggested change to a rulebook is a `learning_candidate`, and now there
are three kinds (`libs/learning/ruleChange.ts`):

- **adopt** — a new rule, as before.
- **merge** — near-duplicates become one stronger rule. The model is shown the
  related rules (trigram groups) in batches of at most 60, so a 747-rule
  bucket is compacted over a few passes instead of in one prompt nobody can
  check. **The merged rule keeps what the originals earned**: their
  occurrence counts are summed onto it and each original rides along as
  provenance (`meta.mergedFrom`).
- **expire** — a rule is retired, nothing added. Two reasons:
  - **stale** — no agent has had it mounted, nobody has restated it, and it
    was adopted before the window (`staleRuleDays`, 60). Decided by code from
    dated fields; one batch of at most 50 per namespace at a time, quietest
    first. A person's own preferences are never retired for being quiet.
  - **contradicted** — the model names a pair that asks for opposite
    behaviour; the record says which is older, and the older one is proposed
    for retirement with the newer one shown beside it.

**Nothing is deleted.** A merged or retired rule is expired in the store —
invisible to every read, exactly as a deleted one was to the agents — with the
decision on its meta (who, when, why, what replaced it). **Undo** on the
learnings page (or `POST /api/v1/learning-candidates/:id/decide` with
`action: "undo"`) brings the rules back word for word. A merge whose new rule
cannot be written restores the originals rather than losing them.

Each merge or retirement is decided on `/dashboard/learnings` and on Needs you
(the *Suggested rule* kind), with what goes, why, and each rule's occurrence
count, source, last read and last restated. Keeping things as they are needs
no reason, and a kept rule is not suggested again for the window. Rules the
workspace authors in git (`learnings/<step>.yaml`) are left alone — apply
would write them back — and a key already in a pending proposal is never
proposed twice.

## Configure it

In `workspace.yaml`:

```yaml
defaults:
  orgReview:
    schedule: '0 9 * * 2' # Tuesdays 09:00 UTC; default Mondays 14:00
    idleDays: 21 # default 14
    staleRuleDays: 90 # default 60
    maxProposals: 3 # default 5
    # enabled: false turns it off and removes its schedule
```

Every key is optional. Omit the block for the defaults. A personal workspace is
off unless it says `enabled: true`. The block lands on `project.org_review` at
apply, and the durable schedule `org-review-<workspace>` follows it — written
on apply and re-asserted for every workspace when the executor boots, so a
workspace applied before the review shipped still gets one.

To run one review by hand: `npm run org-review:run -- --org <projectId>`.

## The manifesto test

- **Outcome or activity?** The roster and the rulebook stay true to the work:
  fewer idle seats, budgets that follow results, rules that are read.
- **One obvious path?** One action, on the queue every other decision uses; no
  new page.
- **Can a person check it?** Every proposal lists its evidence, each line one
  move from where it is read, dated.
- **Earned?** It proposes; a person decides; a kind runs alone only after a
  workspace promotes it on its own ledger.
- **Faster, then better, then safer?** A person spends a minute on a card the
  review wrote instead of an afternoon reading the team report; nothing it
  does stops anyone, and everything it does comes back with Undo.

## Where it lives

- **Services:** `services/orgReview/` — `signals.ts` (the reads), `findings.ts`
  (pure), `judge.ts` (the model read and the routing), `OrgReviewService.ts`
  (`runOrgReview`), `schedule.ts`.
- **Action:** `libs/actions/org-change.ts` (`org.change`).
- **Compaction:** `services/ConsolidationService.ts` (merges, contradictions,
  stale retirements), `services/LearningCandidateService.ts` (decide and
  undo), `services/MemoryService.ts` (`retireRules`, `restoreRules`,
  `ruleSnapshots`).
- **Job:** `org.review` in `services/background/catalog.ts`.
- **Config:** `libs/orgReview/config.ts`; `project.org_review`, `agent.paused_*`
  (migration 0187); `learning_candidate.change_kind` and `evidence` (0186).
- **UI:** the review card on Needs you; `features/learnings/RuleChangeEvidence.tsx`
  on `/dashboard/learnings` and the Needs-you learning screen.

## Related

[Needs you](./needs-you.md) · [Earned autonomy](./earned-autonomy.md) ·
[Budgets](./budgets.md) · [Learning step](../entities/learning-step.md) ·
[Trust rules](../entities/trust.md)

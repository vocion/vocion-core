# Workforce measurement: four-sprint implementation plan

Status: Sprint 1 delivered; Sprint 2 measurement instrumentation delivered and
live-verified across human-assisted, scheduled and multi-agent pilot work.
This closes the engineering measurement scope, not business quality acceptance,
automatic capture of every workflow, or measured economic impact.
Sprint lengths are team planning decisions, not a four-week promise.

## Outcome and architecture

Measure useful accepted work, its quality, human effort and cost. Configured agent
counts describe capacity, not adoption or impact. Report at team/workflow level,
with agent drill-down. A delegated task is one business work item, even when many
agents and retries contribute. Scheduled monthly work is assessed at its natural
cadence, not against daily activity targets.

Vocion owns work records, review decisions, outcomes and actionable operational
scorecards. Amplitude handles adoption, funnels, cohorts and authorized comparative
analysis. Reuse existing tracing/evaluation infrastructure for diagnosis and
regression tests. A central analytics site is a possible reporting surface, not a
prerequisite or a separate analytics engine to build now.

One versioned event contract should identify instance, workspace, team, agent and
configuration version, workflow, work item, run, event ID and actor type. Export
only approved metadata. Human, automation and API actors stay distinct. Preserve
tenant boundaries, retention and access policy. Business outcome exports need
retry, deduplication and reconciliation; best-effort adoption events alone cannot
substantiate financial impact. Start with scheduled central reporting unless a
measured latency requirement justifies streaming.

## Measures

| Dimension | Definition |
| --- | --- |
| Availability | Configured, enabled, operationally verified and observed are separate states |
| Adoption | Meaningful-workflow users / eligible people; repeat use at natural cadence |
| Utilization | Agent-assisted eligible work items / all eligible work items |
| Throughput | Distinct accepted work items; backlog; median and p90 cycle time |
| Quality | First-pass acceptance; correction, defect and reopen rates |
| Human burden | Review/correction time per accepted item; approval queue age |
| Economics | Operating cost per accepted item; measured net labor time avoided |
| Improvement | Comparable quality, cost and throughput across versions and case mix |

Unknown is not zero. Execution completion is not acceptance, and acceptance is not
verified correctness. Show denominators, evaluation sample sizes, time windows,
freshness, coverage and source links. Capacity released is not automatically cash
saved. Model-graded quality must be calibrated against independent human labels.

## Sprint plan

| Sprint | Scope | Exit evidence |
| --- | --- | --- |
| 1 — Inventory and coverage | Reconcile deployed workforce; expose unused agents, enabled state, ownership, purpose, observed activity and measurement gaps; verify instrumentation | Workspace inventory exports, deployment/version register, ownership review and end-to-end event verification |
| 2 — Work and outcome contracts | Instrument three representative workflows: human-assisted, scheduled and multi-agent; work-item IDs, acceptance/correction reasons, review effort, baselines, durable outcome export | Same item traceable across delegates/retries without double-counting; explicitly sourced measured baseline or approved planning assumption, plus acceptance rubric per workflow |
| 3 — Operational and executive scorecards | In-product actionable scorecards, Amplitude adoption views, sampled quality checks and central outcome reporting | Owners can trace summary metrics to evidence; authorization, freshness and reconciliation checks pass |
| 4 — Improvement cycle | Fix a demonstrated bottleneck, evaluate comparable cases, roll out or revert; expand/fix/retire decision | Before/after evidence, decision log and next backlog; decide whether a dedicated central portal is needed |

## Sprint 1 implementation plan

### Scope and decisions

Extend the Scorecard surface with an admin-only workforce endpoint, using the deployed
workspace's database. Do not seed invented agents or assume authored repository
configuration is live. Keep all configured agents in the report, including disabled
and unused agents, and all teams including teams with no members. Resolve team
accountability from the existing team owner or workspace default. Show missing
purpose/goal/owner rather than inventing a responsible person.

Use the existing local adoption stream for selected meaningful human actions and
tool-call records for execution activity. Exclude heartbeats, sign-ins and machine
identities from human-action counts. A tool call, even a successful one, is not an
operational certification or an accepted work item. An agent that only generates
text may have no tool calls; autonomous execution coverage is therefore partial.

Show the requested time window and UTC generation timestamp. Export JSON with
schema version, workspace ID, teams, agents, mounted skills/playbooks, activity and
coverage. This enables an initial deployment reconciliation without a new central
service. Do not add together identically named agents from different workspaces
without preserving workspace and instance identity.

Amplitude key configuration is read through its existing status API; no credential
or hint is returned. Report delivery and completeness as unverified: configuration
is not ingestion evidence. Local event freshness and unlinked agent references are
visible indicators, not a completeness test.

### Engineering acceptance criteria

- Admin-only route derives workspace from the authenticated session, not input.
- Every query and join is tenant-scoped; isolation tests use colliding agent slugs.
- Unused and disabled agents remain visible; enabled null remains unknown.
- Empty telemetry stays explicitly unverified, never healthy or “never used.”
- Human actions exclude machine activity; background tool activity remains visible.
- Time windows exclude older and future events. Report is read-only.
- Team ownership inheritance, missing owners/goals, and empty teams are represented.
- Export contains no prompts, tool payloads, emails, secrets or analytics key hints.
- Existing Adoption charts remain unchanged; no migration or new vendor is required.

### Production verification and rollout

Engineering owns installation and data reliability. Each function owner validates
its team roster, purpose, eligible workload and accountability. The executive
sponsor owns prioritization. Named assignments must be confirmed by the business;
software must not silently assign them.

1. Record each instance hostname, environment, deployed core SHA, included workspace
   IDs and workspace configuration version. Include migrated/cloud workspaces.
2. Deploy the reviewed change through the normal release process. As an admin,
   open Scorecard in each workspace, select the agreed baseline window, and export
   the report. Confirm ordinary members cannot call `scorecard.workforce`.
3. Compare exports with the authored inventory. Mark configured-only, enabled,
   disabled, moved, missing and duplicate entries. Preserve evidence timestamps.
   An unobserved agent requires investigation, not automatic retirement.
4. Confirm human owners and intended workflows using existing workspace/team
   configuration. Run the normal workspace validation/apply review for corrections.
5. With approved test records, perform a human chat and review decision, and a
   separately identified scheduled/background run. Capture source event IDs and
   timestamps, agent/workspace IDs and deployed version. Do not generate external
   business actions just to test analytics.
6. Verify expected local events and tool records, then locate matching Amplitude
   events. Check workspace properties, actor separation, completed-turn semantics,
   event timing and absence of duplicate instrumentation. Model calls must not be
   reported as completed tasks. Exclude background identities from human charts.
7. Record verified, failed or unverified for each path, observed delivery delay,
   verifier and evidence location. Inspect tracing separately. A missing analytics
   key or inaccessible analytics project remains an explicit gap.
8. Reconcile the workforce headline against these records. Sprint 1 operational
   acceptance requires coverage of every in-scope instance, not just merged code.

Verification register columns:
`instance | environment | deployed_sha | workspace | configuration_version |
export_timestamp | owner_confirmed | roster_reconciled | human_event_evidence |
background_event_evidence | amplitude_delivery | trace_evidence | verified_by |
verified_at | blocker | next_action`.

### Validation and limitations

Database tests cover inventory completeness, ownership inheritance, tenant
isolation, actor filtering, time windows, no-activity semantics and safe exports.
Router tests cover member denial and authenticated workspace selection. Run lint,
types, integrity and dependency checks as required by the repository.

The implementation does not query production, certify external delivery, calculate
business impact, replace the work ledger, or create a central ingestion service.
Those are explicit rollout checks or later sprint work. Rollback removes the
additive Adoption panel and route; no data migration is involved.

## Operating cadence

Weekly, each owner reviews the largest loss (non-use, abandonment, execution
failure, rejection or review delay), inspects successful and failed examples,
selects a targeted change, evaluates it against a stable case set, then compares
production outcomes. Keep, revise or revert. Avoid targets based on messages,
tokens or agent-count leaderboards.

## References

- [Adoption instrumentation and workspace properties](https://github.com/vocion/vocion-core/pull/1493)
- [Human and unattended actor identities](https://github.com/vocion/vocion-core/pull/1482)
- [Amplitude Agent Analytics](https://amplitude.com/docs/amplitude-ai/agent-analytics/overview)
- [Langfuse evaluation](https://langfuse.com/docs/evaluation/overview)

## Product placement decision

Workforce performance lives in Scorecard. Adoption remains the people-adoption
view. The admin workforce table shows recorded model/tool activity, review
decisions, accepted-as-is rate and ledger model cost. Work-item throughput, human
review effort and business value remain explicitly unmeasured until Sprint 2.
Existing member scorecards retain their permissions. No new telemetry is sent.

## Workforce dashboard and improvement loop

The operational view is workspace → team → agent. Workspace and team object rows
show recorded activity coverage; expandable agent rows expose evidence and links
to the agent, review queue and playbooks. This is not a people-adoption leaderboard.
The overview includes only accessible, non-archived workspaces in the current
organization, with admin authorization before any aggregation.

Daily (rolling 24 hours) and weekly (rolling seven days) windows support triage.
Initial deterministic prompts identify enabled agents with no recorded work over
at least seven days, activity without review decisions, small review samples, and
at least five decisions with below 80% accepted as-is. These thresholds prompt an
investigation; they are not quality guarantees or statistical confidence. Disabled
agents do not generate utilization recommendations. Every prompt includes evidence,
a concrete next action, and what to measure after intervening.

The dashboard currently recalculates from recorded evidence on load. It does not
send scheduled digests, persist assigned improvements, or establish causal impact.
Activity counts must never be relabeled as completed tasks or financial value.

### Next measurement contracts

- Adoption: eligible task demand, routing, expected cadence and repeat useful output.
- Feedback: reviewed artifact/version, correction category and reviewer explanation.
- Approvals: queued, decided and resumed timestamps; accountable reviewer; blocked work.
- Chat: recurring task intent linked to resulting work and reusable playbook versions.
- Context/data: cited source versions, retrieval/access failures and evidence of missing
  facts in reviewed outputs. More context is not automatically an improvement.
- Improvement: owner, hypothesis, linked evidence, changed configuration version,
  baseline, evaluation examples, success measure and follow-up date.

Daily exceptions should highlight newly blocked work, failed runs and overdue
approvals when those events are instrumented. The weekly review should pick one
improvement per team, compare like-for-like outcomes, and check last week's change.
Persist this loop in the platform; send only attributed events to external analytics.
A later digest should read the same scoped evidence and improvement records as the
interactive dashboard, deduplicate unchanged findings and link back to the exact work.

### Reuse the existing reporting and review machinery

Core already has `TeamReportService`, scheduled daily team reports and the weekly
`org.review` job. The team report reads configured outcome measures, human
interventions and goal progress; `services/orgReview` reads rejection explanations,
escalations, idle work, spend and team measures to file `org.change` proposals.
The dashboard links to those existing surfaces. Extend their shared evidence and
renderers for richer insights rather than creating a competing scheduler or approval
queue. The lightweight dashboard triage prompts are not yet part of their digests.
The measurement contracts above describe needed coverage and linkage, not a claim
that none of those events or capabilities already exist in core.

## Sprint 2 implementation and acceptance

The new `workforce_item` is an explicitly registered business item, independent of
worker attempts, native mission runs and action proposals. A workspace-unique business key identifies
it; linked source records may belong to only one item. Delegates and retries link
to the same item. Registration captures workflow type, accountable agent/team,
configuration version, acceptance criteria and an optional manual baseline
with its source or rationale, basis (assumed or measured) and timed sample size. The baseline is not invented from execution duration.

An append-only event ledger records registration, links and human reviews. Each
command has a workspace-scoped idempotency key and expected item revision.
Identical retries return the original receipt; changed payloads, stale revisions,
cross-workspace sources and duplicate source attribution are rejected. Terminal
outcomes must be explicitly reopened before they can be changed. Source fingerprints
record the linked input, output and execution state. Changed evidence blocks
acceptance; a later change flags the old outcome and removes it from current
accepted totals until the source is refreshed and reviewed again. Review decisions
are human attestations, not independent correctness evaluations. API tokens may
register and link work but cannot attest a human review.

The Scorecard workspace view provides expandable work objects, registration, source
linking, review with structured reason and evidence, and JSON export. Synthetic
records are stored separately by an immutable test flag and excluded from ordinary
reports. Active effort is human-reported minutes, distinct from decision waiting.
Native mission links preserve their persisted task graph, assigned task owners and separately observed agents from tenant-scoped mission model calls,
configuration SHA and recorded mission model cost. Scheduled and multi-agent runs
can be linked directly, without inventing external-worker records. Task changes
invalidate an earlier evidence attachment or acceptance just as action changes do.
Mission model cost and linked-worker cost stay separate because their scopes may
overlap; never add them together. Worker spend is explicitly partial; missing spend and net savings remain unknown.
The cohort is items updated in the reporting window, not a claim of all eligible
work or total business throughput. Snapshots are capped at 1,000 items and identify
incompleteness. They are a durable reconciliation interface, not an acknowledgment
that a central analytics service received the events.

Daily reports and seven-day report runs consume the same deterministic improvement
rules as Scorecard. Suggestions refer to reviewer categories, missing measurements
and activity/review coverage. Notes cannot supply executable recommendations.
Existing schedules and recipients remain in place. No parallel email scheduler is
introduced. The report's decision-latency labels are corrected, and custom report
windows no longer silently reuse a 24-hour performance reading.

### Three pilot procedures

| Pilot | Stable item and linked evidence | Acceptance rubric | Manual baseline |
| --- | --- | --- | --- |
| Human-assisted classification | One business record; link its action proposal and any attempts | Reviewer verifies required fields against the source; corrections record category and reason | Planning assumption: 3 minutes per straightforward classification; timed sample 0 |
| Scheduled briefing | One scheduled occurrence; link its native mission run and explicit retry runs | Reviewer checks required sections, source freshness and unsupported claims | Planning assumption: 30 minutes for one recurring briefing; timed sample 0 |
| Multi-agent proposal | One requested proposal; link its native mission task graph, external workers and resulting actions | Reviewer checks requirements, supported claims, pricing assumptions and completeness | Planning assumption: 120 minutes for an initial proposal draft; timed sample 0 |

Registration and linkage are explicit in this release. The API can be called by
an adapter, but this is **not automatic capture across every existing agent or
scheduler**. An owner must register actual pilot work and attach its sources.
The sponsor approved planning assumptions in place of timed manual samples on
2026-10-29. This closes the baseline-definition requirement, not measured economic
impact. Real source links have now been verified for a historical human-assisted
action, a failed scheduled occurrence and a completed draft-only team run with a
separate interrupted attempt. Both team attempts remain one business item. No new
human acceptance was fabricated for these records. Central analytics delivery
belongs to Sprint 3. Full model/tool/vendor attribution remains an explicitly tracked
economics gap, not a reason to present partial worker spend as total cost.

### Live closure and improvement backlog

The final release passed 17 live adversarial API checks, including tenant forgery,
idempotency, stale revisions, concurrent decisions, synthetic exclusion and invalid
baseline provenance. Native mission cards and their workspace-scoped drilldown were
also verified in the browser. Local tests cover mission source drift, tenant-scoped
contributors, and several attempts attached to one item. Execution and human
quality acceptance remain separate.

The team pilot completed five tasks but did not meet its draft rubric: its final
memo exceeded the word limit and the lead reported missing the full independent
review. The runtime passes only the first 600 characters of each prior output into
the next task. Preserve these as observed quality findings, not accepted throughput
or validated learning. A short internal memo uses a separate 30-minute assumption
with zero timed samples; it does not inherit the full proposal's 120-minute estimate.

Prioritize these operational improvements in Sprint 3 alongside the scorecards:

- Deliver full, referenced review findings to synthesis and verify each finding's
  disposition; enforce output limits with deterministic checks.
- Version and refresh the brief against shipped capabilities so the next plan does
  not propose implementing work that has already shipped.
- Make planned mission execution durable or reconcile interrupted runs. The live
  pilot exposed a run left marked running after an app restart; retain cancelled
  attempts and link a retry to the same item. Wait for deployment completion, not
  only a changed version endpoint, before starting release-validation work.
- Make draft outputs and review findings directly available at the outcome-review
  surface. The native run page currently emphasizes the task graph; persisted task
  outputs are available through the run API and need a clearer operator presentation.

These findings are an improvement backlog, not a claim that the agents' business
performance has improved. Keep the pilot outcomes open pending human review.

### Provisional baseline policy

These are planning estimates chosen for the pilot, not industry benchmarks:

- Classification: 3 minutes for reading a straightforward transaction, choosing a
  category and recording it; excludes reconciliation and exception investigation.
- Briefing: 30 minutes for checking routine sources and assembling the regular
  sections; excludes new research and unusual incident investigation.
- Proposal: 120 minutes for an initial draft from available discovery notes and an
  established template; excludes discovery meetings, new pricing work and revisions.

All three have timed sample size **0**. Store `baselineKind: assumed`,
`baselineSampleSize: 0` and the scope/rationale in the registration event. Do not
hardcode these values as defaults for unrelated workflows. For planning sensitivity,
compare half and twice each assumption; this is a scenario range, not a confidence
interval. A measured registration requires a positive sample size and evidence.
Older records without structured provenance display **unverified**, never measured.

Estimated gross manual workload is accepted, scope-matched items multiplied by the
assumed minutes. It is not net savings. Missing active effort, tool costs, exception
work or eligible-work denominators remain unknown. The dashboard continues to leave
realized savings unset. Replace assumptions when comparable observations are available;
do not rewrite historical registration evidence. Review the assumptions after the
first 10 comparable items or at the next sprint review, whichever comes first.

### Adversarial release gates

Exercise real migrated storage and HTTP handlers: missing/member authentication,
invalid bearer with valid session, forged workspace fields, colliding tenant keys,
foreign item/source IDs, payload conflicts, parallel retries, concurrent decisions,
double-linked attempts, completion without acceptance, terminal-state reopening,
unknown cost, missing baseline, synthetic exclusion and hostile evidence text.
Run live smoke verification through the signed-in QA account using test-flagged
records only. Never approve a real business action or send an external message as
part of a measurement test. Preserve failure evidence and distinguish local,
live-API and live-browser checks in the release report.

### Sprint 2 extension: learning assets and evidence

Measure the accumulated learning stock alongside use, throughput and accepted work.
Growing the stock is not itself a target: duplicated feedback, copied cases and repeated
runs can inflate activity without improving an agent.

Implemented from native workspace records, exposed in the workforce API/export and
workspace dashboard, with dataset object rows showing agent and team attribution:

- Current eval datasets, distinct cases within each dataset, and cases with reference
  answers. Cross-dataset overlap remains possible and is disclosed.
- Registered-agent coverage and dataset freshness. Latest results remain separated by
  dataset and its configured grader. A failed latest run never falls back to an older pass.
  Displayed pass rates require the same dataset version, a successful completed run after
  the last dataset edit and within 30 days, and a recorded configuration SHA.
- Unique feedback by source and external ID: accumulated stock, newly received in the
  selected period, and current pending/failed/applied processing states. This covers the
  feedback pipeline, not every comment or reaction across the product.
- Current approved/pending learning candidates, decisions in the selected window, and
  approved candidates with a linked completed post-decision eval. Completion is not a pass,
  and neither completion nor approval establishes improvement.
- Daily/weekly report recommendations call out feedback processing failures, missing or
  stale eval coverage, and approved learnings without linked completed evals.

Reviewed gold standards, independent holdout coverage and validated improvements remain
explicitly unknown. Existing reference answers have no trustworthy review provenance to
justify calling them gold standards. The next evidence contract must record reviewer,
review date, rubric, source, version, workflow/agent scope, retirement and holdout separation.
Validated improvement requires a linked change, comparable before/after results on the same
cases and grader, independent regression checks, and production outcome follow-up. A change
in pass rate alone is not causal evidence. Track resolved failure categories and recurrence,
not a universal learning score or an incentive to accumulate cases.

The native database is the source of truth. Amplitude may consume product engagement events;
a central analytics service may consume permission-scoped metric snapshots with stable IDs.
Neither should reconstruct gold-standard provenance from click events. No raw feedback,
reference answers or customer data is exported to a new analytics vendor by this extension.

Adversarial acceptance: cross-workspace IDs cannot join; duplicate feedback is counted once;
changing dataset versions or a newer failed run hides a misleading pass rate; hostile feedback
never becomes generated instructions; missing review and validation evidence stays unknown.
Learning metrics are omitted from synthetic-only outcome views because the existing eval and
feedback tables do not carry the outcome ledger's synthetic partition marker. Stock counts
are current snapshots, not historical as-of reconstructions or growth trends.

## Sprint 3: operating review delivery

The first Sprint 3 slice makes Scorecard an operating review instead of an agent
inventory. Its primary questions are what work was accepted, how much review was
needed, what spend was recorded and which evidence warrants intervention next.

- Workspace, team, reporting window and selected work item live in the URL. Native
  links preserve browser Back/Forward, refresh and sharing; parent breadcrumbs
  clear child selections. Unknown or inaccessible selections show an explicit
  unavailable state rather than silently broadening the report.
- The overview reads non-synthetic outcome evidence only for accessible,
  non-archived workspaces in the authenticated account. One shared outcome window
  is used across those workspaces. Summaries retain snapshot incompleteness.
- Headline measures are current accepted work, first-review acceptance among
  currently reviewed items, reported human effort and recorded agent model spend.
  The outcome cohort is explicitly registered items updated in the window, not
  total business demand or newly completed throughput. Stale acceptance is excluded;
  review effort on unsuccessful work is retained. Model spend is not added to
  overlapping worker/mission costs or divided into an invented unit-cost estimate.
- Work objects and prioritized outcome recommendations link to their native human
  review surface. Team filters scope the outcome summaries as well as agent evidence.
  Assigned agent counts and observed activity remain diagnostics rather than lead
  performance metrics. Empty evidence is not a healthy-performance verdict.
- Business alignment, eligible-work utilization, validated improvement and realized
  savings remain explicitly unmeasured. The three execution modes are not relabeled
  as a complete business-workflow catalog. This slice introduces no automatic
  expansion/retirement decisions and no new outcome attestations.

Remaining Sprint 3 work includes durable improvement ownership and change history,
comparable period evidence, business-workflow/objective linkage, full review-context
handoff and deterministic output limits, interrupted-mission recovery, and central
report reconciliation. Delivering this operating view does not close those items.

Validation covers malformed navigation values, unassigned teams, stale/reopened
outcomes, absent effort, first-review denominators, member denial and accessible
workspace boundaries. Browser checks cover URL-restored scope and parent links;
release verification must also exercise actual Back/Forward and reload in production.

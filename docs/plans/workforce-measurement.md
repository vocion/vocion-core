# Workforce measurement: four-sprint implementation plan

Status: proposed delivery plan; Sprint 1 implementation accompanies this document.
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
| 2 — Work and outcome contracts | Instrument three representative workflows: human-assisted, scheduled and multi-agent; work-item IDs, acceptance/correction reasons, review effort, baselines, durable outcome export | Same item traceable across delegates/retries without double-counting; measured baseline and acceptance rubric per workflow |
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
worker attempts and action proposals. A workspace-unique business key identifies
it; linked source records may belong to only one item. Delegates and retries link
to the same item. Registration captures workflow type, accountable agent/team,
configuration version, acceptance criteria and an optional measured manual baseline
with its evidence. The baseline is not invented from execution duration.

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
Worker spend is explicitly partial; missing spend and net savings remain unknown.
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
| Human-assisted classification | One business record; link its action proposal and any attempts | Reviewer verifies required fields against the source; corrections record category and reason | Time representative manual cases; record sample and source |
| Scheduled briefing | One scheduled occurrence; link the producing worker and retries | Reviewer checks required sections, source freshness and unsupported claims | Measure the same briefing preparation manually |
| Multi-agent proposal | One requested proposal; link every contributing worker and resulting action | Reviewer checks requirements, supported claims, pricing assumptions and completeness | Measure comparable proposal scope, including revision effort |

Registration and linkage are explicit in this release. The API can be called by
an adapter, but this is **not automatic capture across every existing agent or
scheduler**. An owner must register actual pilot work and attach its sources.
Business baselines, sufficient review samples, full model/tool/vendor cost
attribution, automatic runtime propagation and delivery to central analytics remain
acceptance work; synthetic fixtures cannot establish them. Do not call the full
Sprint 2 business exit criteria complete until those records exist.

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

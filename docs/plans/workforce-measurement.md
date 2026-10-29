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

Extend the existing admin-only Adoption surface and router, using the deployed
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
- Existing Adoption charts continue to work; no migration or new vendor is required.

### Production verification and rollout

Engineering owns installation and data reliability. Each function owner validates
its team roster, purpose, eligible workload and accountability. The executive
sponsor owns prioritization. Named assignments must be confirmed by the business;
software must not silently assign them.

1. Record each instance hostname, environment, deployed core SHA, included workspace
   IDs and workspace configuration version. Include migrated/cloud workspaces.
2. Deploy the reviewed change through the normal release process. As an admin,
   open Adoption in each workspace, select the agreed baseline window, and export
   the report. Confirm ordinary members cannot call `adoption.workforce`.
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

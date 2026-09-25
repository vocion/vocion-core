import type { LoadedAgent, LoadedAutomation, LoadedEvalDataset, LoadedLearningStep, LoadedMission, LoadedObjectType, LoadedPlaybook, LoadedSource, LoadedTeam, LoadedWorkflow, LoadedWorkspace } from './loader';
import type { KnownProcessorNames, SourceUpsertSpec } from '@/libs/sources/upsert';
import { readFileSync } from 'node:fs';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { addressOnDomain, defaultMailboxAddress, mailDomain } from '@/libs/mail/mailbox';
import { canonical, reconcileSourceSchedules, storedProcessorNames, upsertSourceRow, validateSourceSpec } from '@/libs/sources/upsert';
import { agentSchema, automationSchema, businessObjectTypeSchema, evalDatasetSchema, evalEvaluatorSchema, memoryNamespaceSchema, missionSchema, playbookSchema, projectSchema, teamSchema, trustRuleSchema, userSchema, workflowSchema, workspaceVersionSchema } from '@/models/Schema';
import { AGENT_DEFAULT_SCOPE_SLUG, setCentsLimits } from '@/services/BudgetService';
import { deriveRole } from './hierarchy';
import { effectiveTeamSlug } from './teams';

export type ApplyOptions = {
  dryRun?: boolean;
  appliedBy?: string;
  /** Override orgId from manifest (useful for applying MetaCTO context to a different tenant for testing) */
  orgId?: string;
};

export type ResourceCounts = {
  created: number;
  updated: number;
  unchanged: number;
  /**
   * Resources a dry-run could not classify because no database answered
   * (see {@link ApplyResult.database}): each would be created or updated,
   * and which is not known. Absent whenever the database was consulted.
   */
  unknown?: number;
  /**
   * Resources the apply left as they were because a person (or an agent)
   * changed them in the app since the workspace last wrote them — a seeded
   * wiki page edited in place. Each carries a warning naming the page and
   * how to reconcile. Only wiki pages report this today.
   */
  kept?: number;
};

export type ApplyResult = {
  sha: string;
  orgId: string;
  sourcePath: string;
  dryRun: boolean;
  counts: {
    agents: ResourceCounts;
    skills: ResourceCounts;
    objectTypes: ResourceCounts;
    workflows: ResourceCounts;
    missions: ResourceCounts;
    automations: ResourceCounts;
    playbooks: ResourceCounts;
    learningSteps: ResourceCounts;
    evalDatasets: ResourceCounts;
    sources: ResourceCounts;
    teams: ResourceCounts;
    /** Pages seeded from `wiki/<slug>.md`, plus the generated index (`services/wiki/WikiSeedService.ts`). */
    wikiPages: ResourceCounts;
  };
  errors: Array<{ resource: string; slug: string; message: string }>;
  /**
   * Non-fatal problems worth a human's attention but not worth failing the
   * apply over — an agent's authored lists (playbooks, skills, object
   * types, learning steps) going from non-empty to empty is the one case
   * today (see {@link warnEmptiedAgentLists}). Distinct from `errors`: an
   * apply with only warnings still reports `status: 'applied'`.
   */
  warnings: Array<{ resource: string; slug: string; message: string }>;
  versionId: number | null;
  /**
   * Whether the database was consulted. A dry-run whose `DATABASE_URL` does
   * not answer still validates every manifest and reports what it would
   * apply, but cannot tell created from updated (`counts.*.unknown`) or
   * resolve `accountableUser:` emails. A real apply is always `reachable`:
   * it writes, so an unreachable database fails it instead of degrading it.
   */
  database: { reachable: true } | { reachable: false; reason: string };
};

/**
 * How an apply may touch the database.
 *
 * `dryRun` writes nothing. `offline` is a dry-run that reads nothing either:
 * the database at `DATABASE_URL` did not answer, so every helper still
 * validates and builds the row it would write, then reports `unknown`
 * instead of asking whether the row exists. Never set for a real apply.
 *
 * Why not simply never read on a dry-run: the drift banner
 * (`routers/Workspace.ts`) and the `workspace_diff` MCP tool are dry-runs
 * that need the created/updated split, and they run where a database is.
 * The deploy repo's PR check runs the same dry-run where none is.
 */
type ApplyMode = { dryRun: boolean; offline: boolean };

/** How long a dry-run waits for the database to answer before going offline. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * One cheap round trip to learn whether the database answers. Bounded,
 * because `pg` waits on an unroutable host indefinitely by default and a
 * dry-run must finish either way.
 */
async function probeDatabase(): Promise<ApplyResult['database']> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { reachable: true };
  } catch (err) {
    return { reachable: false, reason: describeConnectionError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The connection failure as one line, from the innermost cause: drizzle
 * wraps the driver's error as "Failed query: select 1", and Node reports a
 * refused `localhost` as an `AggregateError` over both address families
 * whose own message is empty. The text a person can act on ("connect
 * ECONNREFUSED 127.0.0.1:5432") is underneath both.
 * @param err - Whatever the driver threw.
 */
function describeConnectionError(err: unknown): string {
  let inner: unknown = err;
  for (let depth = 0; depth < 5 && inner instanceof Error && inner.cause !== undefined; depth++) {
    inner = inner.cause;
  }
  if (inner instanceof AggregateError && inner.errors.length > 0) {
    return [...new Set(inner.errors.map(e => (e as Error).message))].join('; ');
  }
  const message = (inner as Error)?.message || (err as Error)?.message;
  return message || 'no answer';
}

export async function applyWorkspace(loaded: LoadedWorkspace, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const orgId = opts.orgId ?? loaded.manifest.orgId;
  const dryRun = opts.dryRun ?? false;
  // A real apply needs the database and fails loudly without one. A dry-run
  // does not: with no answer it still validates and reports what it would apply.
  const database: ApplyResult['database'] = dryRun ? await probeDatabase() : { reachable: true };
  const mode: ApplyMode = { dryRun, offline: !database.reachable };
  const defaults = loaded.manifest.defaults ?? {};

  const errors: ApplyResult['errors'] = [];
  const warnings: ApplyResult['warnings'] = [];
  const counts: ApplyResult['counts'] = {
    agents: blank(),
    skills: blank(),
    objectTypes: blank(),
    workflows: blank(),
    missions: blank(),
    automations: blank(),
    playbooks: blank(),
    learningSteps: blank(),
    evalDatasets: blank(),
    sources: blank(),
    teams: blank(),
    wikiPages: blank(),
  };

  // Object types first — agents and skills may reference them
  for (const ot of loaded.objectTypes) {
    try {
      const outcome = await upsertObjectType(orgId, ot, mode, loaded.manifest.defaults?.gates);
      bump(counts.objectTypes, outcome);
    } catch (err) {
      errors.push({ resource: 'objectType', slug: ot.slug, message: (err as Error).message });
    }
  }

  // Skills are SKILL.md folders — same catalog table as playbooks, kind-tagged.
  for (const skill of loaded.skills) {
    try {
      const outcome = await upsertPlaybook(orgId, skill, mode);
      bump(counts.skills, outcome);
    } catch (err) {
      errors.push({ resource: 'skill', slug: skill.slug, message: (err as Error).message });
    }
  }

  // Teams before agents — agents carry a validated `team:` slug ref.
  for (const team of loaded.teams) {
    try {
      const outcome = await upsertTeam(orgId, team, mode, errors);
      bump(counts.teams, outcome);
    } catch (err) {
      errors.push({ resource: 'team', slug: team.slug, message: (err as Error).message });
    }
  }

  // Workspace lead + workspace-default accountable human are project
  // config (workspace.yaml `lead:` / `accountableUser:`), not a team row.
  await applyWorkspaceLeadConfig(orgId, loaded, mode, errors);

  for (const agent of loaded.agents) {
    try {
      const outcome = await upsertAgent(orgId, agent, defaults, mode, loaded.teams, warnings);
      bump(counts.agents, outcome);
      if (!dryRun) {
        await reconcileManagedHarness(orgId, agent, errors);
      }
    } catch (err) {
      errors.push({ resource: 'agent', slug: agent.slug, message: (err as Error).message });
    }
  }

  // Spend caps from each agent's `budget:` and `defaults.agentBudget` (#272).
  await applyBudgets(orgId, loaded, mode, errors);

  for (const workflow of loaded.workflows) {
    try {
      const outcome = await upsertWorkflow(orgId, workflow, mode);
      bump(counts.workflows, outcome);
    } catch (err) {
      errors.push({ resource: 'workflow', slug: workflow.slug, message: (err as Error).message });
    }
  }

  // A workflow the workspace no longer ships is retired, not left active:
  // an unauthored definition must not keep starting runs. Run history stays.
  if (!dryRun) {
    try {
      const { ne, notInArray } = await import('drizzle-orm');
      const authored = loaded.workflows.map(w => w.slug);
      await db
        .update(workflowSchema)
        .set({ status: 'retired' })
        .where(and(
          eq(workflowSchema.orgId, orgId),
          ne(workflowSchema.status, 'retired'),
          authored.length > 0 ? notInArray(workflowSchema.slug, authored) : undefined,
        ));
    } catch (err) {
      errors.push({ resource: 'workflow', slug: '(retire sweep)', message: (err as Error).message });
    }
  }

  for (const mission of loaded.missions) {
    try {
      const outcome = await upsertMission(orgId, mission, mode);
      bump(counts.missions, outcome);
    } catch (err) {
      errors.push({ resource: 'mission', slug: mission.slug, message: (err as Error).message });
    }
  }

  for (const automation of loaded.automations) {
    try {
      const outcome = await upsertAutomation(orgId, automation, mode);
      bump(counts.automations, outcome);
    } catch (err) {
      errors.push({ resource: 'automation', slug: automation.slug, message: (err as Error).message });
    }
  }

  // WHAT THE WORKSPACE NO LONGER SHIPS IS RETIRED, NOT LEFT RUNNING.
  //
  // Until 2026-09-24 the applier only ever added and updated: an agent, a
  // mission or an automation deleted from the YAML kept its row, kept its
  // `active`/`status`, kept waking on its schedule and kept appearing on the
  // org chart. Deleting a file changed nothing on the box, so "delete" was
  // not a verb the workspace had. The workflow sweep above already had the
  // right shape; these three follow it. Rows are retired, never deleted —
  // run history, tool calls and worker runs still point at the slug.
  //
  // Scoped to this org, and to rows the applier itself wrote: an agent a
  // person hired from chat is committed to the workspace too (auto-commit),
  // so an unauthored active row is a leftover, not somebody's work.
  if (!dryRun) {
    const { ne, notInArray } = await import('drizzle-orm');
    const authoredAgents = loaded.agents.map(a => a.slug);
    const authoredMissions = loaded.missions.map(m => m.slug);
    const authoredAutomations = loaded.automations.map(a => a.slug);
    try {
      const retired = await db
        .update(agentSchema)
        .set({ active: 'false' })
        .where(and(
          eq(agentSchema.orgId, orgId),
          ne(agentSchema.active, 'false'),
          authoredAgents.length > 0 ? notInArray(agentSchema.slug, authoredAgents) : undefined,
        ))
        .returning({ slug: agentSchema.slug });
      for (const row of retired) {
        warnings.push({ resource: 'agent', slug: row.slug, message: 'not in the workspace any more — deactivated (row kept; runs and tool calls still point at it)' });
      }
    } catch (err) {
      errors.push({ resource: 'agent', slug: '(retire sweep)', message: (err as Error).message });
    }
    try {
      const retired = await db
        .update(missionSchema)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(and(
          eq(missionSchema.orgId, orgId),
          ne(missionSchema.status, 'disabled'),
          authoredMissions.length > 0 ? notInArray(missionSchema.slug, authoredMissions) : undefined,
        ))
        .returning({ slug: missionSchema.slug });
      for (const row of retired) {
        warnings.push({ resource: 'mission', slug: row.slug, message: 'not in the workspace any more — disabled' });
      }
    } catch (err) {
      errors.push({ resource: 'mission', slug: '(retire sweep)', message: (err as Error).message });
    }
    try {
      const retired = await db
        .update(automationSchema)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(and(
          eq(automationSchema.orgId, orgId),
          ne(automationSchema.status, 'disabled'),
          authoredAutomations.length > 0 ? notInArray(automationSchema.slug, authoredAutomations) : undefined,
        ))
        .returning({ slug: automationSchema.slug });
      for (const row of retired) {
        warnings.push({ resource: 'automation', slug: row.slug, message: 'not in the workspace any more — disabled' });
      }
    } catch (err) {
      errors.push({ resource: 'automation', slug: '(retire sweep)', message: (err as Error).message });
    }
  }
  if (!mode.offline) {
    await reportPausedAutomations(orgId, loaded, warnings);
  }

  for (const pb of loaded.playbooks) {
    try {
      const outcome = await upsertPlaybook(orgId, pb, mode);
      bump(counts.playbooks, outcome);
    } catch (err) {
      errors.push({ resource: 'playbook', slug: pb.slug, message: (err as Error).message });
    }
  }

  // The same files, as ARTIFACTS (`libs/workspace/source.ts`): every mission
  // and every SKILL.md is mirrored so it edits like an artifact — versions,
  // restore, the pane, select-to-ask — with the file still the source of
  // truth. Content-identical mirrors add no version, so an apply that changed
  // nothing leaves the history alone; one that changed a file adds a
  // `system` version naming the sha, so "who changed this" has the git
  // answer beside the in-app ones. A file that is gone takes its mirror with
  // it, so nothing editable is left that could write the file back.
  if (!dryRun) {
    await mirrorSources(orgId, loaded, warnings);
  }

  // Wiki pages seeded from `wiki/<slug>.md` (`libs/workspace/wiki-pages.ts`):
  // each becomes or refreshes the markdown artifact with the same slug in the
  // `wiki` folder through the normal artifact save, so versions, undo and
  // `index-artifact` all apply. A page someone edited in the app since the
  // last seed is KEPT and named in the warnings, never overwritten. Runs on a
  // dry-run too (classify, warn, write nothing) — offline it can only count.
  try {
    const { seedWikiPages } = await import('@/services/wiki/WikiSeedService');
    const seeded = await seedWikiPages(orgId, loaded.wikiPages, { dryRun, offline: mode.offline, workspaceSha: loaded.sha });
    for (const o of seeded.outcomes) {
      bump(counts.wikiPages, o.outcome);
    }
    warnings.push(...seeded.warnings);
  } catch (err) {
    errors.push({ resource: 'wikiPage', slug: '(seed)', message: (err as Error).message });
  }

  for (const step of loaded.learningSteps) {
    try {
      const outcome = await upsertLearningStep(orgId, step, mode);
      bump(counts.learningSteps, outcome);
    } catch (err) {
      errors.push({ resource: 'learningStep', slug: step.name, message: (err as Error).message });
    }
  }

  for (const ds of loaded.evalDatasets) {
    try {
      const outcome = await upsertEvalDataset(orgId, ds, mode);
      bump(counts.evalDatasets, outcome);
    } catch (err) {
      errors.push({ resource: 'evalDataset', slug: ds.slug, message: (err as Error).message });
    }
  }

  // Sources whose stored row changed on this apply. A changed config means the
  // sync scope may have changed — a widened project include-list should start
  // pulling now, and a narrowed one should have its out-of-scope documents
  // pruned — so these get a one-off full sync in reconcileSchedules. Freshly
  // created sources are excluded: their credentials arrive via the Sources UI
  // after apply, so an immediate sync could only fail.
  const configChangedSourceSlugs = new Set<string>();
  // Only paid for when a source declares a processor: two reads, so that a
  // typo'd learning step or agent fails one source's apply rather than
  // degrading every run afterwards.
  const processorNames = loaded.sources.some(src => src.processor)
    ? await knownProcessorNames(orgId, loaded, mode)
    : { learningSteps: new Set<string>(), agentSlugs: new Set<string>() };
  for (const src of loaded.sources) {
    try {
      const outcome = await upsertSource(orgId, src, mode, processorNames);
      bump(counts.sources, outcome);
      if (outcome === 'updated' && src.enabled) {
        configChangedSourceSlugs.add(src.slug);
      }
    } catch (err) {
      errors.push({ resource: 'source', slug: src.slug, message: (err as Error).message });
    }
  }

  // Trust rules: full replace per org from workspace/<org>/trust.yaml.
  // Absent file (or empty rules) = no auto-execution anywhere.
  if (!dryRun) {
    try {
      await db.delete(trustRuleSchema).where(eq(trustRuleSchema.orgId, orgId));
      const rules = loaded.trust?.rules ?? [];
      if (rules.length > 0) {
        await db.insert(trustRuleSchema).values(rules.map(r => ({
          orgId,
          actionId: r.action,
          threshold: r.autoApproveAbove,
          enabled: String(r.enabled),
        })));
      }
      // The autonomy ladder behind those rules: rung + risk per authored
      // action (`rung:` / `risk:` on a rule, or the top-level `risk:` map).
      // In-app promotions of kinds the file does not name are left alone.
      const { syncPoliciesFromManifest } = await import('@/services/autonomy/AutonomyService');
      for (const problem of await syncPoliciesFromManifest(orgId, loaded.trust)) {
        errors.push({ resource: 'trustRule', slug: problem.action, message: problem.message });
      }
    } catch (err) {
      errors.push({ resource: 'trustRule', slug: 'trust.yaml', message: (err as Error).message });
    }
  }

  // Reconcile Temporal Schedules against the authored triggers: workflow
  // `trigger: {type: schedule}`, mission `schedule`, source `schedule`.
  // Best-effort — a dev box without Temporal still applies cleanly; the
  // schedules materialize on the next apply where Temporal is reachable.
  if (!dryRun) {
    await reconcileSchedules(orgId, loaded, errors, configChangedSourceSlugs);
  }

  // Compiled chat graphs bake in subagents — including the F1 team-lead
  // merge for the workspace lead — so an IN-PROCESS apply (MCP write
  // tools) must flush the harness LRU or the next chat turn serves the
  // pre-apply roster. Best-effort: CLI applies run in their own process
  // (nothing to flush) and must not fail on the harness import.
  if (!dryRun) {
    try {
      const { resetAgentRuntimeCache } = await import('@/services/agents/harness');
      resetAgentRuntimeCache();
    } catch { /* apply result is already durable; a stale cache is not */ }
  }

  let versionId: number | null = null;
  if (!dryRun) {
    const [row] = await db.insert(workspaceVersionSchema).values({
      orgId,
      sha: loaded.sha,
      sourcePath: loaded.sourcePath,
      status: errors.length > 0 ? 'partial' : 'applied',
      summary: counts as unknown as Record<string, Record<string, number>>,
      errors,
      appliedBy: opts.appliedBy ?? 'system',
    }).returning({ id: workspaceVersionSchema.id });
    versionId = row?.id ?? null;
  }

  return {
    sha: loaded.sha,
    orgId,
    sourcePath: loaded.sourcePath,
    dryRun,
    counts,
    errors,
    warnings,
    versionId,
    database,
  };
}

/**
 * `unknown`: offline dry-run — the row would be created or updated, which is
 * not known. `kept`: left as a person changed it, with a warning saying so.
 */
type UpsertOutcome = 'created' | 'updated' | 'unchanged' | 'unknown' | 'kept';

/**
 * Ensure/remove Temporal Schedules to match the authored workspace. One
 * connectivity probe up front: if Temporal is unreachable, log one warning
 * and skip — never fail the apply over scheduling.
 * @param orgId
 * @param loaded
 * @param errors
 * @param configChangedSourceSlugs
 */
async function reconcileSchedules(
  orgId: string,
  loaded: LoadedWorkspace,
  errors: ApplyResult['errors'],
  configChangedSourceSlugs: Set<string> = new Set(),
): Promise<void> {
  // Schedule-ownership guard. Reconciling Temporal Schedules makes THIS
  // process the scheduler-of-record. Local dev commonly runs against the
  // prod DB over an SSH tunnel — 127.0.0.1 looks local but ISN'T — so a URL
  // heuristic can't tell dev from prod. Require an explicit opt-in instead:
  // only the deployment that should own crons sets VOCION_SCHEDULE_OWNER=1.
  // Everyone else skips, so a stray local worker can never fight prod's
  // scheduler (duplicate drafts, double source syncs).
  if (process.env.VOCION_SCHEDULE_OWNER !== '1') {
    console.warn('[workspace:apply] Skipping schedule reconciliation — VOCION_SCHEDULE_OWNER != 1, so this process is not the scheduler-of-record. Set VOCION_SCHEDULE_OWNER=1 on the single deployment that should own mission/source/workflow crons (the prod box), never on a dev machine pointed at prod data.');
    return;
  }

  const { getTemporalClient } = await import('@/libs/temporal/client');
  try {
    await getTemporalClient();
  } catch {
    console.warn('[workspace:apply] Temporal unreachable — skipping schedule reconciliation (workflow schedules, mission schedules, source syncs). Re-apply with Temporal up to materialize them.');
    return;
  }

  const { ensureAutomationSchedule, removeAutomationSchedule } = await import('@/services/AutomationService');
  const { ensureWorkflowSchedule, removeWorkflowSchedule } = await import('@/services/WorkflowScheduleService');
  const { ensureMissionSchedule, removeMissionSchedule } = await import('@/services/MissionScheduleService');
  const { startSourceFullSync } = await import('@/services/SourceScheduleService');
  const { knowledgeSourceSchema: srcSchema } = await import('@/models/Schema');

  // A person's pause lives on the row, not in the YAML, and the Schedule
  // must come out of this pass still paused — created paused if Temporal
  // never had it, re-asserted paused if it did.
  const pausedRows = await db
    .select({ slug: automationSchema.slug, pausedNote: automationSchema.pausedNote })
    .from(automationSchema)
    .where(and(eq(automationSchema.orgId, orgId), isNotNull(automationSchema.pausedAt)));
  const pausedBySlug = new Map(pausedRows.map(r => [r.slug, { note: r.pausedNote }]));

  // Automations are the first-class WHEN. Schedule-whens get a Temporal
  // Schedule; event-whens are matched by EventService at emit time.
  for (const automation of loaded.automations) {
    try {
      if (automation.status === 'active' && automation.when.schedule) {
        await ensureAutomationSchedule({
          orgId,
          slug: automation.slug,
          cron: automation.when.schedule,
          paused: pausedBySlug.get(automation.slug),
        });
      } else {
        await removeAutomationSchedule(orgId, automation.slug);
      }
    } catch (err) {
      errors.push({ resource: 'automationSchedule', slug: automation.slug, message: (err as Error).message });
    }
  }

  for (const workflow of loaded.workflows) {
    try {
      const trigger = workflow.trigger as { type?: string; cron?: string; input?: Record<string, unknown> };
      if (workflow.status === 'active' && trigger?.type === 'schedule' && trigger.cron) {
        console.warn(`[workspace:apply] DEPRECATED: workflow "${workflow.slug}" embeds a schedule trigger — move it to an automation ({when: {schedule}, do: {workflow}}).`);
        await ensureWorkflowSchedule({ orgId, workflowSlug: workflow.slug, cron: trigger.cron, input: trigger.input });
      } else {
        await removeWorkflowSchedule(orgId, workflow.slug);
      }
    } catch (err) {
      errors.push({ resource: 'workflowSchedule', slug: workflow.slug, message: (err as Error).message });
    }
  }

  // A mission or automation the workspace no longer ships was just disabled
  // above; its Schedule has to go with it, or Temporal keeps firing a row
  // whose status says it must not.
  try {
    const { notInArray } = await import('drizzle-orm');
    const authoredAutomations = loaded.automations.map(a => a.slug);
    const staleAutomations = await db
      .select({ slug: automationSchema.slug })
      .from(automationSchema)
      .where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.status, 'disabled'), authoredAutomations.length > 0 ? notInArray(automationSchema.slug, authoredAutomations) : undefined));
    for (const row of staleAutomations) {
      await removeAutomationSchedule(orgId, row.slug);
    }
    const authoredMissions = loaded.missions.map(m => m.slug);
    const staleMissions = await db
      .select({ slug: missionSchema.slug })
      .from(missionSchema)
      .where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.status, 'disabled'), authoredMissions.length > 0 ? notInArray(missionSchema.slug, authoredMissions) : undefined));
    for (const row of staleMissions) {
      await removeMissionSchedule(orgId, row.slug);
    }
  } catch (err) {
    errors.push({ resource: 'missionSchedule', slug: '(retire sweep)', message: (err as Error).message });
  }

  for (const mission of loaded.missions) {
    try {
      if (mission.status === 'active' && mission.schedule) {
        console.warn(`[workspace:apply] DEPRECATED: mission "${mission.slug}" embeds a schedule — missions are pure goals; move the cadence to an automation ({when: {schedule}, do: {checkMission}}).`);
        await ensureMissionSchedule({ orgId, missionSlug: mission.slug, cron: mission.schedule });
      } else {
        await removeMissionSchedule(orgId, mission.slug);
      }
    } catch (err) {
      errors.push({ resource: 'missionSchedule', slug: mission.slug, message: (err as Error).message });
    }
  }

  for (const src of loaded.sources) {
    try {
      const [row] = await db
        .select({ id: srcSchema.id })
        .from(srcSchema)
        .where(and(eq(srcSchema.orgId, orgId), eq(srcSchema.slug, src.slug)));

      // Both cadences (incremental + reconcile), shared with the sources API so
      // a source written either way ends up on the same schedules.
      await reconcileSourceSchedules(orgId, specForSource(src), row?.id ?? null);

      // This apply changed the source's stored row — start a one-off full sync
      // so scope changes take effect now rather than at the next reconcile.
      if (row && src.enabled && configChangedSourceSlugs.has(src.slug)) {
        await startSourceFullSync({ orgId, sourceId: row.id, sourceSlug: src.slug });
      }
    } catch (err) {
      errors.push({ resource: 'sourceSchedule', slug: src.slug, message: (err as Error).message });
    }
  }
}

async function upsertObjectType(orgId: string, ot: LoadedObjectType, mode: ApplyMode, steer?: { sampleRate?: number; escalateBelow?: number }): Promise<UpsertOutcome> {
  // The workspace turns the judges' dials: its numbers win over the plugin's.
  const gates = (ot.gates ?? []).map(g => (g.judge && steer ? { ...g, judge: { ...g.judge, ...(steer.sampleRate !== undefined ? { sampleRate: steer.sampleRate } : {}), ...(steer.escalateBelow !== undefined ? { escalateBelow: steer.escalateBelow } : {}) } } : g));
  const payload = {
    orgId,
    slug: ot.slug,
    label: ot.label,
    description: ot.description ?? null,
    icon: ot.icon ?? null,
    // Gates ride inside the stored schema (`x-gates`, beside `x-display`), so
    // the write path that already loads the schema sees them with no second read.
    schema: gates.length > 0 ? { ...(ot.schema ?? {}), 'x-gates': gates } : (ot.schema ?? null),
    sourceRelevance: ot.sourceRelevance ?? null,
    classificationPrompt: ot.resolvedClassificationPrompt,
    fewShotExamples: ot.fewShotExamples.length > 0 ? ot.fewShotExamples : null,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(businessObjectTypeSchema)
    .where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, ot.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(businessObjectTypeSchema).values(payload);
    }
    return 'created';
  }

  if (isObjectTypeEqual(existing, payload)) {
    return 'unchanged';
  }

  if (!mode.dryRun) {
    await db
      .update(businessObjectTypeSchema)
      .set(payload)
      .where(eq(businessObjectTypeSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertAgent(
  orgId: string,
  agent: LoadedAgent,
  defaults: { model?: string; temperature?: string; agentProposals?: { openMax?: number; weeklyMax?: number } },
  mode: ApplyMode,
  teams: LoadedTeam[] = [],
  warnings: ApplyResult['warnings'] = [],
): Promise<UpsertOutcome> {
  const payload = {
    orgId,
    slug: agent.slug,
    name: agent.name,
    description: agent.description ?? null,
    systemPrompt: agent.resolvedSystemPrompt,
    model: agent.model ?? defaults.model ?? 'gpt-4o',
    temperature: String(agent.temperature ?? defaults.temperature ?? '0.3'),
    skillSlugs: agent.skills,
    connectorSources: agent.connectorSources,
    objectTypeSlugs: agent.objectTypes,
    documentSetIds: agent.documentSetIds,
    // The proposal budget rides in approvalPolicy (a jsonb the row already
    // has): the agent's own `proposals:`, else the workspace default. A
    // workspace that sets neither stores nothing and the built-in applies.
    approvalPolicy: (agent.proposals ?? defaults.agentProposals)
      ? { ...agent.approvalPolicy, proposals: { ...(defaults.agentProposals ?? {}), ...(agent.proposals ?? {}) } }
      : agent.approvalPolicy,
    searchConfig: agent.searchConfig,
    harnessConfig: agent.harness,
    fewShotExamples: agent.fewShotExamples,
    subagents: agent.resolvedSubagents,
    playbookSlugs: agent.playbooks,
    learningSteps: agent.learningSteps,
    suggestions: agent.suggestions,
    persona: agent.persona ?? null,
    accent: agent.accent ?? null,
    eyebrow: agent.eyebrow ?? null,
    handles: agent.handles,
    initiative: agent.initiative,
    langfuseProjectId: agent.langfuseProjectId ?? null,
    icon: agent.icon ?? null,
    active: String(agent.active),
    role: deriveRole(agent.parent),
    agentType: agent.agentType ?? null,
    team: agent.team ?? null,
    // Validated team membership (F1). Only meaningful when the workspace
    // defines teams — the loader validated the ref; leads auto-assign to
    // the team they lead. NULL in team-less workspaces, exactly as before.
    teamSlug: effectiveTeamSlug(agent, teams),
    parentAgentSlug: agent.parent ?? null,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agent.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(agentSchema).values(payload);
    }
    return 'created';
  }

  if (isAgentEqual(existing, payload)) {
    return 'unchanged';
  }

  warnEmptiedAgentLists(agent.slug, existing, payload, warnings);

  if (!mode.dryRun) {
    await db.update(agentSchema).set(payload).where(eq(agentSchema.id, existing.id));
  }
  return 'updated';
}

/** The agent lists a dropped-to-empty apply is worth warning about. */
const AGENT_LIST_FIELDS = ['playbookSlugs', 'skillSlugs', 'objectTypeSlugs', 'learningSteps', 'handles'] as const;

/**
 * Warn when this apply would empty out one of an agent's authored lists
 * (playbooks, skills, object types, or learning steps) that held entries
 * before. An apply from a branch that is simply missing those workspace
 * files — rather than one that deliberately cleared the list — produces
 * exactly this: `updated=1` with no other sign anything is wrong, and the
 * agent silently loses every playbook/skill/object type/learning step it
 * had. This does not block the apply — the new, empty list may be exactly
 * what was authored — it only makes sure a human sees it.
 * @param slug - The agent's slug, so the warning names who is affected.
 * @param existing - The agent row as it stood before this apply.
 * @param payload - The row this apply is about to write.
 * @param warnings - The apply's running warnings list; pushed into in place.
 */
function warnEmptiedAgentLists(
  slug: string,
  existing: typeof agentSchema.$inferSelect,
  payload: Record<string, unknown>,
  warnings: ApplyResult['warnings'],
): void {
  const emptied = AGENT_LIST_FIELDS.filter((field) => {
    const before = existing[field] ?? [];
    const after = (payload[field] as string[] | undefined) ?? [];
    return before.length > 0 && after.length === 0;
  });
  if (emptied.length === 0) {
    return;
  }
  const message = `agent "${slug}" apply emptied ${emptied.join(', ')} — was non-empty before this apply; check whether this branch is simply missing those workspace files rather than intentionally clearing them`;
  console.warn(`[workspace apply] ${message}`);
  warnings.push({ resource: 'agent', slug, message });
}

/**
 * Resolve an authored `accountableUser:` email to a user id. Unresolved
 * emails record a non-fatal error and store NULL — deploy boxes may not
 * have that user seeded yet; a later apply (after the user signs up)
 * heals the row. Offline (no database) there is no user table to ask, so
 * the email is neither resolved nor reported; `ApplyResult.database` says so.
 * @param email
 * @param resource
 * @param slug
 * @param mode
 * @param errors
 */
async function resolveAccountableUser(
  email: string | undefined,
  resource: string,
  slug: string,
  mode: ApplyMode,
  errors: ApplyResult['errors'],
): Promise<string | null> {
  if (email === undefined || mode.offline) {
    return null;
  }
  const [row] = await db
    .select({ id: userSchema.id })
    .from(userSchema)
    .where(eq(userSchema.email, email.toLowerCase()))
    .limit(1);
  if (!row) {
    errors.push({ resource, slug, message: `accountableUser "${email}" does not match any user — storing no owner; re-apply after that user signs up` });
    return null;
  }
  return row.id;
}

/**
 * Bring AWS's managed harness in line with what the agent now asks for.
 *
 * Two directions, and only the first used to exist:
 *
 * - **On** `aws-managed-harness`: provision or refresh the harness and record
 *   the ARN the invoke adapter reads. Skills are upserted before this, so the
 *   inline tool catalog is current.
 * - **Off** it: delete the harness the row points at and clear the ARN.
 *   Without this the harness stayed `READY` after an agent moved to
 *   `agentcore-container` — AWS's harness image, still chargeable, still
 *   reachable by ARN, while every turn went to our own container. It is
 *   invisible from the app, so the only way to find one was to read the
 *   AgentCore console.
 *
 * The teardown is addressed by the ARN on the row, never by a name lookup, so
 * it can only ever reach the harness this org's own row points at — including
 * an agent provisioned before harness names carried an org, whose bare
 * `vocion_<slug>` name a lookup could match for a different org.
 *
 * `runsOn` is already canonical here — `AgentManifestSchema` folds the
 * pre-rename spellings (`provider:`, `agentcore`, `runtime`) into the three
 * current names at parse time, which `harness-target.test.ts` pins — so a
 * plain comparison is enough and no normalisation belongs in this layer.
 *
 * Failures land in `errors` rather than throwing: an unreachable AgentCore
 * control plane must not stop the rest of a workspace apply, and a harness
 * left behind is a cost and hygiene problem, not a correctness one.
 * @param orgId - Tenant the agent belongs to.
 * @param agent - The agent as authored in workspace YAML.
 * @param errors - Apply-level error list, appended to on failure.
 */
async function reconcileManagedHarness(
  orgId: string,
  agent: LoadedAgent,
  errors: ApplyResult['errors'],
): Promise<void> {
  if (agent.harness?.runsOn === 'aws-managed-harness') {
    const { syncAgentCoreHarness } = await import('@/services/agents/providers/agentcore');
    const arn = await syncAgentCoreHarness(orgId, agent.slug);
    await db
      .update(agentSchema)
      .set({ harnessArn: arn })
      .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agent.slug)));
    return;
  }

  // Nothing to tear down unless this agent is recorded as having a harness.
  // Checked against the row rather than the previous YAML, because the YAML
  // that put it there may be long gone from the workspace.
  const [row] = await db
    .select({ harnessArn: agentSchema.harnessArn })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agent.slug)));
  if (!row?.harnessArn) {
    return;
  }

  try {
    const { deleteAgentCoreHarness } = await import('@/services/agents/providers/agentcore');
    // Addressed by the stored ARN, so this can only ever reach the harness
    // this org's own row points at.
    const { deleted, harnessId } = await deleteAgentCoreHarness(row.harnessArn);
    await db
      .update(agentSchema)
      .set({ harnessArn: null })
      .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agent.slug)));
    console.warn(
      `workspace: ${agent.slug} left aws-managed-harness — harness ${harnessId} ${deleted ? 'deleted' : 'was already gone'}, cleared harnessArn`,
    );
  } catch (err) {
    // The ARN stays on the row so the next apply tries again.
    errors.push({
      resource: 'agent',
      slug: agent.slug,
      message: `left aws-managed-harness but its harness could not be deleted: ${(err as Error).message}`,
    });
  }
}

async function upsertTeam(orgId: string, team: LoadedTeam, mode: ApplyMode, errors: ApplyResult['errors']): Promise<UpsertOutcome> {
  const payload = {
    orgId,
    slug: team.slug,
    name: team.name,
    description: team.description ?? null,
    leadAgentSlug: team.lead ?? null,
    // Explicit owner only — an omitted accountableUser stays NULL so the
    // workspace default is inherited at read time, never baked in here.
    accountableUserId: await resolveAccountableUser(team.accountableUser, 'team', team.slug, mode, errors),
    goal: team.goal ?? null,
    // Declarative like the rest: authored measures land wholesale (a legacy
    // `kpis:` block is already folded in by the schema), an omitted block
    // clears the column. The deprecated `kpis` column is no longer written.
    measures: team.measures,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(teamSchema)
    .where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.slug, team.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(teamSchema).values(payload);
    }
    return 'created';
  }

  if (
    existing.name === payload.name
    && (existing.description ?? null) === payload.description
    && (existing.leadAgentSlug ?? null) === payload.leadAgentSlug
    && (existing.accountableUserId ?? null) === payload.accountableUserId
    && (existing.goal ?? null) === payload.goal
    && JSON.stringify(existing.measures ?? []) === JSON.stringify(payload.measures)
  ) {
    return 'unchanged';
  }

  if (!mode.dryRun) {
    await db.update(teamSchema).set(payload).where(eq(teamSchema.id, existing.id));
  }
  return 'updated';
}

/**
 * The embedding settings to store on the project row, or null when the
 * workspace authored none.
 *
 * Null rather than an empty object, so "authored nothing" and "authored
 * something that happens to be empty" cannot be confused at read time — the
 * embedder treats null as "fall back to the environment".
 * @param defaults - The manifest's `defaults` block.
 * @param defaults.embeddingProvider
 * @param defaults.embeddingModel
 */
function embeddingConfigFrom(
  defaults: { embeddingProvider?: 'openai' | 'bedrock'; embeddingModel?: string },
): { provider?: 'openai' | 'bedrock'; model?: string } | null {
  if (!defaults.embeddingProvider && !defaults.embeddingModel) {
    return null;
  }
  return {
    ...(defaults.embeddingProvider ? { provider: defaults.embeddingProvider } : {}),
    ...(defaults.embeddingModel ? { model: defaults.embeddingModel } : {}),
  };
}

/**
 * Apply workspace.yaml's top-level `lead:` / `accountableUser:` / `surfaces:`
 * and its `defaults.embedding*` keys to the project row (all of it is project
 * config, not a special team).
 * Declarative: authored values are set, omitted keys clear the columns.
 * When no project row matches the resolved orgId (manifest-orgId
 * fallback), warn loudly and skip — never invent a project. Offline (no
 * database) the mailbox rules are still checked against the manifest, and
 * the project comparison is skipped quietly.
 * @param orgId
 * @param loaded
 * @param mode
 * @param errors
 */
/**
 * Write the spend caps the YAML declares (#272): each agent's `budget:` and
 * the workspace's default agent cap, `defaults.agentBudget`.
 *
 * Only what is written is applied. An agent with no `budget:` block keeps the
 * caps it has — the one set when it was hired, or by an admin — which is the
 * exception to this file's declarative rule, and on purpose: clearing them
 * would silently widen a cap somebody chose. A block that IS written owns its
 * caps, and a hand edit to them is put back on the next apply.
 *
 * Soft and hard caps are set to the same figure, as the hire flow sets them,
 * so the workspace's committed allowance (`workspaceHeadroom`) counts them.
 * @param orgId - The workspace.
 * @param loaded - The loaded workspace.
 * @param mode - Dry-run and offline flags; neither writes.
 * @param errors - Where a failed write is reported.
 */
async function applyBudgets(
  orgId: string,
  loaded: LoadedWorkspace,
  mode: ApplyMode,
  errors: ApplyResult['errors'],
): Promise<void> {
  if (mode.dryRun || mode.offline) {
    return;
  }
  const agentBudget = loaded.manifest.defaults?.agentBudget;
  if (agentBudget) {
    try {
      await setCentsLimits({
        orgId,
        agentSlug: AGENT_DEFAULT_SCOPE_SLUG,
        period: 'daily',
        softCentsLimit: agentBudget.dailyCents,
        hardCentsLimit: agentBudget.dailyCents,
      });
    } catch (err) {
      errors.push({ resource: 'budget', slug: AGENT_DEFAULT_SCOPE_SLUG, message: (err as Error).message });
    }
  }
  for (const agent of loaded.agents) {
    if (!agent.budget) {
      continue;
    }
    const caps: Array<{ period: 'daily' | 'monthly'; cents: number | undefined }> = [
      { period: 'daily', cents: agent.budget.dailyCents },
      { period: 'monthly', cents: agent.budget.monthlyCents },
    ];
    for (const cap of caps) {
      if (cap.cents === undefined) {
        continue;
      }
      try {
        await setCentsLimits({ orgId, agentSlug: agent.slug, period: cap.period, softCentsLimit: cap.cents, hardCentsLimit: cap.cents });
      } catch (err) {
        errors.push({ resource: 'budget', slug: agent.slug, message: (err as Error).message });
      }
    }
  }
}

async function applyWorkspaceLeadConfig(
  orgId: string,
  loaded: LoadedWorkspace,
  mode: ApplyMode,
  errors: ApplyResult['errors'],
): Promise<void> {
  const lead = loaded.manifest.lead ?? null;
  const accountableUserId = await resolveAccountableUser(loaded.manifest.accountableUser, 'workspace', 'workspace.yaml', mode, errors);
  // Ids are validated against the core registry at load, so anything reaching
  // here names a real route. Replaced wholesale: dropping a surface from the
  // YAML turns it off, same declarative rule as `lead:`.
  const enabledSurfaces = loaded.effectiveSurfaces;
  // Plugins the same way: the resolved, dependency-closed list lands wholesale;
  // dropping one from `plugins:` turns it off everywhere that reads the column.
  const enabledPlugins = loaded.enabledPlugins;
  const embeddingConfig = embeddingConfigFrom(loaded.manifest.defaults ?? {});
  // Declarative like the rest: authored entries land wholesale, an omitted
  // block clears the column (no fast path for any action type).
  const regenerateSkills = loaded.manifest.defaults?.regenerateSkills && Object.keys(loaded.manifest.defaults.regenerateSkills).length > 0
    ? loaded.manifest.defaults.regenerateSkills
    : null;
  // The export gate's gated playbook tags. NOT collapsed to null when empty,
  // unlike the mapping above: an authored empty list is a workspace saying it
  // gates nothing, and null is a workspace that said nothing at all and gets
  // core's defaults. Collapsing them would make the gate impossible to turn off.
  const clientFacingPlaybooks = loaded.manifest.defaults?.clientFacingPlaybooks ?? null;
  // How eager this workspace is to improve itself (0–10). Null is "authored
  // nothing", which reads as the shipped default of 7 — a stored 7 is a
  // workspace that chose it, and the two must stay tellable apart.
  const learningEagerness = loaded.manifest.defaults?.learningEagerness ?? null;
  const goal = loaded.manifest.goal ?? null;
  // The workspace's zone, declarative like the rest: omitted clears the column
  // and the runs fall back to the server default (`workspaceTimeZone`).
  const timeZone = loaded.manifest.defaults?.timezone ?? null;
  // voice.yaml, declarative like the rest: the whole file lands on the column
  // and deleting the file clears it, dropping the workspace back to core's
  // platform floor.
  const voiceRules = loaded.voice ?? null;
  // operating-intent.yaml, declarative like the rest: the whole file lands on
  // the column and deleting the file clears it, which is a person telling the
  // factory nothing rather than telling it everything is allowed.
  const operatingIntent = loaded.operatingIntent ?? null;

  const [project] = mode.offline
    ? [undefined]
    : await db
        .select({
          id: projectSchema.id,
          slug: projectSchema.slug,
          leadAgentSlug: projectSchema.leadAgentSlug,
          accountableUserId: projectSchema.accountableUserId,
          enabledSurfaces: projectSchema.enabledSurfaces,
          enabledPlugins: projectSchema.enabledPlugins,
          embeddingConfig: projectSchema.embeddingConfig,
          regenerateSkills: projectSchema.regenerateSkills,
          clientFacingPlaybooks: projectSchema.clientFacingPlaybooks,
          learningEagerness: projectSchema.learningEagerness,
          voiceRules: projectSchema.voiceRules,
          operatingIntent: projectSchema.operatingIntent,
          timeZone: projectSchema.timeZone,
          goal: projectSchema.goal,
          mailboxAddress: projectSchema.mailboxAddress,
          mailboxEnabled: projectSchema.mailboxEnabled,
        })
        .from(projectSchema)
        .where(eq(projectSchema.id, orgId))
        .limit(1);

  // Mailbox: `mailbox.enabled` claims `<slug>@<VOCION_MAIL_DOMAIN>` (or the
  // named address, which must be on that domain). No domain configured, or an
  // address off it, is an error — a workspace must not pose as another host.
  const mailboxManifest = loaded.manifest.mailbox;
  let mailboxEnabled = false;
  let mailboxAddress: string | null = null;
  if (mailboxManifest?.enabled) {
    const domain = mailDomain();
    if (!domain) {
      errors.push({ resource: 'workspace', slug: 'workspace.yaml', message: 'mailbox.enabled is set but VOCION_MAIL_DOMAIN is not configured on this deployment' });
    } else {
      const candidate = (mailboxManifest.address ?? defaultMailboxAddress(project?.slug ?? loaded.manifest.name, domain)).toLowerCase();
      if (!addressOnDomain(candidate, domain)) {
        errors.push({ resource: 'workspace', slug: 'workspace.yaml', message: `mailbox.address "${candidate}" is not on ${domain}; a workspace may only claim addresses on the deployment's mail domain` });
      } else {
        mailboxEnabled = true;
        mailboxAddress = candidate;
      }
    }
  }

  if (!project) {
    if (mode.offline) {
      return;
    }
    if (lead !== null || loaded.manifest.accountableUser !== undefined || enabledSurfaces.length > 0 || enabledPlugins.length > 0 || embeddingConfig !== null || regenerateSkills !== null || clientFacingPlaybooks !== null || learningEagerness !== null || voiceRules !== null || operatingIntent !== null || goal !== null || mailboxEnabled) {
      console.warn(`[workspace:apply] no project row matches org "${orgId}" — workspace lead/accountableUser/surfaces/embedding defaults NOT applied. Pass --project <id|slug> so they land on a real project.`);
    }
    return;
  }

  const surfacesUnchanged
    = project.enabledSurfaces.length === enabledSurfaces.length
      && project.enabledSurfaces.every((s, i) => s === enabledSurfaces[i]);
  const pluginsUnchanged
    = (project.enabledPlugins ?? []).length === enabledPlugins.length
      && (project.enabledPlugins ?? []).every((s, i) => s === enabledPlugins[i]);
  // Compared as JSON rather than field by field: the object has two optional
  // keys, so a shallow equality check would have to enumerate both and would
  // silently stop covering a third. Same reasoning for the skill mapping,
  // whose keys are open-ended action ids.
  const embeddingUnchanged
    = JSON.stringify(project.embeddingConfig ?? null) === JSON.stringify(embeddingConfig);
  const regenerateUnchanged
    = JSON.stringify(project.regenerateSkills ?? null) === JSON.stringify(regenerateSkills);
  const clientFacingUnchanged
    = JSON.stringify(project.clientFacingPlaybooks ?? null) === JSON.stringify(clientFacingPlaybooks);
  const voiceUnchanged
    = JSON.stringify(project.voiceRules ?? null) === JSON.stringify(voiceRules);
  const operatingIntentUnchanged
    = JSON.stringify(project.operatingIntent ?? null) === JSON.stringify(operatingIntent);

  if (
    (project.leadAgentSlug ?? null) === lead
    && (project.accountableUserId ?? null) === accountableUserId
    && surfacesUnchanged
    && pluginsUnchanged
    && embeddingUnchanged
    && regenerateUnchanged
    && clientFacingUnchanged
    && (project.learningEagerness ?? null) === learningEagerness
    && voiceUnchanged
    && operatingIntentUnchanged
    && (project.goal ?? null) === goal
    && (project.timeZone ?? null) === timeZone
    && project.mailboxEnabled === mailboxEnabled
    && (project.mailboxAddress ?? null) === mailboxAddress
  ) {
    return;
  }
  if (!mode.dryRun) {
    await db
      .update(projectSchema)
      .set({ leadAgentSlug: lead, accountableUserId, enabledSurfaces, enabledPlugins, embeddingConfig, regenerateSkills, clientFacingPlaybooks, learningEagerness, voiceRules, operatingIntent, goal, timeZone, mailboxEnabled, mailboxAddress })
      .where(eq(projectSchema.id, project.id));
  }
}

async function upsertWorkflow(orgId: string, workflow: LoadedWorkflow, mode: ApplyMode): Promise<UpsertOutcome> {
  const payload = {
    orgId,
    slug: workflow.slug,
    name: workflow.name,
    description: workflow.description ?? null,
    version: workflow.version,
    status: workflow.status,
    trigger: workflow.trigger as unknown as Record<string, unknown>,
    steps: workflow.steps as unknown as Array<Record<string, unknown>>,
    inputSchema: workflow.inputSchema ?? null,
    ownerAgentSlug: workflow.agent ?? null,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(workflowSchema)
    .where(and(eq(workflowSchema.orgId, orgId), eq(workflowSchema.slug, workflow.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(workflowSchema).values(payload);
    }
    return 'created';
  }

  if (isWorkflowEqual(existing, payload)) {
    return 'unchanged';
  }

  if (!mode.dryRun) {
    await db.update(workflowSchema).set(payload).where(eq(workflowSchema.id, existing.id));
  }
  return 'updated';
}

/**
 * Mirror every mission, skill and playbook file into its `source` artifact,
 * and drop the mirrors of files that are gone. A WARNING per file, never an
 * error: the rows the runtime reads were written above, and an apply that
 * applied them all must not exit non-zero over a mirror (an unreadable path,
 * a body past the spec's cap). The message still names the file.
 * @param orgId
 * @param loaded
 * @param warnings
 */
async function mirrorSources(orgId: string, loaded: LoadedWorkspace, warnings: ApplyResult['warnings']): Promise<void> {
  const { mirrorSource, pruneSourceMirrors } = await import('@/services/workspace/WorkspaceSourceService');
  const summary = `Applied from the workspace (${loaded.sha.slice(0, 12)})`;
  const author = { kind: 'system' as const, id: null };
  const entries: Array<{ kind: 'mission' | 'skill' | 'playbook'; slug: string; title: string; sourceFile: string }> = [
    ...loaded.missions.map(m => ({ kind: 'mission' as const, slug: m.slug, title: m.name, sourceFile: m.sourceFile })),
    ...loaded.skills.map(s => ({ kind: 'skill' as const, slug: s.slug, title: s.name, sourceFile: s.sourceFile })),
    ...loaded.playbooks.map(p => ({ kind: 'playbook' as const, slug: p.slug, title: p.name, sourceFile: p.sourceFile })),
  ];
  for (const e of entries) {
    try {
      const content = readFileSync(e.sourceFile, 'utf8');
      await mirrorSource({ orgId, kind: e.kind, slug: e.slug, title: e.title, content, author, changeSummary: summary });
    } catch (err) {
      warnings.push({ resource: `${e.kind}Source`, slug: e.slug, message: `mirror not updated: ${(err as Error).message}` });
    }
  }
  try {
    await pruneSourceMirrors(orgId, entries.map(e => ({ type: e.kind === 'mission' ? 'mission' : 'playbook', id: e.slug })));
  } catch (err) {
    warnings.push({ resource: 'source', slug: '(prune)', message: `orphan mirrors not removed: ${(err as Error).message}` });
  }
}

async function upsertMission(orgId: string, mission: LoadedMission, mode: ApplyMode): Promise<UpsertOutcome> {
  const payload = {
    orgId,
    slug: mission.slug,
    name: mission.name,
    description: mission.description ?? null,
    version: mission.version,
    status: mission.status,
    goal: mission.goal,
    agentSlug: mission.agent,
    autonomyPolicy: mission.autonomyPolicy as unknown as Record<string, unknown>,
    successCriteria: mission.successCriteria,
    desiredArtifacts: mission.desiredArtifacts,
    schedule: mission.schedule ?? null,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(missionSchema)
    .where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, mission.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(missionSchema).values(payload);
    }
    return 'created';
  }
  if (JSON.stringify({ ...existing, id: 0, createdAt: 0, updatedAt: 0, projectId: 0 }) === JSON.stringify({ ...existing, ...payload, id: 0, createdAt: 0, updatedAt: 0, projectId: 0 })) {
    return 'unchanged';
  }
  if (!mode.dryRun) {
    await db.update(missionSchema).set(payload).where(eq(missionSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertAutomation(orgId: string, automation: LoadedAutomation, mode: ApplyMode): Promise<UpsertOutcome> {
  const payload = {
    orgId,
    slug: automation.slug,
    name: automation.name ?? automation.slug,
    description: automation.description ?? null,
    status: automation.status,
    whenConfig: automation.when as { schedule?: string; event?: string | string[]; filter?: Record<string, unknown>; maxFiresPer10m?: number },
    doConfig: automation.do as { workflow?: string; checkMission?: string; job?: string; input?: Record<string, unknown> },
    ownerAgentSlug: automation.agent ?? null,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(automationSchema)
    .where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, automation.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(automationSchema).values(payload);
    }
    return 'created';
  }
  if (
    existing.name === payload.name
    && (existing.description ?? null) === payload.description
    && existing.status === payload.status
    && (existing.ownerAgentSlug ?? null) === payload.ownerAgentSlug
    && canonical(existing.whenConfig) === canonical(payload.whenConfig)
    && canonical(existing.doConfig) === canonical(payload.doConfig)
  ) {
    return 'unchanged';
  }
  if (!mode.dryRun) {
    await db.update(automationSchema).set(payload).where(eq(automationSchema.id, existing.id));
  }
  return 'updated';
}

/**
 * Say which automations in this workspace are under a person's pause.
 *
 * `upsertAutomation` never writes the pause columns, so the pause survives
 * the apply on its own; this makes that visible in the summary rather than
 * leaving an operator to wonder why a freshly applied schedule is not firing.
 * A warning, not an error: the workspace applied, and the hold is deliberate.
 * @param orgId
 * @param loaded
 * @param warnings
 */
async function reportPausedAutomations(orgId: string, loaded: LoadedWorkspace, warnings: ApplyResult['warnings']): Promise<void> {
  const slugs = loaded.automations.map(a => a.slug);
  if (slugs.length === 0) {
    return;
  }
  const paused = await db
    .select({
      slug: automationSchema.slug,
      pausedAt: automationSchema.pausedAt,
      pausedBy: automationSchema.pausedBy,
      pausedNote: automationSchema.pausedNote,
    })
    .from(automationSchema)
    .where(and(eq(automationSchema.orgId, orgId), inArray(automationSchema.slug, slugs), isNotNull(automationSchema.pausedAt)));
  if (paused.length === 0) {
    return;
  }
  const ids = paused.map(p => p.pausedBy).filter((id): id is string => !!id);
  const users = ids.length > 0
    ? await db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, ids))
    : [];
  const nameById = new Map(users.map(u => [u.id, u.name?.trim() || u.email]));
  for (const p of paused) {
    const who = (p.pausedBy && nameById.get(p.pausedBy)) ?? p.pausedBy ?? 'someone';
    const when = p.pausedAt!.toISOString().slice(0, 16).replace('T', ' ');
    warnings.push({
      resource: 'automation',
      slug: p.slug,
      message: `paused by ${who} at ${when} UTC${p.pausedNote ? ` — ${p.pausedNote}` : ''}; left paused. Resume it from /dashboard/automation/${p.slug}.`,
    });
  }
}

async function upsertPlaybook(orgId: string, pb: LoadedPlaybook, mode: ApplyMode): Promise<UpsertOutcome> {
  const payload = {
    orgId,
    slug: pb.slug,
    name: pb.name,
    description: pb.description,
    kind: pb.kind,
    origin: pb.origin,
    attachedPlaybooks: pb.playbooks,
    frontmatter: {
      slug: pb.slug,
      name: pb.name,
      description: pb.description,
      playbooks: pb.playbooks,
      version: pb.version,
      resources: pb.resources,
      license: pb.license,
    } as Record<string, unknown>,
    contentSha: pb.contentSha,
    sourceFiles: pb.sourceFiles,
    license: pb.license ?? null,
    version: pb.version,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, pb.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(playbookSchema).values(payload);
    }
    return 'created';
  }

  if (
    existing.contentSha === payload.contentSha
    && existing.name === payload.name
    && existing.description === payload.description
    && existing.version === payload.version
    && existing.kind === payload.kind
    && existing.origin === payload.origin
    && canonical(existing.attachedPlaybooks) === canonical(payload.attachedPlaybooks)
    && canonical(existing.sourceFiles) === canonical(payload.sourceFiles)
  ) {
    return 'unchanged';
  }

  if (!mode.dryRun) {
    await db.update(playbookSchema).set(payload).where(eq(playbookSchema.id, existing.id));
  }
  return 'updated';
}

async function upsertEvalDataset(orgId: string, ds: LoadedEvalDataset, mode: ApplyMode): Promise<UpsertOutcome> {
  const payload = {
    orgId,
    slug: ds.slug,
    name: ds.name,
    description: ds.description ?? null,
    agentSlug: ds.agentSlug,
    provider: ds.provider,
    passThreshold: ds.passThreshold ?? null,
    items: ds.items,
    version: ds.version,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(evalDatasetSchema)
    .where(and(eq(evalDatasetSchema.orgId, orgId), eq(evalDatasetSchema.slug, ds.slug)));

  if (!existing) {
    if (!mode.dryRun) {
      await db.insert(evalDatasetSchema).values(payload);
      await upsertEvalEvaluators(orgId, ds);
    }
    return 'created';
  }

  if (
    existing.name === payload.name
    && (existing.description ?? null) === payload.description
    && existing.agentSlug === payload.agentSlug
    && existing.provider === payload.provider
    && (existing.passThreshold ?? null) === payload.passThreshold
    && existing.version === payload.version
    && canonical(existing.items) === canonical(payload.items)
  ) {
    if (!mode.dryRun) {
      await upsertEvalEvaluators(orgId, ds);
    }
    return 'unchanged';
  }
  if (!mode.dryRun) {
    await db.update(evalDatasetSchema).set(payload).where(eq(evalDatasetSchema.id, existing.id));
    await upsertEvalEvaluators(orgId, ds);
  }
  return 'updated';
}

/**
 * Record which evaluators this dataset wants, and nothing more.
 *
 * Apply writes desired state and stops. Creating a custom evaluator in the
 * customer's AWS account is a network call, and apply makes none today — one
 * unreachable AWS endpoint must not stop a workspace file landing its agents,
 * its playbooks and everything else in the same pass. The remote create
 * happens later in a Temporal activity, the same split `libs/sources/upsert.ts`
 * and `SourceSyncService` already use.
 *
 * Rows keep any `remoteId` they already have, so re-applying an unchanged file
 * never makes the next sync create a second evaluator in AWS.
 * @param orgId - Whose workspace.
 * @param ds - The dataset as authored, including any `evaluators` block.
 */
async function upsertEvalEvaluators(orgId: string, ds: LoadedEvalDataset): Promise<void> {
  const authored = ds.evaluators ?? [];
  const authoredSlugs: string[] = [];
  for (const evaluator of authored) {
    // A built-in is named, not defined: there is nothing to create remotely,
    // so each id becomes its own row and carries no config to sync.
    const slugs = evaluator.builtin?.length
      ? evaluator.builtin
      : [evaluator.slug].filter((slug): slug is string => Boolean(slug));
    for (const slug of slugs) {
      authoredSlugs.push(slug);
      const config = evaluator.builtin?.length
        ? {}
        : {
            instructions: evaluator.instructions,
            ratingScale: evaluator.ratingScale,
            model: evaluator.model,
            lambdaArn: evaluator.lambdaArn,
          };
      await db
        .insert(evalEvaluatorSchema)
        .values({
          orgId,
          datasetSlug: ds.slug,
          provider: evaluator.provider,
          slug,
          level: evaluator.level ?? null,
          config,
        })
        .onConflictDoUpdate({
          target: [
            evalEvaluatorSchema.orgId,
            evalEvaluatorSchema.datasetSlug,
            evalEvaluatorSchema.provider,
            evalEvaluatorSchema.slug,
          ],
          // `retiredAt: null` revives an evaluator someone took out and put
          // back: the row keeps its remote id, so the sync updates the
          // evaluator already in AWS instead of failing on its name.
          set: { level: evaluator.level ?? null, config, retiredAt: null, updatedAt: new Date() },
        });
    }
  }

  // An evaluator taken out of the file stops grading. Left active, it would
  // keep being sent to AWS on every run, so the scores would quietly disagree
  // with what the workspace says it measures.
  //
  // Retired, not deleted — the same sweep the workflows above do, and for the
  // same reason. We never call AWS `DeleteEvaluator`, so deleting the row
  // would strand the evaluator in the customer's account with nothing pointing
  // at it, and putting the evaluator back in the file later would try to
  // create a second one under a name AWS already has.
  const { isNull, notInArray } = await import('drizzle-orm');
  await db
    .update(evalEvaluatorSchema)
    .set({ retiredAt: new Date() })
    .where(and(
      eq(evalEvaluatorSchema.orgId, orgId),
      eq(evalEvaluatorSchema.datasetSlug, ds.slug),
      isNull(evalEvaluatorSchema.retiredAt),
      authoredSlugs.length > 0 ? notInArray(evalEvaluatorSchema.slug, authoredSlugs) : undefined,
    ));
}

/**
 * The learning steps and agents a processor config is allowed to name.
 *
 * Both the stored rows and the ones this apply is about to write: steps are
 * applied before sources, but a DRY run writes nothing, so reading the tables
 * alone would fail the first apply of a workspace that declares both. An API
 * caller gets the stored half only, it has no pass in which to create them.
 * Offline (no database) only the manifest's half is known, which is enough
 * to catch a typo against the names this workspace itself declares.
 * @param orgId - Org being applied to.
 * @param loaded - The workspace being applied.
 * @param mode - Whether the stored half can be read at all.
 */
async function knownProcessorNames(orgId: string, loaded: LoadedWorkspace, mode: ApplyMode): Promise<KnownProcessorNames> {
  const stored = mode.offline
    ? { learningSteps: new Set<string>(), agentSlugs: new Set<string>() }
    : await storedProcessorNames(orgId);
  return {
    learningSteps: new Set([...stored.learningSteps, ...loaded.learningSteps.map(s => s.name)]),
    agentSlugs: new Set([...stored.agentSlugs, ...loaded.agents.map(a => a.slug)]),
  };
}

/**
 * Write one manifest-declared source row.
 *
 * The write itself is `upsertSourceRow`, shared with `POST /api/v1/sources` so
 * the two writers cannot drift; this wrapper only turns a `LoadedSource` into
 * the spec that function takes.
 * Offline (no database) the same validation runs — connector, config
 * schema, processor — and the row is neither read nor written.
 * @param orgId - Org being applied to.
 * @param src - The source manifest.
 * @param mode - Report the outcome without writing, or without reading either.
 * @param known - What a processor config may name.
 */
async function upsertSource(orgId: string, src: LoadedSource, mode: ApplyMode, known: KnownProcessorNames): Promise<UpsertOutcome> {
  if (mode.offline) {
    validateSourceSpec(specForSource(src), known);
    return 'unknown';
  }
  const { outcome } = await upsertSourceRow(orgId, specForSource(src), { known, dryRun: mode.dryRun });
  return outcome;
}

/**
 * A manifest source as the shared writer takes it.
 * @param src - The loaded source manifest.
 */
function specForSource(src: LoadedSource): SourceUpsertSpec {
  return {
    slug: src.slug,
    kind: src.kind,
    config: src.config,
    enabled: src.enabled,
    schedule: src.schedule,
    reconcileSchedule: src.reconcileSchedule,
    processor: src.processor,
    access: src.access,
    manifestDir: src.manifestDir,
  };
}

/**
 * Workspace-shipped seed rules → memory-store entries, keyed
 * `ws-<rule id>.md` under the namespace's directory so re-applying is
 * idempotent and text edits update in place (`addRule` upserts on the fixed
 * key; the store carries `source: workspace:<id>` for provenance).
 * @param orgId
 * @param namespaceName
 * @param namespacePath
 * @param rules
 */
async function seedLearningRules(orgId: string, namespaceName: string, namespacePath: string, rules: Array<{ id: string; text: string }>): Promise<void> {
  const { addRule, namespaceFilePrefix } = await import('@/services/MemoryService');
  for (const r of rules) {
    const result = await addRule({
      orgId,
      stepName: namespaceName,
      ruleText: r.text.trim(),
      source: `workspace:${r.id}`,
      createdBy: 'workspace:apply',
      key: `${namespaceFilePrefix(namespacePath)}ws-${r.id}.md`,
    });
    if (!result.ok) {
      // A seed rule that near-duplicates an adopted rule is an authoring
      // conflict a person should resolve; skipping keeps the apply usable.
      console.warn(`[applier] seed rule "${r.id}" in ${namespaceName} skipped: ${result.detail}`);
    }
  }
}

async function upsertLearningStep(orgId: string, step: LoadedLearningStep, mode: ApplyMode): Promise<UpsertOutcome> {
  const { namespacePath } = await import('@/services/MemoryService');
  const scopeKind = step.scope?.kind ?? 'workspace';
  const scopeRef = step.scope?.ref ?? null;
  const payload = {
    orgId,
    name: step.name,
    scopeKind,
    scopeRef,
    path: namespacePath({ scopeKind, scopeRef, name: step.name }),
    title: step.title,
    description: step.description,
    preamble: step.preamble ?? null,
    agentSlugs: step.agents,
  };
  if (mode.offline) {
    return 'unknown';
  }

  const [existing] = await db
    .select()
    .from(memoryNamespaceSchema)
    .where(and(eq(memoryNamespaceSchema.orgId, orgId), eq(memoryNamespaceSchema.name, step.name)));

  if (!existing) {
    if (!mode.dryRun) {
      const [row] = await db.insert(memoryNamespaceSchema).values(payload).returning();
      if (row) {
        await seedLearningRules(orgId, row.name, row.path, step.rules ?? []);
      }
    }
    return 'created';
  }
  if (!mode.dryRun) {
    await seedLearningRules(orgId, existing.name, existing.path, step.rules ?? []);
  }

  if (
    existing.title === payload.title
    && existing.description === payload.description
    && (existing.preamble ?? null) === payload.preamble
    && canonical(existing.agentSlugs) === canonical(payload.agentSlugs)
    && existing.scopeKind === payload.scopeKind
    && (existing.scopeRef ?? null) === payload.scopeRef
    && existing.path === payload.path
  ) {
    return 'unchanged';
  }
  if (!mode.dryRun) {
    await db.update(memoryNamespaceSchema).set(payload).where(eq(memoryNamespaceSchema.id, existing.id));
  }
  return 'updated';
}

function isWorkflowEqual(a: typeof workflowSchema.$inferSelect, b: Record<string, unknown>): boolean {
  return canonical({
    name: a.name,
    description: a.description,
    version: a.version,
    status: a.status,
    trigger: a.trigger,
    steps: a.steps,
    inputSchema: a.inputSchema,
    ownerAgentSlug: a.ownerAgentSlug ?? null,
  }) === canonical({
    name: b.name,
    description: b.description,
    version: b.version,
    status: b.status,
    trigger: b.trigger,
    steps: b.steps,
    inputSchema: b.inputSchema,
    ownerAgentSlug: b.ownerAgentSlug ?? null,
  });
}

function blank(): ResourceCounts {
  return { created: 0, updated: 0, unchanged: 0 };
}

function bump(counts: ResourceCounts, outcome: UpsertOutcome): void {
  if (outcome === 'unknown' || outcome === 'kept') {
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    return;
  }
  counts[outcome] += 1;
}

// Equality helpers — JSON-stringify for structural comparison; avoids diffing timestamps/ids.
function isObjectTypeEqual(a: typeof businessObjectTypeSchema.$inferSelect, b: Record<string, unknown>): boolean {
  return canonical({
    label: a.label,
    description: a.description,
    icon: a.icon,
    schema: a.schema,
    sourceRelevance: a.sourceRelevance,
    classificationPrompt: a.classificationPrompt,
    fewShotExamples: a.fewShotExamples,
  }) === canonical({
    label: b.label,
    description: b.description,
    icon: b.icon,
    schema: b.schema,
    sourceRelevance: b.sourceRelevance,
    classificationPrompt: b.classificationPrompt,
    fewShotExamples: b.fewShotExamples,
  });
}

function isAgentEqual(a: typeof agentSchema.$inferSelect, b: Record<string, unknown>): boolean {
  const fields = [
    'name',
    'description',
    'systemPrompt',
    'model',
    'temperature',
    'skillSlugs',
    'connectorSources',
    'objectTypeSlugs',
    'documentSetIds',
    'approvalPolicy',
    'searchConfig',
    'harnessConfig',
    'fewShotExamples',
    'subagents',
    'playbookSlugs',
    'learningSteps',
    'suggestions',
    'persona',
    'accent',
    'eyebrow',
    'handles',
    'initiative',
    'langfuseProjectId',
    'icon',
    'active',
    'role',
    'agentType',
    'team',
    'teamSlug',
    'parentAgentSlug',
  ] as const;
  const pick = (src: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      out[f] = src[f];
    }
    return out;
  };
  return canonical(pick(a as unknown as Record<string, unknown>)) === canonical(pick(b));
}

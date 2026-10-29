import type { WorkforceCommand } from './contracts';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { runCostCents } from '@/libs/worker/runCost';
import { actionRunSchema, agentSchema, workforceEventSchema as events, workforceItemSchema as items, workforceLinkSchema as links, missionRunSchema, modelCallSchema, workerRunSchema } from '@/models/Schema';
import { workforceCommand, WorkforceError } from './contracts';
import { learningInsights, readWorkforceLearning } from './learning';

function fingerprint(row: { input: unknown; result: unknown; status: string }) {
  return createHash('sha256').update(JSON.stringify({ input: row.input, result: row.result, status: row.status })).digest('hex');
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SourceKind = Extract<WorkforceCommand, { kind: 'link' }>['sourceKind'];

/**
 * Normalize native mission evidence without changing older action/worker fingerprints.
 * @param tx
 * @param orgId
 * @param kind
 * @param ids
 * @param lock
 */
async function sourceRows(tx: Transaction, orgId: string, kind: SourceKind, ids: number[], lock = false) {
  if (kind === 'mission') {
    const query = tx.select().from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.id, ids)));
    const rows = await (lock ? query.for('share') : query);
    const contributors = await tx.selectDistinct({ runId: modelCallSchema.runId, agentSlug: modelCallSchema.agentSlug }).from(modelCallSchema).where(and(eq(modelCallSchema.orgId, orgId), eq(modelCallSchema.runKind, 'mission_run'), inArray(modelCallSchema.runId, rows.map(row => String(row.id)))));
    const agentsFor = (id: number) => contributors.filter(c => c.runId === String(id) && c.agentSlug).map(c => c.agentSlug!).sort();
    return rows.map(row => ({
      id: row.id,
      input: { brief: row.brief, goal: row.goal, team: row.team, workspaceSha: row.workspaceSha, autonomyPolicy: row.autonomyPolicy, recordedAgents: agentsFor(row.id) },
      result: { plan: row.plan, artifacts: row.artifacts, error: row.error },
      status: row.status,
      cents: null as number | null,
      mission: {
        id: row.id,
        status: row.status,
        configurationVersion: row.workspaceSha,
        tasks: row.plan?.tasks.length ?? 0,
        completedTasks: row.plan?.tasks.filter(t => t.status === 'completed').length ?? 0,
        agents: [...new Set(row.plan?.tasks.map(t => t.ownerAgentSlug) ?? [])].sort(),
        recordedAgents: agentsFor(row.id),
        // Recorded mission model spend only. Never add to worker totals: scopes can overlap.
        modelCostCents: row.microCents === null ? null : row.microCents / 1_000_000,
      },
    }));
  }
  if (kind === 'worker') {
    const query = tx.select({ id: workerRunSchema.id, input: workerRunSchema.input, result: workerRunSchema.result, status: workerRunSchema.status, cents: workerRunSchema.cents }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.id, ids)));
    const rows = await (lock ? query.for('share') : query);
    return rows.map(row => ({ id: row.id, input: row.input, result: row.result, status: row.status, cents: row.cents, mission: null }));
  }
  const query = tx.select({ id: actionRunSchema.id, input: actionRunSchema.input, result: actionRunSchema.result, status: actionRunSchema.status }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, ids)));
  const rows = await (lock ? query.for('share') : query);
  return rows.map(row => ({ id: row.id, input: row.input, result: row.result, status: row.status, cents: null as number | null, mission: null }));
}

function fail(status: number, message: string): never {
  throw new WorkforceError(status, message);
}

/**
 * All writes share an optimistic item revision and a durable idempotency key.
 * @param orgId
 * @param actorId
 * @param raw
 */
export async function recordWorkforceCommand(orgId: string, actorId: string, raw: WorkforceCommand) {
  const parsed = workforceCommand.safeParse(raw);
  if (!parsed.success) {
    fail(400, 'Invalid workforce command');
  }
  const command = parsed.data;
  if (command.kind === 'create' && Boolean(command.baselineMinutes) !== Boolean(command.baselineEvidence)) {
    fail(400, 'A baseline requires both minutes and source or rationale');
  }
  if (command.kind === 'create') {
    if ((command.baselineKind !== undefined || command.baselineSampleSize !== undefined) && !command.baselineMinutes) {
      fail(400, 'Baseline provenance requires baseline minutes and evidence');
    }
    if (command.baselineKind === 'measured' && !(command.baselineSampleSize && command.baselineSampleSize > 0)) {
      fail(400, 'A measured baseline requires a positive sample size');
    }
    if (command.baselineKind === 'assumed' && command.baselineSampleSize !== 0) {
      fail(400, 'An assumed baseline requires sample size zero');
    }
    if (command.baselineSampleSize !== undefined && !command.baselineKind) {
      fail(400, 'A sample size requires an explicit baseline kind');
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return db.transaction(async (tx) => {
    // Serialize event replay checks inside a workspace, including concurrent creates.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`workforce:${orgId}`}))`);
    const [previous] = await tx.select().from(events).where(and(eq(events.orgId, orgId), eq(events.eventKey, command.eventKey)));
    if (previous) {
      if (previous.commandHash !== hash || previous.actorId !== actorId) {
        fail(409, 'Event key already used for a different command or actor');
      }
      return { itemId: previous.itemId, version: previous.version, replayed: true };
    }
    let commandData: Record<string, unknown> = command;
    let itemId: string;
    let version: number;
    if (command.kind === 'create') {
      const [agent] = await tx.select().from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, command.agentSlug)));
      if (!agent) {
        fail(404, 'Agent not found in this workspace');
      }
      const [duplicate] = await tx.select({ id: items.id }).from(items).where(and(eq(items.orgId, orgId), eq(items.key, command.key)));
      if (duplicate) {
        fail(409, 'Work key already registered; use its existing item ID');
      }
      itemId = randomUUID();
      version = 0;
      await tx.insert(items).values({
        id: itemId,
        orgId,
        key: command.key,
        workflow: command.workflow,
        title: command.title,
        agentSlug: command.agentSlug,
        teamSlug: agent.teamSlug,
        rubric: command.rubric,
        configurationVersion: command.configurationVersion,
        baselineMinutes: command.baselineMinutes,
        baselineEvidence: command.baselineEvidence,
        test: command.test,
        createdBy: actorId,
      });
    } else {
      itemId = command.itemId;
      const [item] = await tx.select().from(items).where(and(eq(items.orgId, orgId), eq(items.id, itemId)));
      if (!item) {
        fail(404, 'Work item not found');
      }
      if (item.version !== command.version) {
        fail(409, 'Work item changed; reload before deciding');
      }
      version = item.version + 1;
      if (command.kind === 'link') {
        if (['accepted', 'corrected', 'rejected'].includes(item.status)) {
          fail(409, 'Reopen a decided item before changing its evidence');
        }
        const [row] = await sourceRows(tx, orgId, command.sourceKind, [command.sourceId]);
        if (!row) {
          fail(404, 'Source not found in this workspace');
        }
        const [used] = await tx.select().from(links).where(and(eq(links.orgId, orgId), eq(links.kind, command.sourceKind), eq(links.sourceId, command.sourceId)));
        if (used && used.itemId !== itemId) {
          fail(409, 'Source already belongs to a work item');
        }
        const sourceDigest = fingerprint(row);
        if (used) {
          await tx.update(links).set({ sourceDigest }).where(and(eq(links.orgId, orgId), eq(links.kind, command.sourceKind), eq(links.sourceId, command.sourceId)));
        } else {
          await tx.insert(links).values({ orgId, itemId, kind: command.sourceKind, sourceId: command.sourceId, sourceDigest });
        }
        // Persist the exact evidence revision in the immutable event as well.
        commandData = { ...command, sourceDigest };
      } else {
        if (['accepted', 'corrected'].includes(command.status)) {
          const attached = await tx.select().from(links).where(and(eq(links.orgId, orgId), eq(links.itemId, itemId)));
          for (const link of attached) {
            if (!['action', 'worker', 'mission'].includes(link.kind)) {
              fail(409, 'Unrecognized evidence source; refresh the work item');
            }
            const [row] = await sourceRows(tx, orgId, link.kind as SourceKind, [link.sourceId], true);
            if (!row || fingerprint(row) !== link.sourceDigest) {
              fail(409, 'Linked evidence changed; link the source again to review its current version');
            }
          }
        }
        const terminal = ['accepted', 'corrected', 'rejected'].includes(item.status);
        if (terminal !== (command.status === 'reopened')) {
          fail(409, terminal ? 'Reopen before revising an outcome' : 'Only decided items can be reopened');
        }
        if (command.status === 'accepted' && command.reason !== 'meets-rubric') {
          fail(400, 'Acceptance must attest to the rubric');
        }
        if (['corrected', 'rejected', 'blocked'].includes(command.status) && command.reason === 'meets-rubric') {
          fail(400, 'A correction, rejection or blocker needs a failure category');
        }
      }
      await tx.update(items).set({ version, updatedAt: new Date(), ...(command.kind === 'review' ? { status: command.status } : {}) }).where(and(eq(items.orgId, orgId), eq(items.id, itemId)));
    }
    await tx.insert(events).values({ orgId, itemId, eventKey: command.eventKey, commandHash: hash, version, kind: command.kind, actorId, data: commandData });
    return { itemId, version, replayed: false };
  });
}

/**
 * Bounded, reconcilable snapshot; callers must not treat a capped result as totals.
 * @param orgId
 * @param since
 * @param until
 * @param test
 */
export async function readWorkforceOutcomes(orgId: string, since: Date, until: Date, test = false) {
  const learning = test ? null : await readWorkforceLearning(orgId, since, until);
  return db.transaction(async (tx) => {
    const found = await tx.select().from(items).where(and(eq(items.orgId, orgId), eq(items.test, test), gte(items.updatedAt, since), lt(items.updatedAt, until))).orderBy(asc(items.id)).limit(1001);
    const selected = found.slice(0, 1000);
    const ids = selected.map(i => i.id);
    const [history, linked] = ids.length
      ? await Promise.all([
          tx.select().from(events).where(and(eq(events.orgId, orgId), inArray(events.itemId, ids))).orderBy(asc(events.id)).limit(10001),
          tx.select().from(links).where(and(eq(links.orgId, orgId), inArray(links.itemId, ids))).limit(10001),
        ])
      : [[], []];
    const evidenceComplete = history.length <= 10000 && linked.length <= 10000;
    const workerIds = linked.filter(l => l.kind === 'worker').map(l => l.sourceId);
    const actionIds = linked.filter(l => l.kind === 'action').map(l => l.sourceId);
    const missionIds = linked.filter(l => l.kind === 'mission').map(l => l.sourceId);
    const [actions, workers, missions] = await Promise.all([
      actionIds.length ? sourceRows(tx, orgId, 'action', actionIds) : [],
      workerIds.length ? sourceRows(tx, orgId, 'worker', workerIds) : [],
      missionIds.length ? sourceRows(tx, orgId, 'mission', missionIds) : [],
    ]);
    const rows = selected.map((item) => {
      const itemEvents = history.filter(e => e.itemId === item.id);
      const itemLinks = linked.filter(l => l.itemId === item.id);
      const evidenceChanged = itemLinks.some((link) => {
        const source = (link.kind === 'worker' ? workers : link.kind === 'mission' ? missions : link.kind === 'action' ? actions : []).find(r => r.id === link.sourceId);
        return !source || fingerprint(source) !== link.sourceDigest;
      });
      const attempts = itemLinks.filter(l => l.kind === 'worker').map(l => workers.find(w => w.id === l.sourceId));
      // Provenance lives in the immutable registration event. Legacy registrations
      // are unverified: never infer measurement from a free-text evidence field.
      const registration = itemEvents.find(e => e.kind === 'create');
      const baselineKind: 'assumed' | 'measured' | 'unverified' = evidenceComplete && registration && ['assumed', 'measured'].includes(String(registration.data.baselineKind)) ? registration.data.baselineKind as 'assumed' | 'measured' : 'unverified';
      const baselineSampleSize = baselineKind !== 'unverified' && typeof registration?.data.baselineSampleSize === 'number' ? registration.data.baselineSampleSize : null;
      const reviews = itemEvents.filter(e => e.kind === 'review');
      const effort = reviews.filter(e => typeof e.data.effortMinutes === 'number');
      // This is linked-worker cost, not total model/tool/vendor spend.
      const linkedWorkerCostCents = evidenceComplete && attempts.length && attempts.every(w => w && runCostCents(w) !== null) ? attempts.reduce((s, w) => s + runCostCents(w!)!, 0) : null;
      return { ...item, missionRuns: missions.filter(m => itemLinks.some(l => l.kind === 'mission' && l.sourceId === m.id)).flatMap(m => m.mission ? [m.mission] : []), baselineKind, baselineSampleSize, evidenceChanged, links: itemLinks, events: itemEvents.map(({ commandHash: _hash, ...e }) => e), linkedWorkerCostCents, costCoverage: 'partial' as const, activeEffortMinutes: evidenceComplete && effort.length ? effort.reduce((s, e) => s + Number(e.data.effortMinutes), 0) : null, effortCoverage: evidenceComplete && reviews.length > 0 && effort.length === reviews.length ? 'reported' as const : 'partial' as const, firstPassAccepted: evidenceComplete && reviews.length ? reviews[0]!.data.status === 'accepted' : null };
    });
    const accepted = rows.filter(i => !i.evidenceChanged && ['accepted', 'corrected'].includes(i.status));
    return { learning, learningRecommendations: learning ? learningInsights(learning) : [], schemaVersion: 1, workspaceId: orgId, generatedAt: until.toISOString(), window: { from: since.toISOString(), to: until.toISOString() }, test, complete: found.length <= 1000 && evidenceComplete, cohort: 'items updated in window' as const, items: rows, summary: { items: rows.length, accepted: accepted.length, blocked: rows.filter(i => i.status === 'blocked').length, firstPassAccepted: accepted.filter(i => i.firstPassAccepted).length, costPerAcceptedItem: null, netTimeSavedMinutes: null },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

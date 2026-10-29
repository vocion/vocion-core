import type { WorkforceCommand } from './contracts';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, agentSchema, workforceEventSchema as events, workforceItemSchema as items, workforceLinkSchema as links, workerRunSchema } from '@/models/Schema';
import { workforceCommand, WorkforceError } from './contracts';
import { learningInsights, readWorkforceLearning } from './learning';

function fingerprint(row: { input: unknown; result: unknown; status: string }) {
  return createHash('sha256').update(JSON.stringify({ input: row.input, result: row.result, status: row.status })).digest('hex');
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
    fail(400, 'A baseline requires both measured minutes and evidence');
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
        const source = command.sourceKind === 'worker' ? workerRunSchema : actionRunSchema;
        const [row] = await tx.select({ id: source.id, input: source.input, result: source.result, status: source.status }).from(source).where(and(eq(source.orgId, orgId), eq(source.id, command.sourceId)));
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
            const source = link.kind === 'worker' ? workerRunSchema : actionRunSchema;
            const [row] = await tx.select({ input: source.input, result: source.result, status: source.status }).from(source).where(and(eq(source.orgId, orgId), eq(source.id, link.sourceId))).for('share');
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
    const actions = actionIds.length ? await tx.select({ id: actionRunSchema.id, input: actionRunSchema.input, result: actionRunSchema.result, status: actionRunSchema.status }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, actionIds))) : [];
    const workers = workerIds.length ? await tx.select({ id: workerRunSchema.id, cents: workerRunSchema.cents, input: workerRunSchema.input, result: workerRunSchema.result, status: workerRunSchema.status }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.id, workerIds))) : [];
    const rows = selected.map((item) => {
      const itemEvents = history.filter(e => e.itemId === item.id);
      const itemLinks = linked.filter(l => l.itemId === item.id);
      const evidenceChanged = itemLinks.some((link) => {
        const source = (link.kind === 'worker' ? workers : actions).find(r => r.id === link.sourceId);
        return !source || fingerprint(source) !== link.sourceDigest;
      });
      const attempts = itemLinks.filter(l => l.kind === 'worker').map(l => workers.find(w => w.id === l.sourceId));
      const reviews = itemEvents.filter(e => e.kind === 'review');
      const effort = reviews.filter(e => typeof e.data.effortMinutes === 'number');
      // This is linked-worker cost, not total model/tool/vendor spend.
      const linkedWorkerCostCents = evidenceComplete && attempts.length && attempts.every(w => w && w.cents !== null) ? attempts.reduce((s, w) => s + Number(w!.cents), 0) : null;
      return { ...item, evidenceChanged, links: itemLinks, events: itemEvents.map(({ commandHash: _hash, ...e }) => e), linkedWorkerCostCents, costCoverage: 'partial' as const, activeEffortMinutes: evidenceComplete && effort.length ? effort.reduce((s, e) => s + Number(e.data.effortMinutes), 0) : null, effortCoverage: evidenceComplete && reviews.length > 0 && effort.length === reviews.length ? 'reported' as const : 'partial' as const, firstPassAccepted: evidenceComplete && reviews.length ? reviews[0]!.data.status === 'accepted' : null };
    });
    const accepted = rows.filter(i => !i.evidenceChanged && ['accepted', 'corrected'].includes(i.status));
    return { learning, learningRecommendations: learning ? learningInsights(learning) : [], schemaVersion: 1, workspaceId: orgId, generatedAt: until.toISOString(), window: { from: since.toISOString(), to: until.toISOString() }, test, complete: found.length <= 1000 && evidenceComplete, cohort: 'items updated in window' as const, items: rows, summary: { items: rows.length, accepted: accepted.length, blocked: rows.filter(i => i.status === 'blocked').length, firstPassAccepted: accepted.filter(i => i.firstPassAccepted).length, costPerAcceptedItem: null, netTimeSavedMinutes: null },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

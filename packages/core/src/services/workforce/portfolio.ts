import type { PortfolioCommand } from './portfolioContract';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workforcePortfolioEventSchema as events, workforceItemSchema as items, workforcePortfolioLinkSchema as links, teamSchema, workforcePortfolioSchema as workflows } from '@/models/Schema';
import { WorkforceError } from './contracts';
import { portfolioCommand } from './portfolioContract';

/**
 * Read current portfolio stock and explicit item associations, independent of the outcome window.
 * @param orgId - Authenticated workspace.
 */
export async function readWorkforcePortfolio(orgId: string) {
  const rows = await db.select().from(workflows).where(eq(workflows.orgId, orgId)).orderBy(asc(workflows.id)).limit(501);
  const ids = rows.slice(0, 500).map(r => r.id);
  const associations = ids.length ? await db.select().from(links).where(and(eq(links.orgId, orgId), inArray(links.workflowId, ids))) : [];
  return { complete: rows.length <= 500, workflows: rows.slice(0, 500).map(row => ({ ...row, itemIds: associations.filter(l => l.workflowId === row.id).map(l => l.itemId) })) };
}

/**
 * Latest immutable revisions for an explicitly scoped workflow.
 * @param orgId - Authenticated workspace.
 * @param id - Workflow identity.
 */
export async function readPortfolioHistory(orgId: string, id: string) {
  return db.select({ version: events.version, actorId: events.actorId, createdAt: events.createdAt, data: events.data }).from(events).where(and(eq(events.orgId, orgId), eq(events.workflowId, id))).orderBy(desc(events.version)).limit(20);
}

/**
 * Save a workflow and its improvement register atomically with immutable revision evidence.
 * @param orgId - Authenticated workspace.
 * @param actorId - Authenticated editor.
 * @param raw - Versioned command.
 */
export async function saveWorkforcePortfolio(orgId: string, actorId: string, raw: PortfolioCommand) {
  const parsed = portfolioCommand.safeParse(raw);
  if (!parsed.success) {
    throw new WorkforceError(400, 'Invalid portfolio record; closed improvements require evidence');
  }
  const command = parsed.data;
  if (new Set(command.itemIds).size !== command.itemIds.length || new Set(command.data.improvements.map(i => i.id)).size !== command.data.improvements.length) {
    throw new WorkforceError(400, 'Duplicate work or improvement identities');
  }
  const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`portfolio:${orgId}`}))`);
    const [previous] = await tx.select().from(events).where(and(eq(events.orgId, orgId), eq(events.eventKey, command.eventKey)));
    if (previous) {
      if (previous.commandHash !== hash || previous.actorId !== actorId) {
        throw new WorkforceError(409, 'Event key already used for another change');
      }
      return { id: previous.workflowId, version: previous.version };
    }
    const [row] = await tx.select().from(workflows).where(and(eq(workflows.orgId, orgId), eq(workflows.id, command.id)));
    if ((!row && command.version !== -1) || (row && row.version !== command.version)) {
      throw new WorkforceError(409, 'Workflow changed or is unavailable. Reload before saving.');
    }
    if (!row) {
      const existing = await tx.select({ id: workflows.id }).from(workflows).where(eq(workflows.orgId, orgId)).limit(500);
      if (existing.length >= 500) {
        throw new WorkforceError(400, 'Workspace portfolio limit reached');
      }
    }
    // Retain improvement identities: close abandoned work rather than deleting its history.
    if (row?.data.improvements.some(i => !command.data.improvements.some(next => next.id === i.id))) {
      throw new WorkforceError(400, 'Close existing improvements instead of removing them');
    }
    if (command.data.teamSlug !== null) {
      const [team] = await tx.select({ slug: teamSchema.slug }).from(teamSchema).where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.slug, command.data.teamSlug)));
      if (!team) {
        throw new WorkforceError(404, 'Team not found in this workspace');
      }
    }
    if (command.itemIds.length) {
      const found = await tx.select({ id: items.id }).from(items).where(and(eq(items.orgId, orgId), eq(items.test, false), inArray(items.id, command.itemIds)));
      if (found.length !== command.itemIds.length) {
        throw new WorkforceError(404, 'Work items must be real records from this workspace');
      }
      const assigned = await tx.select().from(links).where(and(eq(links.orgId, orgId), inArray(links.itemId, command.itemIds)));
      if (assigned.some(l => l.workflowId !== command.id)) {
        throw new WorkforceError(409, 'A work item already belongs to another business workflow');
      }
    }
    const version = command.version + 1;
    if (row) {
      await tx.update(workflows).set({ data: command.data, version, updatedAt: new Date() }).where(and(eq(workflows.orgId, orgId), eq(workflows.id, command.id)));
    } else {
      // Global UUID collision is rejected by the primary key; never updates a foreign record.
      const inserted = await tx.insert(workflows).values({ id: command.id, orgId, data: command.data, version }).onConflictDoNothing().returning({ id: workflows.id });
      if (!inserted.length) {
        throw new WorkforceError(409, 'Workflow identity is unavailable. Reload before saving.');
      }
    }
    await tx.delete(links).where(and(eq(links.orgId, orgId), eq(links.workflowId, command.id)));
    if (command.itemIds.length) {
      await tx.insert(links).values(command.itemIds.map(itemId => ({ orgId, workflowId: command.id, itemId })));
    }
    await tx.insert(events).values({ orgId, workflowId: command.id, eventKey: command.eventKey, commandHash: hash, version, actorId, data: command });
    return { id: command.id, version };
  });
}

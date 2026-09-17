/**
 * Resolving a CRM id to the name the workspace already holds — against
 * PGlite, because the whole point is that the answer comes from the mirror
 * rather than from the proposal's payload or an outbound call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { mirrorRef, resolveRecordLabels } = await import('./recordLabel');
const { listReviewRows } = await import('@/services/inbox/reviewRows');

const ORG = 'org_record_label_test';
let sourceId: number;

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  const [source] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' } }).returning({ id: knowledgeSourceSchema.id });
  sourceId = source!.id;
  await db.insert(knowledgeDocumentSchema).values([
    { orgId: ORG, sourceId, externalId: 'deals:900112', title: 'Northwind renewal', contentHash: 'a', metadata: { objectType: 'deals' } },
    { orgId: ORG, sourceId, externalId: 'companies:900500', title: 'companies 900500', contentHash: 'b', metadata: { objectType: 'companies', name: 'Northwind Traders' } },
    // Mirrored, but upstream never gave it a name: the title is the id again.
    { orgId: ORG, sourceId, externalId: 'deals:900999', title: 'deals 900999', contentHash: 'c', metadata: { objectType: 'deals' } },
  ]);
});

describe('mirrorRef', () => {
  it('accepts the inbox key and the mirror key, and refuses what the mirror does not hold', () => {
    expect(mirrorRef('hubspot:deals:900112')).toBe('deals:900112');
    expect(mirrorRef('deals:900112')).toBe('deals:900112');
    expect(mirrorRef('email:jane@example.test')).toBeNull();
    expect(mirrorRef('run:42')).toBeNull();
  });
});

describe('resolveRecordLabels', () => {
  it('names what it can, in one pass, and stays silent about the rest', async () => {
    const labels = await resolveRecordLabels(ORG, [
      'hubspot:deals:900112',
      'hubspot:companies:900500',
      'hubspot:deals:900999',
      'hubspot:deals:404404',
      'email:jane@example.test',
    ]);

    expect(labels.get('hubspot:deals:900112')).toBe('Northwind renewal');
    expect(labels.get('hubspot:companies:900500')).toBe('Northwind Traders');
    // A mirrored row whose only "name" is its own id is not a name.
    expect(labels.has('hubspot:deals:900999')).toBe(false);
    expect(labels.has('hubspot:deals:404404')).toBe(false);
    expect(labels.has('email:jane@example.test')).toBe(false);
  });

  it('never reaches across workspaces', async () => {
    expect((await resolveRecordLabels('org_someone_else', ['hubspot:deals:900112'])).size).toBe(0);
  });
});

describe('the inbox reads those names', () => {
  it('a proposal that carried no deal name still says which deal it is about', async () => {
    await db.insert(actionRunSchema).values([
      { orgId: ORG, actionId: 'hubspot.update', status: 'pending', invokedBy: 'agent:revenue-lead', input: { objectType: 'deals', objectId: '900112', properties: { closedate: '2026-11-30' } }, proposal: { agentSlug: 'revenue-lead' } },
      { orgId: ORG, actionId: 'hubspot.update', status: 'pending', invokedBy: 'agent:revenue-lead', input: { objectType: 'deals', objectId: '404404', properties: { closedate: '2026-11-30' } }, proposal: { agentSlug: 'revenue-lead' } },
    ]);

    const rows = await listReviewRows(ORG, 'open');
    const named = rows.find(r => r.described.record?.key === 'hubspot:deals:900112');
    const unnamed = rows.find(r => r.described.record?.key === 'hubspot:deals:404404');

    expect(named!.described.record).toMatchObject({ name: 'Northwind renewal', idLabel: 'Deal 900112', fromId: false });
    expect(named!.described.title).toBe('Update Northwind renewal — Close date: 2026-11-30');
    // Nothing knows this one. It says so rather than showing the id as a name.
    expect(unnamed!.described.record).toMatchObject({ name: 'Deal 404404', idLabel: 'Deal 404404', fromId: true });
  });
});

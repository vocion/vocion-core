/**
 * A record's body is an artifact (backlog 035) — the promises the mechanism
 * rests on, against a real database:
 *
 *   - the body is created from the row on first use, fields as headmatter and
 *     the prose as sections, linked 1:1 through the record link;
 *   - a field write through `objects.update_meta` writes a NEW VERSION with
 *     who and why, and the row is written exactly as before;
 *   - a failed version write never fails the record write;
 *   - history reads as a field-level diff between consecutive versions;
 *   - Restore goes back through `objects.update_meta` and lands version N+1
 *     equal to N's fields;
 *   - (Change is the artifact gesture: `tools/recordArtifactPath.test.ts`.)
 *
 * The object type is the software factory's request shape, trimmed; every
 * name is fictional.
 */
import type { MarkdownSpec } from '@/libs/cards/specs';
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, artifactSchema, artifactVersionSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { proposeAction, undoAction } = await import('@/services/ActionService');
const { listArtifactVersions } = await import('@/services/ArtifactService');
const { recordBody, recordHistory, restoreRecordVersion, writeRecordBodyVersion } = await import('./recordBody');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_record_body';
const PERSON = 'user_rb_priya';

const REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    title: { 'type': 'string', 'x-display': { hidden: true } },
    kind: { type: 'string', enum: ['bug', 'gap', 'idea'] },
    state: { type: 'string', enum: ['new', 'triaged', 'in_scope'] },
    priority: { type: 'integer', minimum: 0, maximum: 100 },
    outcome: { 'type': 'string', 'x-display': { label: 'Outcome', role: 'prose', order: 0 } },
    story: { 'type': 'string', 'x-display': { label: 'The story', role: 'prose', order: 2 } },
    acceptance: {
      'type': 'array',
      'x-display': { label: 'Acceptance criteria', role: 'prose', format: 'steps', order: 5 },
      'items': { type: 'object', properties: { statement: { type: 'string' }, met: { type: 'boolean' } } },
    },
    actualCents: { type: 'integer' },
  },
};

let requestId = 0;

function productManager(): Principal {
  return { kind: 'agent', id: 'agent:product-manager', grants: ['update_object'], autonomy: 2, scope: { orgId: ORG } };
}

function agentWrite(set: Record<string, unknown>, reason = 'Seven people asked for it.') {
  return proposeAction({
    orgId: ORG,
    actionId: 'objects.update_meta',
    principal: productManager(),
    invokedBy: 'agent:product-manager',
    input: { objectType: 'request', id: requestId, set, reason },
  });
}

async function readMeta(): Promise<Record<string, unknown>> {
  const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

async function bodies() {
  return db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, ORG), eq(artifactSchema.recordRole, 'body')));
}

beforeEach(async () => {
  forgetCachedObjectTypes();
  await db.delete(actionRunSchema);
  await db.delete(artifactVersionSchema);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: REQUEST_SCHEMA }).returning({ id: businessObjectTypeSchema.id });
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: type!.id,
    title: 'Export the ledger as CSV',
    status: 'active',
    metadata: {
      title: 'Export the ledger as CSV',
      kind: 'gap',
      state: 'triaged',
      outcome: 'Finance at Northwind closes the month without retyping the ledger.',
      story: 'Every month end someone at Northwind copies **the ledger** into a sheet by hand.',
      acceptance: [
        { statement: 'A CSV of the ledger downloads from the ledger page', met: false },
        { statement: 'Existing exports keep working' },
      ],
      actualCents: 1200,
    },
  }).returning({ id: businessObjectSchema.id });
  requestId = row!.id;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(artifactVersionSchema);
  await db.delete(artifactSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('recordBody — created from the row on first use', () => {
  it('makes one markdown artifact linked to the record, fields as headmatter and prose as sections', async () => {
    const body = await recordBody(ORG, requestId);

    expect(body).not.toBeNull();
    expect(body!.kind).toBe('markdown');
    expect(body!.recordType).toBe('object');
    expect(body!.recordId).toBe(String(requestId));
    expect(body!.recordRole).toBe('body');
    expect(body!.currentVersion).toBe(1);
    expect(body!.visibility).toBe('system');

    const spec = body!.spec as MarkdownSpec;

    expect(spec.md).toMatch(/^---\nkind: gap\nstate: triaged\nactualCents: 1200\n---\n\n# Export the ledger as CSV/);
    expect(spec.md).toContain('## Outcome\n\nFinance at Northwind closes the month without retyping the ledger.');
    expect(spec.md).toContain('## The story\n\nEvery month end');
    expect(spec.md).toContain('## Acceptance criteria\n\n- [ ] A CSV of the ledger downloads from the ledger page\n- Existing exports keep working');
    // The row's own columns are never fields of the body.
    expect(spec.md).not.toMatch(/^title:/m);
    expect(spec.record?.fields).toMatchObject({ kind: 'gap', state: 'triaged', actualCents: 1200 });
    expect(spec.record?.fields).not.toHaveProperty('title');
  });

  it('is 1:1 — asking again returns the same artifact', async () => {
    const a = await recordBody(ORG, requestId);
    const b = await recordBody(ORG, requestId);

    expect(b!.id).toBe(a!.id);
    expect(await bodies()).toHaveLength(1);
  });

  it('gives every type a body — a vendor as much as a request — and none to a type that opts out', async () => {
    const [vendor] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'vendor', label: 'Vendor', schema: { type: 'object', properties: { notes: { type: 'string' } } } }).returning({ id: businessObjectTypeSchema.id });
    const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: vendor!.id, title: 'Contoso Supply', metadata: { notes: 'Net 30.' } }).returning({ id: businessObjectSchema.id });
    const [ledger] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'sync_cursor', label: 'Sync cursor', schema: { 'type': 'object', 'x-record-body': false, 'properties': { at: { type: 'string' } } } }).returning({ id: businessObjectTypeSchema.id });
    const [cursor] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: ledger!.id, title: 'cursor', metadata: { at: 'x' } }).returning({ id: businessObjectSchema.id });

    const body = await recordBody(ORG, row!.id);

    expect((body!.spec as MarkdownSpec).md).toContain('## Notes\n\nNet 30.');
    expect(await recordBody(ORG, cursor!.id)).toBeNull();
  });
});

describe('a field write is a new version with who and why', () => {
  it('writes the row as before, then version 2 carrying the reason and the agent', async () => {
    const res = await agentWrite({ priority: 82 }, 'Seven people asked for it; on the product\'s promises.');

    expect(res.status).toBe('done');
    expect(await readMeta()).toMatchObject({ priority: 82, kind: 'gap' });

    const [body] = await bodies();
    const versions = await listArtifactVersions({ orgId: ORG, artifactId: body!.id });

    expect(versions.map(v => v.version)).toEqual([2, 1]);
    expect(versions[0]!.changeSummary).toBe('Seven people asked for it; on the product\'s promises.');
    expect(versions[0]!.authorKind).toBe('agent');
    expect(versions[0]!.authorId).toBe('agent:product-manager');
    expect(versions[0]!.runId).toBe(String(res.runId));
    expect((versions[0]!.spec as MarkdownSpec).record?.fields).toMatchObject({ priority: 82 });
    expect((versions[0]!.spec as MarkdownSpec).record?.written).toEqual(['priority']);
    // v1 is the record as it was before anybody wrote to it.
    expect((versions[1]!.spec as MarkdownSpec).record?.fields).not.toHaveProperty('priority');
    expect((res.result as { bodyVersion?: number }).bodyVersion).toBe(2);
  });

  it('is idempotent — a snapshot equal to the head writes nothing', async () => {
    await agentWrite({ priority: 82 });
    const again = await writeRecordBodyVersion({ orgId: ORG, objectId: requestId, reason: 'no change', written: [] });

    expect(again.status).toBe('unchanged');

    const [body] = await bodies();

    expect(body!.currentVersion).toBe(2);
  });

  it('a write of only what the type keeps for itself (x-bookkeeping) is not a version', async () => {
    await db.update(businessObjectTypeSchema).set({ schema: { ...REQUEST_SCHEMA, 'x-bookkeeping': ['actualCents'] } }).where(and(eq(businessObjectTypeSchema.orgId, ORG), eq(businessObjectTypeSchema.slug, 'request')));
    forgetCachedObjectTypes();
    await agentWrite({ priority: 82 });
    await agentWrite({ actualCents: 412 });

    const [body] = await bodies();

    expect(body!.currentVersion).toBe(2);
  });

  it('undo is a version too', async () => {
    const res = await agentWrite({ priority: 82 });
    await undoAction(res.runId, ORG, { by: PERSON });

    expect(await readMeta()).not.toHaveProperty('priority');

    const [body] = await bodies();
    const [head] = await listArtifactVersions({ orgId: ORG, artifactId: body!.id, limit: 1 });

    expect(head!.version).toBe(3);
    expect(head!.changeSummary).toMatch(new RegExp(`^Undid run #${res.runId}`));
    expect(head!.authorKind).toBe('human');
    expect((head!.spec as MarkdownSpec).record?.fields).not.toHaveProperty('priority');
  });

  it('a failed version write never fails the record write', async () => {
    const svc = await import('@/services/ArtifactService');
    const spy = vi.spyOn(svc, 'updateArtifact').mockRejectedValueOnce(new Error('disk on fire'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await recordBody(ORG, requestId);
      const res = await agentWrite({ priority: 40 });

      expect(res.status).toBe('done');
      expect(await readMeta()).toMatchObject({ priority: 40 });

      const [body] = await bodies();

      expect(body!.currentVersion).toBe(1);

      // …and the next write heals: its version carries the whole row.
      await agentWrite({ state: 'in_scope' });
      const [healed] = await bodies();

      expect(healed!.currentVersion).toBe(2);
      expect((healed!.spec as MarkdownSpec).record?.fields).toMatchObject({ priority: 40, state: 'in_scope' });
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }
  });
});

describe('history — who, when, why and what changed', () => {
  it('diffs consecutive versions field by field, newest first', async () => {
    await agentWrite({ priority: 82 }, 'Ranked.');
    await agentWrite({ priority: 90, state: 'in_scope' }, 'Moved up and in scope.');

    const history = await recordHistory(ORG, requestId);

    expect(history!.current).toBe(3);
    expect(history!.versions.map(v => v.version)).toEqual([3, 2, 1]);
    expect(history!.versions[0]).toMatchObject({ reason: 'Moved up and in scope.', authorKind: 'agent', authorName: 'product-manager' });
    expect(history!.versions[0]!.changes).toEqual([
      { key: 'state', label: 'State', before: 'triaged', after: 'in_scope' },
      { key: 'priority', label: 'Priority', before: 82, after: 90 },
    ]);
    expect(history!.versions[1]!.changes).toEqual([{ key: 'priority', label: 'Priority', before: null, after: 82 }]);
    expect(history!.versions[2]!.changes).toEqual([]);
    expect(history!.versions[0]!.restorable).toBe(false);
    expect(history!.versions[1]!.restorable).toBe(true);
  });

  it('shows a figure a rollup moved as drift, not as the write\'s change', async () => {
    await recordBody(ORG, requestId);
    // A rollup writes the row directly, as `services/objects/rollups.ts` does.
    await db.update(businessObjectSchema).set({ metadata: { ...(await readMeta()), actualCents: 5000 } }).where(eq(businessObjectSchema.id, requestId));
    await agentWrite({ priority: 82 }, 'Ranked.');

    const history = await recordHistory(ORG, requestId);

    expect(history!.versions[0]!.changes.map(c => c.key)).toEqual(['priority']);
    expect(history!.versions[0]!.drift.map(c => c.key)).toEqual(['actualCents']);
  });
});

describe('restore — back through objects.update_meta', () => {
  it('yields version N+1 equal to N\'s fields, as a write with Undo on it', async () => {
    await agentWrite({ priority: 82 }, 'Ranked.');
    await agentWrite({ priority: 90, state: 'in_scope' }, 'Moved up.');
    const before = await recordHistory(ORG, requestId);
    const v2 = before!.versions.find(v => v.version === 2)!;

    expect(v2.restorable).toBe(true);

    const out = await restoreRecordVersion({ orgId: ORG, objectId: requestId, version: 2, userId: PERSON });

    expect(out.status).toBe('done');
    expect(out.version).toBe(4);
    expect(out.fields).toEqual(['priority', 'state']);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId!));

    expect(run!.actionId).toBe('objects.update_meta');
    expect((run!.input as { reason: string }).reason).toBe('Restored version 2');
    expect(run!.invokedBy).toBe(PERSON);

    const [body] = await bodies();
    const versions = await listArtifactVersions({ orgId: ORG, artifactId: body!.id });
    const fieldsOf = (n: number) => (versions.find(v => v.version === n)!.spec as MarkdownSpec).record?.fields;

    expect(fieldsOf(4)).toEqual(fieldsOf(2));
    expect(versions[0]!.changeSummary).toBe('Restored version 2');
    expect(versions[0]!.authorKind).toBe('human');
    expect(versions[0]!.authorId).toBe(PERSON);
    expect(await readMeta()).toMatchObject({ priority: 82, state: 'triaged' });

    // And the restore is itself undoable, like any write.
    await undoAction(out.runId!, ORG, { by: PERSON });

    expect(await readMeta()).toMatchObject({ priority: 90, state: 'in_scope' });
  });

  it('restoring the head changes nothing and writes nothing', async () => {
    await agentWrite({ priority: 82 });
    const out = await restoreRecordVersion({ orgId: ORG, objectId: requestId, version: 2, userId: PERSON });

    expect(out).toMatchObject({ status: 'unchanged', runId: null });
  });

  it('never restores a figure only a rollup moved', async () => {
    await agentWrite({ priority: 82 });
    await db.update(businessObjectSchema).set({ metadata: { ...(await readMeta()), actualCents: 9900 } }).where(eq(businessObjectSchema.id, requestId));
    await agentWrite({ priority: 90 });
    await restoreRecordVersion({ orgId: ORG, objectId: requestId, version: 1, userId: PERSON });

    expect(await readMeta()).toMatchObject({ actualCents: 9900 });
    expect(await readMeta()).not.toHaveProperty('priority');
  });
});

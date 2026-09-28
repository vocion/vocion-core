/**
 * objects.rename — what a record is called.
 *
 * `objects.update_meta` refuses the row's own columns and says each "has its
 * own path"; for `title` there was none, so an agent could narrow a request's
 * scope in every field it could reach and leave the name announcing work the
 * record was no longer for. These are the promises the new path rests on: it
 * refuses a blank or unchanged name, it renames the row and nothing else, it
 * earns trust per object type, and Undo puts the old name back exactly.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, businessObjectSchema, businessObjectTypeSchema, trustRuleSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('./objects-propose-candidate');
const { objectsRenameAction } = await import('./objects-rename');
const { RESERVED_OBJECT_KEYS } = await import('./objects-update-meta');
const { listActions } = await import('./registry');
const { proposeAction, undoAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_rename';

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['title', 'kind'],
  properties: {
    title: { type: 'string' },
    kind: { type: 'string', enum: ['bug', 'gap', 'idea'] },
    state: { type: 'string', enum: ['new', 'triaged', 'in_scope'], title: 'State' },
  },
};

const WAS = 'add send/share to file detail page';
const NOW = 'Build the send endpoint the share dialog already calls';

let requestTypeId = 0;
let requestId = 0;

function productManager(orgId = ORG): Principal {
  return { kind: 'agent', id: 'agent:product-manager', grants: ['update_object'], autonomy: 2, scope: { orgId } };
}

function rename(title: string, over: Record<string, unknown> = {}) {
  return proposeAction({
    orgId: ORG,
    actionId: 'objects.rename',
    principal: productManager(),
    invokedBy: 'agent:product-manager',
    input: { objectType: 'request', id: requestId, title, reason: 'The share half already shipped; what is left is the send endpoint.', ...over },
    proposal: { confidence: 0.9, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'scope genuinely changed' },
  });
}

async function readRow(id = requestId) {
  const [row] = await db
    .select({ title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(eq(businessObjectSchema.id, id));
  return { title: row!.title, metadata: (row!.metadata ?? {}) as Record<string, unknown> };
}

beforeEach(async () => {
  forgetCachedObjectTypes();
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: REQUEST_SCHEMA }).returning({ id: businessObjectTypeSchema.id });
  requestTypeId = type!.id;
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: requestTypeId,
    title: WAS,
    status: 'active',
    metadata: { title: WAS, kind: 'gap', state: 'triaged' },
  }).returning({ id: businessObjectSchema.id });
  requestId = row!.id;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
});

describe('registration and the input contract', () => {
  it('is registered, internal, reversible, on the update_object grant', () => {
    expect(listActions().map(a => a.id)).toContain('objects.rename');
    expect(objectsRenameAction.external).toBe(false);
    expect(objectsRenameAction.undo).toBeDefined();
    expect(objectsRenameAction.grant).toBe('update_object');
  });

  it('keys the ladder per object type, so renaming a product is not renaming a request', () => {
    const parsed = objectsRenameAction.inputSchema.parse({ objectType: ' Request ', id: 12, title: 'x', reason: 'r' });

    expect(objectsRenameAction.policyKeyFor?.(parsed)).toBe('objects.rename.request');
  });

  it('dedupes on the record, not the name, so a second thought replaces the pending card', () => {
    const first = objectsRenameAction.inputSchema.parse({ objectType: 'request', id: 12, title: 'one', reason: 'r' });
    const second = objectsRenameAction.inputSchema.parse({ objectType: 'request', id: 12, title: 'two', reason: 'r' });

    expect(objectsRenameAction.dedupKeyFor?.(first)).toBe(objectsRenameAction.dedupKeyFor?.(second));
  });

  it('still cannot be reached through update_meta, which is the guard that made this action necessary', () => {
    expect(RESERVED_OBJECT_KEYS.has('title')).toBe(true);
  });
});

describe('what it refuses — and leaves no run behind', () => {
  it('refuses a name that is only whitespace', async () => {
    await expect(rename('    ')).rejects.toThrow(/cannot be blank/);

    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('refuses the name the record already has, rather than writing a run nobody can read', async () => {
    await expect(rename(WAS)).rejects.toThrow(/already called/);
  });

  it('refuses a record that is not in this workspace', async () => {
    await expect(rename(NOW, { id: requestId + 9999 })).rejects.toThrow(/No request #/);
  });

  it('refuses an object type the workspace does not define', async () => {
    await expect(rename(NOW, { objectType: 'spaceship' })).rejects.toThrow(/No object type "spaceship"/);
  });
});

describe('renaming, and putting it back', () => {
  it('is done for you: low-risk and reversible, so a confident rename lands without a gate', async () => {
    const res = await rename(NOW);

    expect(res.status).toBe('done');
    expect((await readRow()).title).toBe(NOW);
  });

  it('writes the row title and leaves every declared field alone', async () => {
    await rename(NOW);

    const row = await readRow();

    // The record's declared fields are update_meta's business, not this one's.
    expect(row.metadata.kind).toBe('gap');
    expect(row.metadata.state).toBe('triaged');
    // The `title` key in metadata is a different thing from the row's column;
    // this action writes the column only.
    expect(row.metadata.title).toBe(WAS);
  });

  it('trims the name, so a stray space never becomes part of what the work is called', async () => {
    await rename(`  ${NOW}  `);

    expect((await readRow()).title).toBe(NOW);
  });

  it('carries the old name on the run, and Undo puts it back exactly', async () => {
    const res = await rename(NOW);

    expect((res.result as { previousTitle: string }).previousTitle).toBe(WAS);

    const undone = await undoAction(res.runId, ORG, { by: 'user_chris' });

    expect(undone.status).toBe('undone');
    expect((await readRow()).title).toBe(WAS);
  });
});

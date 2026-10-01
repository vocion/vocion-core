/**
 * Work on a request stays on it (2026-10-01, FE-322: "write a corrected
 * contract" was filed as a new request when the work was another attempt at
 * FE-314's own build). When the duplicate check links a new filing as work on
 * a request, intake builds THAT request again with the filing's words as the
 * note — as the person's own start when a person asked. Every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const finding = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock('@/services/objects/duplicateCheck', async original => ({
  ...(await original<typeof import('@/services/objects/duplicateCheck')>()),
  checkNewRecordForDuplicate: vi.fn(async () => finding.value),
}));
const proposed = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/services/ActionService', async original => ({
  ...(await original<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async (input: Record<string, unknown>) => {
    proposed.push(input);
    return { runId: 901, status: 'done', outcome: 'created' };
  }),
}));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const carry = await import('./carry');

const ORG = 'org_factory_work_on';
const types: Record<string, number> = {};

beforeAll(async () => {
  for (const slug of ['request', 'engineering_task', 'architecture_plan', 'repo']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
});

async function request(title: string, meta: Record<string, unknown> = {}) {
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title, metadata: { kind: 'bug', state: 'new', product: 'rooms', outcome: 'x', acceptance: ['y'], ...meta } }).returning();
  return row!;
}

describe('a filing that is work on a request', () => {
  it('builds that request again as the person who asked, with the filing\'s words as the note', async () => {
    const build = await request('Fix the rooms image build', { state: 'building' });
    const contract = await request('Write a corrected contract with the right repository', { body: 'The worker refused the contract: the repository URL was wrong.' });
    const [conversation] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'product-manager', title: 'unblock', createdBy: 'user-dana' } as never).returning();
    await db.insert(conversationMessageSchema).values({ conversationId: conversation!.id, role: 'user', content: 'can we unblock and get this done?' } as never);
    finding.value = { checked: true, did: 'linked', duplicateOf: build.id, relation: 'work_on', confidence: 0.92, reason: 'Another attempt at that build.', linked: true, runId: 55, line: `Work on #${build.id} (Fix the rooms image build), so it was linked as its duplicate and the work stays there: Another attempt at that build. Undo on #${contract.id} reopens it.` };

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: contract.id, conversationId: conversation!.id, byPerson: true });

    expect(out.did).toBe('duplicate:linked:work_on:done');
    expect(out.line).toMatch(/and the work stays there: .* Building [A-Z]{2,5}-\d+ again, with this as its note\.$/);
    expect(out.duplicate).toMatchObject({ of: build.id, relation: 'work_on' });
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      actionId: 'factory.dispatch_task',
      input: { requestId: build.id, note: 'Write a corrected contract with the right repository — The worker refused the contract: the repository URL was wrong.' },
      principal: { kind: 'user', id: 'user-dana' },
      invokedBy: 'user-dana',
    });
  });
});

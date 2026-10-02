/**
 * The intake reads whether a filed request repeats one on file before it
 * builds anything (#265/#268, 2026-09-30), against PGlite with the classifier
 * faked: a linked duplicate starts nothing and says why on the request; one
 * the model does not call a duplicate is carried on as before. Every name is
 * invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const answer = vi.hoisted(() => ({ args: null as unknown }));
vi.mock('@/libs/llm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildChatModelForOrg: vi.fn(async () => ({ bindTools: () => ({ invoke: async () => ({ tool_calls: [{ name: 'report_duplicate', args: answer.args }] }) }) })),
  };
});

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const carry = await import('./carry');

const ORG = 'org_factory_carry_duplicate';
let requestType = 0;

beforeAll(async () => {
  const [t] = await createObjectType({
    slug: 'request',
    label: 'Request',
    schema: {
      'type': 'object',
      'x-duplicate-check': { field: 'duplicateOf', within: ['product'], compare: ['outcome'] },
      'properties': { product: { type: 'string' }, outcome: { type: 'string' }, duplicateOf: { type: 'integer' }, state: { type: 'string' } },
    },
  } as never, ORG);
  requestType = t!.id;
});

async function request(title: string, meta: Record<string, unknown>) {
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: requestType,
    title,
    metadata: { kind: 'bug', severity: 'p1', state: 'new', acceptance: ['An invited member opens the room from the email link.'], ...meta },
  }).returning();
  return row!;
}

async function meta(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

describe('intake reads for a duplicate first', () => {
  it('links a request that repeats one on file and starts nothing for it', async () => {
    const first = await request('An invited member cannot open the room', { product: 'rooms', outcome: 'An invited member opens the room.' });
    const again = await request('Invited people cannot get into the room', { product: 'rooms', outcome: 'People invited by email open the room.' });
    answer.args = { duplicateOf: first.id, confidence: 0.94, reason: 'Both ask that an invited member can open the room.' };

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: again.id, conversationId: 12, byPerson: true });

    expect(out.did).toBe('duplicate:linked');
    expect(out.line).toContain(`Same as #${first.id}`);

    const m = await meta(again.id);

    expect(m.duplicateOf).toBe(first.id);
    expect((m.recovery as { log: Array<{ text: string }> }).log.at(-1)?.text).toBe(out.line);

    const dispatches = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.actionId, 'factory.dispatch_task')));

    expect(dispatches).toHaveLength(0);

    // The sweep and a second intake leave it closed.
    expect((await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: again.id, conversationId: 12, byPerson: true })).did).toBe('not an open request');
  });

  it('carries on as before when the model finds no duplicate', async () => {
    await request('Export a room as a PDF', { product: 'exports', outcome: 'A room exports as a PDF.' });
    const other = await request('Export a room as a spreadsheet', { product: 'exports', outcome: 'A room exports as a spreadsheet.' });
    answer.args = { duplicateOf: null, confidence: 0.9, reason: 'Different formats.' };

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: other.id, conversationId: 12, byPerson: true });

    expect(out.did.startsWith('duplicate')).toBe(false);
    expect((await meta(other.id)).duplicateOf).toBeUndefined();
  });
});

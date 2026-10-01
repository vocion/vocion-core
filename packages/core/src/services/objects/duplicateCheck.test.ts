/**
 * The same ask twice (backlog 044), against PGlite: a record filed is read
 * against its type's records by a model with a typed answer; sure at the bar,
 * the link is written done for you with Undo; below it, nothing is written or
 * said; a failed read, an id the model was not shown, or a link a person undid
 * leave the record as filed. Every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { eq } = await import('drizzle-orm');
const dup = await import('./duplicateCheck');

const ORG = 'org_duplicate_check';
const SPEC = { field: 'duplicateOf', within: ['product'], compare: ['outcome'], bar: 0.8, settledDays: 14 };
const SCHEMA = {
  'type': 'object',
  'x-settled': { field: 'state', in: ['shipped', 'answered'] },
  'x-duplicate-check': SPEC,
  'x-owner': 'product-manager',
  'properties': { product: { type: 'string' }, outcome: { type: 'string' }, state: { type: 'string' }, duplicateOf: { type: 'integer' } },
};
let typeId = 0;
let plainTypeId = 0;

beforeAll(async () => {
  const [t] = await createObjectType({ slug: 'ask', label: 'Ask', schema: SCHEMA } as never, ORG);
  typeId = t!.id;
  const [p] = await createObjectType({ slug: 'note', label: 'Note', schema: { type: 'object', properties: {} } } as never, ORG);
  plainTypeId = p!.id;
});

async function record(title: string, meta: Record<string, unknown>, extra: { status?: string; updatedAt?: Date; typeId?: number } = {}) {
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: extra.typeId ?? typeId, title, metadata: meta, ...(extra.status ? { status: extra.status } : {}) }).returning();
  if (extra.updatedAt) {
    await db.update(businessObjectSchema).set({ updatedAt: extra.updatedAt }).where(eq(businessObjectSchema.id, row!.id));
  }
  return row!;
}

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

/**
 * A model that answers through the tool with `args`, and records what it read.
 * @param args - The typed answer.
 */
function model(args: unknown) {
  const seen: string[] = [];
  const invoke = vi.fn(async (messages: Array<{ content: unknown }>) => {
    seen.push(String(messages[1]?.content ?? ''));
    return { tool_calls: [{ name: 'report_duplicate', args }] };
  });
  const bindTools = vi.fn(() => ({ invoke }));
  return { m: { bindTools } as never, bindTools, invoke, seen };
}

describe('duplicateCheckOf', () => {
  it('reads the descriptor with its defaults, and nothing from a type that declares none', () => {
    expect(dup.duplicateCheckOf({ 'x-duplicate-check': { field: 'duplicateOf' } })).toEqual({ field: 'duplicateOf', within: [], compare: [], bar: 0.8, settledDays: 14 });
    expect(dup.duplicateCheckOf({ 'x-duplicate-check': SPEC })).toEqual(SPEC);
    expect(dup.duplicateCheckOf({ 'x-duplicate-check': { within: ['product'] } })).toBeNull();
    expect(dup.duplicateCheckOf({ type: 'object' })).toBeNull();
    expect(dup.duplicateCheckOf(null)).toBeNull();
  });
});

describe('shortlistDuplicates', () => {
  it('puts the textually close first, and still reads the newest that share no words', () => {
    const candidates = [
      { id: 9, title: 'Weekly digest email', text: '', settled: null },
      { id: 8, title: 'Guests reach a space they were asked into', text: '', settled: null },
      { id: 7, title: 'Invited member cannot open the room', text: 'An invited member opens the room', settled: 'shipped' },
    ];
    const list = dup.shortlistDuplicates({ title: 'Invited member cannot open the room', text: '' }, candidates, 2);

    expect(list.map(c => c.id)).toEqual([7, 9]);
  });
});

describe('checkNewRecordForDuplicate', () => {
  it('links a record the model is sure repeats one on file, done for you, and says so in one line', async () => {
    const first = await record('An invited member cannot open the room', { product: 'rooms', outcome: 'An invited member opens the room from the email.' });
    const otherProduct = await record('An invited member cannot open the room', { product: 'fleet', outcome: 'x' });
    const dismissed = await record('Invite link broken', { product: 'rooms' }, { status: 'rejected' });
    const oldShipped = await record('Invites fail', { product: 'rooms', state: 'shipped' }, { updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60_000) });
    const again = await record('Invited people get an error opening the room', { product: 'rooms', outcome: 'People invited by email open the room.' });
    const { m, seen } = model({ duplicateOf: first.id, confidence: 0.93, reason: 'Both ask that an invited member can open the room from the email.' });

    const out = await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id, conversationId: 77, byPerson: true }, { model: m });

    expect(out).toMatchObject({ checked: true, linked: true, duplicateOf: first.id, confidence: 0.93, did: 'linked' });
    expect(out.line).toContain(`Same as #${first.id}`);
    expect(out.line).toContain('Undo');
    expect((await read(again.id)).duplicateOf).toBe(first.id);
    // The judge read only what could be the same ask.
    expect(seen[0]).toContain(`#${first.id} (open)`);

    for (const id of [otherProduct.id, dismissed.id, oldShipped.id]) {
      expect(seen[0]).not.toContain(`#${id} `);
    }
    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId!));

    expect(run).toMatchObject({ actionId: 'objects.update_meta', status: 'done' });
    expect((run!.proposal as Record<string, unknown>).origin).toMatchObject({ conversationId: 77 });

    // The status line reads it, with Undo, and asks nothing of anyone.
    const status = await dup.withDuplicateFact(ORG, { record: { id: again.id, objectType: 'ask', title: again.title, href: '/x' }, stage: { key: 'asked', label: 'Asked', tone: 'info' }, you: { needsYou: true, line: 'Needs you: Build', why: null, move: { label: 'Build', href: '/x' } }, live: null, next: 'Build it', readAt: new Date().toISOString() });

    expect(status.stage).toEqual({ key: 'duplicate', label: expect.stringMatching(new RegExp(`^Duplicate of [A-Z]{2,5}-${first.id}$`)), tone: 'muted' });
    expect(status.you).toMatchObject({ needsYou: false, move: null });
    expect(status.next).toBeNull();
    expect(status.duplicate).toMatchObject({ of: { id: first.id, title: first.title }, undoRunId: out.runId, confidence: 0.93 });

    // A second read of the same record does nothing: it is already linked.
    expect((await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id }, { model: m })).did).toBe('already linked');
  });

  it('writes nothing and says nothing below the bar', async () => {
    const first = await record('Export a room as a PDF', { product: 'exports', outcome: 'A room exports as a PDF.' });
    const next = await record('Export a room as a spreadsheet', { product: 'exports', outcome: 'A room exports as a spreadsheet.' });
    const { m } = model({ duplicateOf: first.id, confidence: 0.55, reason: 'Both export a room, in different formats.' });

    const out = await dup.checkNewRecordForDuplicate(ORG, { objectId: next.id }, { model: m });

    expect(out).toMatchObject({ checked: true, linked: false, duplicateOf: first.id, did: 'below the bar', line: null, runId: null });
    expect((await read(next.id)).duplicateOf).toBeUndefined();
  });

  it('never links to a record the model was not shown, and leaves the record as filed when the read fails', async () => {
    await record('Dark mode', { product: 'themes' });
    const next = await record('A dark theme', { product: 'themes' });

    const invented = await dup.checkNewRecordForDuplicate(ORG, { objectId: next.id }, { model: model({ duplicateOf: 999_999, confidence: 0.99, reason: 'x' }).m });

    expect(invented).toMatchObject({ linked: false, duplicateOf: null, did: 'named a record it was not shown' });

    const broken = { bindTools: () => ({ invoke: async () => {
      throw new Error('model unavailable');
    } }) } as never;

    expect(await dup.checkNewRecordForDuplicate(ORG, { objectId: next.id }, { model: broken })).toMatchObject({ checked: false, did: 'the read failed', linked: false });
    expect((await read(next.id)).duplicateOf).toBeUndefined();
  });

  it('does not judge a link again once a person has undone it', async () => {
    const { undoAction } = await import('@/services/ActionService');
    const first = await record('Rename a room', { product: 'naming', outcome: 'A room can be renamed.' });
    const next = await record('Let owners rename rooms', { product: 'naming', outcome: 'Owners rename a room.' });
    const linked = await dup.checkNewRecordForDuplicate(ORG, { objectId: next.id }, { model: model({ duplicateOf: first.id, confidence: 0.9, reason: 'Same rename.' }).m });

    expect(linked.linked).toBe(true);

    await undoAction(linked.runId!, ORG, { by: 'usr_person' });

    expect((await read(next.id)).duplicateOf).toBeUndefined();
    expect(await dup.duplicateFactOf(ORG, next.id)).toBeNull();

    const { m, invoke } = model({ duplicateOf: first.id, confidence: 0.95, reason: 'Same rename.' });

    expect((await dup.checkNewRecordForDuplicate(ORG, { objectId: next.id }, { model: m })).did).toBe('a person undid this link before');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('asks nothing of a type that declares no check, or of a record with nothing to compare', async () => {
    const note = await record('A note', {}, { typeId: plainTypeId });

    expect((await dup.checkNewRecordForDuplicate(ORG, { objectId: note.id })).did).toBe('the type asks for no duplicate check');

    const lonely = await record('The only one of its kind', { product: 'solo' });
    const { m, invoke } = model({ duplicateOf: null, confidence: 0.9, reason: 'x' });

    expect((await dup.checkNewRecordForDuplicate(ORG, { objectId: lonely.id }, { model: m })).did).toBe('nothing on file to compare');
    expect(invoke).not.toHaveBeenCalled();
  });
});

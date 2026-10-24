/**
 * Jev judges duplicates first (ADR 0007), against PGlite with a fake Jev:
 * an exact match links with nothing asked; Jev sure of one links it and the
 * classifier is never asked; Jev sure of none leaves it; unsure, two at the
 * bar or a failure goes to the classifier exactly as without Jev; every judge
 * asked leaves one row; a workspace that has not opted in writes none. Jev
 * reads titles and compared text, shortened, and no ids. Every name is invented.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, projectSchema, recordDuplicateCheckSchema, tenantAccountSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { eq } = await import('drizzle-orm');
const { resetAgentRouteState } = await import('@/services/routing/agentRoute');
const dup = await import('./duplicateCheck');
const jev = await import('./jevDuplicate');

const ORG = 'org_jev_duplicate';
const SCHEMA = {
  'type': 'object',
  'x-settled': { field: 'state', in: ['shipped'] },
  'x-duplicate-check': { field: 'duplicateOf', within: ['product'], compare: ['outcome'], bar: 0.8, settledDays: 14 },
  'properties': { product: { type: 'string' }, outcome: { type: 'string' }, state: { type: 'string' }, duplicateOf: { type: 'integer' } },
};
const GATE = { key: 'ts-test-not-a-key', scope: 'instance' as const };
let typeId = 0;

beforeAll(async () => {
  const [t] = await createObjectType({ slug: 'wish', label: 'Wish', schema: SCHEMA } as never, ORG);
  typeId = t!.id;
});

afterEach(() => {
  resetAgentRouteState();
  vi.unstubAllEnvs();
});

async function record(title: string, meta: Record<string, unknown>) {
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId, title, metadata: meta }).returning();
  return row!;
}

async function metaOf(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

async function rowsFor(objectId: number) {
  return db.select().from(recordDuplicateCheckSchema).where(eq(recordDuplicateCheckSchema.objectId, objectId)).orderBy(recordDuplicateCheckSchema.id);
}

/**
 * A fake System One endpoint answering each question key with `p(key)`.
 * @param p - Key → probability; undefined leaves the key out.
 */
function jevFetch(p: (key: string) => number | undefined) {
  const bodies: Array<{ state: unknown; questions: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { state: unknown; questions: Record<string, unknown> };
    bodies.push(body);
    const answers = Object.fromEntries(Object.keys(body.questions).flatMap(k => (p(k) === undefined ? [] : [[k, { type: 'noul', noul: p(k) }]])));
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 321 } }), { status: 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch, bodies };
}

/**
 * A classifier that answers `args` through the tool.
 * @param args
 */
function model(args: unknown) {
  const invoke = vi.fn(async () => ({ tool_calls: [{ name: 'report_duplicate', args }] }));
  return { m: { bindTools: vi.fn(() => ({ invoke })) } as never, invoke };
}

describe('the pure parts', () => {
  const c = (id: number, title: string, text = '', settled: string | null = null) => ({ id, title, text, settled });

  it('an exact match ignores case, accents, punctuation and spacing — and needs the details to match too', () => {
    expect(jev.exactDuplicate({ title: 'Café  export, please!', text: 'CSV' }, [c(1, 'cafe export please', 'csv')])?.id).toBe(1);
    expect(jev.exactDuplicate({ title: 'Cafe export', text: 'CSV' }, [c(1, 'Cafe export', 'PDF')])).toBeNull();
    expect(jev.exactDuplicate({ title: '!!', text: '' }, [c(1, '??')])).toBeNull();
  });

  it('asks one yes/no per record, shortened, with no ids and only open or closed', () => {
    const q = jev.duplicateQuestions('Wish', { title: 'T'.repeat(500), text: 'x'.repeat(5_000) }, [c(41, 'Old', 'y'.repeat(900), 'shipped'), c(40, 'Other')]);

    expect(Object.keys(q.questions)).toEqual(['c0', 'c1']);
    expect(q.state.new_record.title.length).toBe(200);
    expect(q.state.new_record.details.length).toBe(1_000);

    const first = q.questions.c0!.instructions as { existing_record: { details: string; status: string } };

    expect(first.existing_record.details.length).toBe(400);
    expect(first.existing_record.status).toBe('closed');
    expect(JSON.stringify(q)).not.toMatch(/41|40|shipped/);
  });

  it('code decides on the probabilities', () => {
    const list = [c(1, 'a'), c(2, 'b'), c(3, 'c')];

    expect(jev.readJevDuplicate({ c0: 0.1, c1: 0.93, c2: 0.2 }, list, 0.8)).toMatchObject({ verdict: 'duplicate', p: 0.93, match: { id: 2 } });
    expect(jev.readJevDuplicate({ c0: 0.1, c1: 0.3, c2: 0.05 }, list, 0.8)).toMatchObject({ verdict: 'not_duplicate', p: 0.7 });
    expect(jev.readJevDuplicate({ c0: 0.1, c1: 0.6, c2: 0.05 }, list, 0.8)).toMatchObject({ verdict: 'unsure', why: 'unsure' });
    expect(jev.readJevDuplicate({ c0: 0.85, c1: 0.9, c2: 0.05 }, list, 0.8)).toMatchObject({ verdict: 'unsure', why: 'more than one at the bar' });
    expect(jev.readJevDuplicate({ c0: 0.1, c1: 0.1 }, list, 0.8)).toMatchObject({ verdict: 'unsure', why: 'not every record answered' });
  });
});

describe('checkNewRecordForDuplicate with Jev', () => {
  it('an exact match links with Undo and asks no one', async () => {
    const first = await record('Export the weekly report', { product: 'exact', outcome: 'As a CSV' });
    const again = await record('Export the weekly report.', { product: 'exact', outcome: 'as a csv' });
    const j = jevFetch(() => 0.5);
    const cls = model({ duplicateOf: null, confidence: 0.9, reason: 'none' });
    const f = await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id }, { model: cls.m, jev: GATE, jevDeps: { fetch: j.fetch } });

    expect(f).toMatchObject({ linked: true, duplicateOf: first.id });
    expect(j.calls).not.toHaveBeenCalled();
    expect(cls.invoke).not.toHaveBeenCalled();
    expect(await rowsFor(again.id)).toMatchObject([{ judge: 'exact', verdict: 'duplicate', duplicateOf: first.id, confidence: 1, linked: true }]);
  });

  it('Jev sure of one links it, and the classifier is never asked', async () => {
    const first = await record('Guests cannot open a shared room', { product: 'sure', outcome: 'An invited guest opens it' });
    await record('Weekly digest email', { product: 'sure', outcome: 'Mondays' });
    const again = await record('Invited people get an error on the room link', { product: 'sure', outcome: 'They see it' });
    const j = jevFetch(() => undefined);
    // c-keys follow the shortlist; answer the first record high, the rest low.
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      const qs = (JSON.parse(init.body) as { questions: Record<string, { instructions: { existing_record: { title: string } } }> }).questions;
      const answers = Object.fromEntries(Object.entries(qs).map(([k, v]) => [k, { type: 'noul', noul: v.instructions.existing_record.title.startsWith('Guests') ? 0.94 : 0.04 }]));
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 200 } }), { status: 200 });
    });
    const cls = model({ duplicateOf: null, confidence: 0.9, reason: 'none' });
    const f = await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id }, { model: cls.m, jev: GATE, jevDeps: { fetch: fetch as never } });

    expect(f).toMatchObject({ linked: true, duplicateOf: first.id, confidence: 0.94 });
    expect(f.line).toContain('Undo');
    expect(cls.invoke).not.toHaveBeenCalled();
    expect((await metaOf(again.id)).duplicateOf).toBe(first.id);
    expect(await rowsFor(again.id)).toMatchObject([{ judge: 'jev', verdict: 'duplicate', duplicateOf: first.id, model: 'jev-1.13.0', keyScope: 'instance', provider: 'typesafe', inputTokens: 200, candidates: 2, linked: true }]);
    expect(j.calls).not.toHaveBeenCalled();
  });

  it('Jev sure of none leaves it as filed, with the classifier never asked', async () => {
    await record('Dark mode', { product: 'none', outcome: 'Dark theme' });
    const again = await record('Bulk delete', { product: 'none', outcome: 'Delete many' });
    const j = jevFetch(() => 0.05);
    const cls = model({ duplicateOf: null, confidence: 0.9, reason: 'none' });
    const f = await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id }, { model: cls.m, jev: GATE, jevDeps: { fetch: j.fetch } });

    expect(f).toMatchObject({ checked: true, linked: false, duplicateOf: null, did: 'not a duplicate' });
    expect(cls.invoke).not.toHaveBeenCalled();
    expect(await rowsFor(again.id)).toMatchObject([{ judge: 'jev', verdict: 'not_duplicate', linked: false }]);
  });

  it('unsure goes to the classifier, which decides exactly as without Jev', async () => {
    const first = await record('Faster search', { product: 'unsure', outcome: 'Results in a second' });
    const again = await record('Search is slow', { product: 'unsure', outcome: 'It takes ages' });
    const j = jevFetch(() => 0.55);
    const cls = model({ duplicateOf: first.id, confidence: 0.9, reason: 'The same slowness.' });
    const f = await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id }, { model: cls.m, jev: GATE, jevDeps: { fetch: j.fetch } });

    expect(f).toMatchObject({ linked: true, duplicateOf: first.id, reason: 'The same slowness.' });
    expect(cls.invoke).toHaveBeenCalledTimes(1);
    expect(await rowsFor(again.id)).toMatchObject([
      { judge: 'jev', verdict: 'unsure', confidence: 0.55, fallback: 'unsure', linked: false },
      { judge: 'model', verdict: 'duplicate', duplicateOf: first.id, fallback: 'jev: unsure', linked: true },
    ]);
  });

  it('a Jev failure goes to the classifier, and three in a row stop asking Jev for a while', async () => {
    const failing = vi.fn(async () => new Response('no', { status: 503 }));
    for (const n of [1, 2, 3, 4]) {
      await record(`Old ${n}`, { product: `fail${n}`, outcome: 'x' });
      const again = await record(`New ${n}`, { product: `fail${n}`, outcome: 'y' });
      const cls = model({ duplicateOf: null, confidence: 0.9, reason: 'none' });
      const f = await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id }, { model: cls.m, jev: GATE, jevDeps: { fetch: failing as never } });

      expect(f).toMatchObject({ checked: true, linked: false, did: 'not a duplicate' });
      expect(cls.invoke).toHaveBeenCalledTimes(1);

      const rows = await rowsFor(again.id);

      expect(rows.map(r => [r.judge, r.verdict])).toEqual([['jev', 'failed'], ['model', 'not_duplicate']]);

      if (n === 4) {
        expect(rows[0]!.fallback).toBe('breaker open');
      }
    }

    expect(failing).toHaveBeenCalledTimes(3);
  });

  it('without the opt-in nothing changes: the classifier alone, and no row', async () => {
    const first = await record('Print view', { product: 'off', outcome: 'Printable' });
    const again = await record('Print view', { product: 'off', outcome: 'Printable' });
    const cls = model({ duplicateOf: first.id, confidence: 0.95, reason: 'Same.' });
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-test-not-a-key');
    const f = await dup.checkNewRecordForDuplicate(ORG, { objectId: again.id }, { model: cls.m });

    expect(f).toMatchObject({ linked: true, duplicateOf: first.id });
    expect(cls.invoke).toHaveBeenCalledTimes(1);
    expect(await rowsFor(again.id)).toEqual([]);
  });
});

describe('jevDuplicateGate', () => {
  it('needs both the workspace opt-in and a key', async () => {
    await db.insert(tenantAccountSchema).values({ id: 'acct_jev_dup', name: 'Jev dup', slug: 'jev-dup' });
    await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_jev_dup', slug: 'jev-dup', name: 'Jev dup' });
    vi.stubEnv('TYPESAFE_API_KEY', '');

    expect(await jev.jevDuplicateGate(ORG)).toBeNull();

    vi.stubEnv('TYPESAFE_API_KEY', 'ts-test-not-a-key');

    expect(await jev.jevDuplicateGate(ORG)).toBeNull();

    await db.update(projectSchema).set({ jev: { duplicateCheck: true } }).where(eq(projectSchema.id, ORG));

    expect(await jev.jevDuplicateGate(ORG)).toEqual({ key: 'ts-test-not-a-key', scope: 'instance' });

    vi.stubEnv('TYPESAFE_API_KEY', '');

    expect(await jev.jevDuplicateGate(ORG)).toBeNull();
  });
});

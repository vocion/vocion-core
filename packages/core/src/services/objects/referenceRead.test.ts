/**
 * Which product the person meant is read from their own words (2026-10-01,
 * #294): against PGlite, with the judge's model injected. Every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { candidateOf, correctionLine, judgeText, readReference, referenceFactOf, referenceReadOf } = await import('./referenceRead');

const ORG = 'org_reference_read';
const SPEC = { field: 'product', type: 'product', key: 'slug', describe: ['name', 'aliases', 'tagline'], bar: 0.8 };
let requestType = 0;

beforeAll(async () => {
  const [req] = await createObjectType({ slug: 'request', label: 'Request', schema: { 'type': 'object', 'x-reference-read': SPEC, 'properties': { product: { type: 'string' } } } } as never, ORG);
  requestType = req!.id;
  const [product] = await createObjectType({ slug: 'product', label: 'Product' }, ORG);
  await db.insert(businessObjectSchema).values([
    { orgId: ORG, typeId: product!.id, title: 'HarborSend', metadata: { slug: 'harbor', name: 'HarborSend', aliases: ['Harbor', 'harborsend.example'], tagline: 'Send big files and know when they were opened.' } },
    { orgId: ORG, typeId: product!.id, title: 'Lantern', metadata: { slug: 'lantern', name: 'Lantern', tagline: 'Async video for teams.' } },
  ]);
});

/**
 * A judge that answers what the test says, and records what it was asked.
 * @param answer
 * @param answer.match
 * @param answer.confidence
 * @param answer.quote
 */
function judge(answer: { match: string | null; confidence: number; quote: string }) {
  const asked: string[] = [];
  return {
    asked,
    model: { bindTools: () => ({ invoke: async (messages: Array<{ content: string }>) => {
      asked.push(String(messages[1]!.content));
      return { tool_calls: [{ name: 'report_reference', args: answer }] };
    } }) } as never,
  };
}

async function request(product: string) {
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: requestType, title: 'Show the page count next to the title', metadata: { product } }).returning();
  return row!;
}

async function meta(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!.metadata as Record<string, unknown>;
}

describe('the descriptor and the read', () => {
  it('reads the type\'s x-reference-read, and each candidate with the fields it describes', () => {
    expect(referenceReadOf({ 'x-reference-read': { field: 'product', type: 'product' } })).toMatchObject({ field: 'product', type: 'product', key: 'slug', describe: [] });
    expect(referenceReadOf({})).toBeNull();
    expect(candidateOf({ slug: 'harbor', name: 'HarborSend', aliases: ['Harbor'] }, 'HarborSend', SPEC)).toEqual({ value: 'harbor', title: 'HarborSend', lines: ['name: HarborSend', 'aliases: Harbor'] });
    expect(judgeText({ label: 'Product', words: ['On Harbor\'s document page, show the page count.'], candidates: [{ value: 'harbor', title: 'HarborSend', lines: ['aliases: Harbor'] }] })).toContain('- value: harbor — HarborSend (aliases: Harbor)');
    expect(correctionLine('HarborSend', 'Lantern', 'On Harbor\'s document page')).toBe('Filed under HarborSend, not Lantern: you said "On Harbor\'s document page".');
  });
});

describe('a confident read that disagrees with the filing wins, with Undo', () => {
  it('corrects the product, says so in one line, and the status draws it with its Undo', async () => {
    const r = await request('lantern');
    const j = judge({ match: 'harbor', confidence: 0.95, quote: 'On Harbor\'s document page' });

    const out = await readReference(ORG, { objectId: r.id, byPerson: true }, { model: j.model, words: ['On Harbor\'s document page, show how many pages the document has.'] });

    expect(out).toMatchObject({ corrected: true, from: 'lantern', to: 'harbor', line: 'Filed under HarborSend, not Lantern: you said "On Harbor\'s document page". Undo puts it back.' });
    expect(j.asked[0]).toContain('> On Harbor\'s document page');
    expect((await meta(r.id)).product).toBe('harbor');
    expect(await referenceFactOf(ORG, r.id)).toEqual({ line: 'Filed under HarborSend, not Lantern: you said "On Harbor\'s document page".', undoRunId: out.runId });

    // Read once: a second pass asks nothing.
    const again = await readReference(ORG, { objectId: r.id, byPerson: true }, { model: j.model, words: ['x'] });

    expect(again.did).toBe('already read');
    expect(j.asked).toHaveLength(1);
  });

  it('a correction a person undid is not made again', async () => {
    const r = await request('lantern');
    const first = await readReference(ORG, { objectId: r.id }, { model: judge({ match: 'harbor', confidence: 0.95, quote: 'Harbor' }).model, words: ['Harbor please'] });
    await db.update(actionRunSchema).set({ status: 'undone' }).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.id, first.runId!)));

    expect((await readReference(ORG, { objectId: r.id }, { model: judge({ match: 'harbor', confidence: 0.95, quote: 'Harbor' }).model, words: ['Harbor please'] })).did).toBe('a person undid a correction before');
    expect(await referenceFactOf(ORG, r.id)).toBeNull();
  });
});

describe('nothing is written when the read does not settle it', () => {
  it('agrees, is below the bar, names a record it was not shown, or has no person\'s words', async () => {
    const r = await request('lantern');

    expect((await readReference(ORG, { objectId: r.id }, { model: judge({ match: 'lantern', confidence: 0.9, quote: 'Lantern' }).model, words: ['Lantern'] })).did).toBe('agrees');
    expect((await readReference(ORG, { objectId: r.id }, { model: judge({ match: 'harbor', confidence: 0.6, quote: '' }).model, words: ['the document page'] })).did).toBe('below the bar');
    expect((await readReference(ORG, { objectId: r.id }, { model: judge({ match: 'kestrel', confidence: 0.99, quote: 'Kestrel' }).model, words: ['Kestrel'] })).did).toBe('named a record it was not shown');
    expect((await readReference(ORG, { objectId: r.id }, { model: judge({ match: 'harbor', confidence: 0.99, quote: 'Harbor' }).model })).did).toBe('no words of a person to read');
    expect((await meta(r.id)).product).toBe('lantern');
  });
});

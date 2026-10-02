/**
 * What filing started, for the filing's own answer (run 2, 2026-10-01): the
 * PM answered "Here's the dispatch card" about a build intake had already
 * started as the person's action. The filing now waits briefly for intake's
 * typed mark and says what it did. Against PGlite. Every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { automationSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { filingReceipt } = await import('./carry');

const ORG = 'org_filing_receipt';
const QUIET = 'org_filing_receipt_no_intake';
let requestType = 0;

beforeAll(async () => {
  const [req] = await createObjectType({ slug: 'request', label: 'Request' }, ORG);
  requestType = req!.id;
  await createObjectType({ slug: 'request', label: 'Request' }, QUIET);
  await db.insert(automationSchema).values({ orgId: ORG, slug: 'factory-request-filed', name: 'A request was filed', status: 'active', whenConfig: { event: 'object.created', filter: { objectType: 'request' } }, doConfig: { job: 'factory-intake' }, ownerAgentSlug: 'product-manager' } as never);
});

async function request(meta: Record<string, unknown>) {
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: requestType, title: 'Show the view count next to the title', metadata: meta }).returning();
  return row!.id;
}

describe('the filing says what intake did', () => {
  it('a started build is said as started, with what the request says, and no card to offer', async () => {
    const id = await request({
      intake: { at: '2026-10-01T14:00:25.564Z', tries: 1, outcome: 'started' },
      recovery: { log: [
        { at: '2026-10-01T14:00:25.564Z', text: 'Filed and started: you asked for it. Undo cancels it until a worker claims it.' },
        { at: '2026-10-01T14:00:26.431Z', text: 'Planning first: the allowed paths span 3 packages.' },
      ] },
    });

    const said = await filingReceipt(ORG, { objectType: 'request', id }, 1_000, 0);

    expect(said).toContain('the build started as the person\'s own action');
    expect(said).toContain('"Planning first: the allowed paths span 3 packages."');
    expect(said).toContain('There is no card and nothing is left to dispatch or confirm');
  });

  it('a card, a hold and a blocker are each said as what they are', async () => {
    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({ intake: { at: 'x', tries: 1, outcome: 'card' } }) }, 1_000, 0)).toMatch(/^The build did not start on its own: a Build card is waiting/);
    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({ intake: { at: 'x', tries: 1, outcome: 'held' } }) }, 1_000, 0)).toMatch(/^Held, as the person asked/);
    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({ intake: { at: 'x', tries: 1, outcome: 'blocked', why: 'the product lists no repo' } }) }, 1_000, 0)).toMatch(/^The build could not start yet: the product lists no repo\./);
  });

  it('says nothing when intake has not marked it in time, when the type is not the factory\'s request, or when nothing here runs intake', async () => {
    const t0 = Date.now();

    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({}) }, 600, 0)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(await filingReceipt(ORG, { objectType: 'engineering_task', id: 1 })).toBeNull();
    expect(await filingReceipt(QUIET, { objectType: 'request', id: 1 })).toBeNull();
  });
});

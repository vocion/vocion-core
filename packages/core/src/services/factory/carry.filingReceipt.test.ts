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
const { doneMeans, filedLine, filingReceipt } = await import('./carry');

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

    const said = await filingReceipt(ORG, { objectType: 'request', id }, { name: 'FE-9', href: '/w/acme/dashboard/p/feature/9' }, 1_000, 0);

    expect(said).toMatch(/^Reply to the person with this message, as written/);
    expect(said).toContain('On it: filed as [FE-9](/w/acme/dashboard/p/feature/9), and the build has started.');
    expect(said).toContain('No merge approval is needed');
    expect(said).toContain('"Planning first: the allowed paths span 3 packages."');
  });

  it('a card, a hold and a blocker are each said as what they are', async () => {
    const shown = { name: 'FE-9', href: null };

    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({ intake: { at: 'x', tries: 1, outcome: 'card' } }) }, shown, 1_000, 0)).toContain('Filed as FE-9. It waits on you to start it');
    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({ intake: { at: 'x', tries: 1, outcome: 'held' } }) }, shown, 1_000, 0)).toContain('Filed as FE-9 and held, as you asked');
    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({ intake: { at: 'x', tries: 1, outcome: 'blocked', why: 'the product lists no repo' } }) }, shown, 1_000, 0)).toContain('Filed as FE-9, but the build could not start yet: the product lists no repo.');
  });

  it('says nothing when intake has not marked it in time, when the type is not the factory\'s request, or when nothing here runs intake', async () => {
    const t0 = Date.now();

    expect(await filingReceipt(ORG, { objectType: 'request', id: await request({}) }, undefined, 600, 0)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(await filingReceipt(ORG, { objectType: 'engineering_task', id: 1 })).toBeNull();
    expect(await filingReceipt(QUIET, { objectType: 'request', id: 1 })).toBeNull();
  });
});

describe('the filing reply a person reads (Chris, 2026-10-06)', () => {
  const acceptance = [
    { statement: 'Each document row shows "Opened by N" under its title, where N is the number of distinct viewers other than the owner.' },
    { statement: 'The same viewer opening twice adds one to N; a named viewer is one person across devices.' },
    'The owner\'s own opens never count: a document opened only by its owner reads "Not opened".',
    'It is on every plan.',
  ];

  it('says it started, links it, says what done means in three short lines, and what comes next', () => {
    expect(filedLine('started', { name: 'FE-478', href: '/w/sq/dashboard/p/feature/478', acceptance, mergeHeld: false })).toBe([
      'On it: filed as [FE-478](/w/sq/dashboard/p/feature/478), and the build has started.',
      '',
      '**Done means:**',
      '- Each document row shows "Opened by N" under its title, where N is the number of distinct viewers other…',
      '- The same viewer opening twice adds one to N',
      '- The owner\'s own opens never count',
      '- …and 1 more on the feature page',
      '',
      'I\'ll update you here if it\'s blocked, and when it\'s live in production and ready to review. No merge approval is needed: it goes to production once QA passes.',
    ].join('\n'));
  });

  it('promises a merge update only for a product that holds merges for a person', () => {
    expect(filedLine('planning', { name: 'FE-1', href: null, acceptance: [], mergeHeld: true })).toBe('On it: filed as FE-1, and the build has started with a plan.\n\nI\'ll update you here if it\'s blocked, when the merge needs your approval, and when it\'s live in production and ready to review.');
  });

  it('reads plain strings and statements alike, and nothing from what is not a list', () => {
    expect(doneMeans(['One.', { statement: 'Two; more.' }, { other: 1 }, ''])).toEqual({ lines: ['One', 'Two'], more: 0 });
    expect(doneMeans(null)).toEqual({ lines: [], more: 0 });
  });
});

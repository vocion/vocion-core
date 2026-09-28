import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/objects/recordHref', () => ({
  recordLinksForOrg: async () => ({ pages: new Map([['request', '/dashboard/p/feature/{id}']]), workspaceSlug: 'kestrel' }),
}));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { recordMentionLinks } = await import('./recordMentionLinks');

const ORG = 'org_mention_links';

async function record(slug: string, label: string, title: string): Promise<number> {
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug, label }).returning({ id: businessObjectTypeSchema.id });
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title, metadata: {} } as never).returning({ id: businessObjectSchema.id });
  return row!.id;
}

describe('the answer\'s record mentions, resolved against the workspace', () => {
  it('links a real request by #id, by its type and by its page name; leaves a wrong kind and a missing id alone', async () => {
    const req = await record('request', 'Request', 'Link expiry');
    const deal = await record('deal', 'Deal', 'Northwind renewal');
    // Ids this small are ranks as often as records; pad the text to real ids.
    const text = `Build #${req} next (request ${req}, feature ${req}). Deal ${req} is not a deal; deal ${deal} is. #999999 does not exist.`;

    const links = await recordMentionLinks(ORG, text);
    const byText = Object.fromEntries(links.map(l => [l.text, l.href]));
    const feature = `/w/kestrel/dashboard/p/feature/${req}`;

    expect(byText[`request ${req}`]).toBe(feature);
    expect(byText[`feature ${req}`]).toBe(feature);
    expect(byText[`Deal ${req}`]).toBeUndefined();
    expect(byText[`deal ${deal}`]).toBe(`/w/kestrel/dashboard/objects/${deal}`);
    expect(byText['#999999']).toBeUndefined();
    // A bare #id below ten is left alone (a rank more often than a record).
    expect(byText[`#${req}`]).toBe(req >= 10 ? feature : undefined);
  });

  it('says nothing, and throws nothing, for an answer with no numbers', async () => {
    expect(await recordMentionLinks(ORG, 'Nothing to link here.')).toEqual([]);
  });
});

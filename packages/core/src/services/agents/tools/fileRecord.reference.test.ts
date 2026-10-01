/**
 * A request is born under the product the person named (2026-10-01, run 2).
 *
 * FE-294 and FE-298 were filed under Slate when the person said "Stamp's
 * document page"; the read after filing moved the product, but the story kept
 * "shared via Slate". file_request now reads the person's words before it
 * writes: a confident read naming another product files nothing yet and tells
 * the filer which, so its next call writes the record, story and all, under
 * the right one. Against PGlite, the real plugin request type, and an injected
 * judge. Every name is invented.
 */
import type { RuntimeContext } from '../types';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from '@/libs/workspace/loader';

vi.mock('@/libs/DB');

const verdict = vi.hoisted(() => ({ current: { match: null as string | null, confidence: 0, quote: '' }, asked: [] as string[] }));

vi.mock('@/libs/llm', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    buildChatModelForOrg: async () => ({
      bindTools: () => ({
        invoke: async (messages: Array<{ content: string }>) => {
          verdict.asked.push(String(messages[1]?.content ?? ''));
          return { tool_calls: [{ name: 'report_reference', args: verdict.current }] };
        },
      }),
    }),
  };
});
vi.mock('@/services/budget/chargeModelCall', () => ({ chargeModelCall: async () => undefined }));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, conversationMessageSchema, conversationSchema, trustRuleSchema } = await import('@/models/Schema');
const { and, eq } = await import('drizzle-orm');
const { loadFilingTypes, namesOf } = await import('./fileRecord');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_file_reference';
const dirs: string[] = [];
let conversationId = 0;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-reference-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\nplugins: [software-factory]\n');
  const ot = loadWorkspace(dir).objectTypes.find(t => t.slug === 'request')!;
  await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: ot.label, schema: { ...(ot.schema ?? {}), 'x-gates': ot.gates ?? [] } });
  const [product] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object' } }).returning();
  await db.insert(businessObjectSchema).values([
    { orgId: ORG, typeId: product!.id, title: 'HarborSend', status: 'active', metadata: { slug: 'harbor', name: 'HarborSend', aliases: ['Harbor', 'Harbor Docs'] } },
    { orgId: ORG, typeId: product!.id, title: 'Lantern', status: 'active', metadata: { slug: 'lantern', name: 'Lantern' } },
  ]);
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'objects.propose_candidate.request', threshold: 0.5, enabled: 'true' } as never);
  const [conv] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'product-manager', title: 'View count', createdBy: 'usr_owner' } as never).returning({ id: conversationSchema.id });
  conversationId = conv!.id;
  await db.insert(conversationMessageSchema).values({ conversationId, role: 'user', content: 'On Harbor\'s document page, show how many times the document has been viewed, next to its title.' } as never);
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

const ASK = {
  kind: 'gap',
  outcome: 'A sender sees how many times a document was viewed, beside its title.',
  story: 'As someone who shared a document, I want to see how often it was viewed, so I know it was read.',
  body: 'Show the view count next to the document title.',
  acceptance: [{ statement: 'a' }, { statement: 'b' }, { statement: 'c' }],
  mainRisk: 'Counting views on the public viewer route.',
  visuals: { surfaceUrl: 'https://harbor.example/documents/1' },
  whyNote: 'The document page shows no view count today.',
  gapCheck: { finding: 'add', how: 'The document page shows the title and no count.', checkedAt: '2026-10-01T14:00:00Z', sources: ['https://harbor.example/documents/1'] },
  why: ['user_request'],
  sizeClass: 'minor',
  confidence: 0.9,
  rationale: 'Asked for in chat.',
};

async function fileRequestTool() {
  const filingTypes = await loadFilingTypes(ORG, ['request']);
  const ctx = {
    orgId: ORG,
    userId: 'usr_owner',
    agentSlug: 'product-manager',
    conversationId,
    connectorSources: [],
    objectTypeSlugs: ['request'],
    filingTypes,
    enabledPlugins: ['software-factory'],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    delegations: new Map(),
    emit: () => {},
  } as unknown as RuntimeContext;
  return buildDomainTools(ctx).find(t => t.name === 'file_request')!;
}

async function requestTitled(title: string) {
  const rows = await db
    .select({ metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectTypeSchema.slug, 'request'), eq(businessObjectSchema.title, title)));
  return rows[0]?.metadata as Record<string, unknown> | undefined;
}

describe('the product a filer picks from is named, not a bare slug', () => {
  it('lists each product with what it is called, so the first call is the right one', async () => {
    const filingTypes = await loadFilingTypes(ORG, ['request']);
    const product = filingTypes[0]!.properties.product!;

    expect(product.enum).toEqual(['harbor', 'lantern']);
    expect(product.description).toContain('by slug: harbor (HarborSend, also Harbor Docs), lantern.');
  });

  it('names a record by its title and short names, each once, never its own slug again, and leaves long text out', () => {
    expect(namesOf('send', 'HarborSend', { name: 'HarborSend', aliases: ['Harbor', 'harbor.example'], tagline: 'x'.repeat(80) }, ['name', 'aliases', 'tagline'])).toBe('HarborSend, also Harbor, harbor.example');
    expect(namesOf('lantern', 'Lantern', {}, ['name'])).toBeNull();
    expect(namesOf('slate', 'slate', {}, [])).toBeNull();
  });
});

describe('file_request reads the person\'s words before it writes', () => {
  it('files nothing under the wrong product, says which one they named, and the next call is born right', async () => {
    verdict.current = { match: 'harbor', confidence: 0.95, quote: 'On Harbor\'s document page' };
    const tool = await fileRequestTool();

    const first = String(await tool.invoke({ ...ASK, title: 'View count next to the title', product: 'lantern' }));

    expect(first).toBe('Not filed yet: the person\'s words name HarborSend (product: harbor), not Lantern (lantern), as the one this is for. They said: "On Harbor\'s document page". Call file_request again with product: harbor, and write the title and story for HarborSend. If you are sure they meant another, call it again as it was and it is filed.');
    expect(await requestTitled('View count next to the title')).toBeUndefined();
    expect(verdict.asked.at(-1)).toContain('> On Harbor\'s document page');

    const second = String(await tool.invoke({ ...ASK, title: 'View count next to the title', product: 'harbor' }));

    expect(second).toMatch(/is DONE: filed as [A-Z]{2,5}-\d+/);
    expect(await requestTitled('View count next to the title')).toMatchObject({ product: 'harbor' });
  });

  it('files at once when the read agrees, is unsure, or the filer was already told this turn', async () => {
    verdict.current = { match: 'harbor', confidence: 0.95, quote: 'Harbor' };

    expect(String(await (await fileRequestTool()).invoke({ ...ASK, title: 'Agrees', product: 'harbor' }))).toMatch(/is DONE/);

    verdict.current = { match: 'harbor', confidence: 0.5, quote: '' };

    expect(String(await (await fileRequestTool()).invoke({ ...ASK, title: 'Unsure', product: 'lantern' }))).toMatch(/is DONE/);

    verdict.current = { match: 'harbor', confidence: 0.95, quote: 'Harbor' };
    const tool = await fileRequestTool();

    expect(String(await tool.invoke({ ...ASK, title: 'Insists', product: 'lantern' }))).toMatch(/^Not filed yet/);
    expect(String(await tool.invoke({ ...ASK, title: 'Insists', product: 'lantern' }))).toMatch(/is DONE/);
    expect(await requestTitled('Insists')).toMatchObject({ product: 'lantern' });
  });
});

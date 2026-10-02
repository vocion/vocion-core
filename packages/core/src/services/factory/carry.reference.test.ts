/**
 * #294 end to end, against PGlite (2026-10-01): a person asks about one
 * product, the request is filed under another that has no repo, and intake
 * reads their words, corrects the product with Undo, and starts the build from
 * the right repo. The model is the only thing faked. Every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/agents/turnJudge', async original => ({
  ...(await original<typeof import('@/services/agents/turnJudge')>()),
  saidToDecide: vi.fn(async () => ({ said: false, quote: null })),
}));
const judged = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/libs/llm', async original => ({
  ...(await original<typeof import('@/libs/llm')>()),
  buildChatModelForOrg: vi.fn(async () => ({
    bindTools: () => ({ invoke: async () => {
      judged.calls += 1;
      return { tool_calls: [{ name: 'report_reference', args: { match: 'harbor', confidence: 0.94, quote: 'On Harbor\'s document page' } }] };
    } }),
  })),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, businessObjectSchema, conversationMessageSchema, conversationSchema, trustRuleSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const carry = await import('./carry');

const ORG = 'org_factory_reference';
const types: Record<string, number> = {};

beforeAll(async () => {
  process.env.VOCION_EXTERNAL_WORKERS = '1';
  const [req] = await createObjectType({ slug: 'request', label: 'Request', schema: { 'type': 'object', 'x-reference-read': { field: 'product', type: 'product', key: 'slug', describe: ['name', 'aliases', 'tagline'], bar: 0.8 }, 'properties': { product: { type: 'string' }, state: { type: 'string' } } } } as never, ORG);
  types.request = req!.id;
  for (const slug of ['engineering_task', 'architecture_plan', 'repo', 'product']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: { runsOn: 'external-worker' } } as never);
  await db.insert(businessObjectSchema).values([
    { orgId: ORG, typeId: types.product!, title: 'HarborSend', metadata: { slug: 'harbor', name: 'HarborSend', aliases: ['Harbor'] } },
    { orgId: ORG, typeId: types.product!, title: 'Lantern', metadata: { slug: 'lantern', name: 'Lantern', accountableUser: 'eli@northwind.example' } },
    { orgId: ORG, typeId: types.repo!, title: 'Acme/harbor-app', metadata: { slug: 'harbor-app', product: 'harbor', checks: [{ name: 'test' }], productPaths: { harbor: ['apps/harbor/src/**'] } } },
  ]);
  for (const actionId of ['factory.dispatch_task.from_request', 'factory.dispatch_task.recovery', 'factory.dispatch_task.from_plan']) {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId, threshold: 0.8, enabled: 'true' });
  }
});

describe('the product is read, not guessed (#294)', () => {
  it('filed under the wrong product: corrected from the person\'s words with Undo, then built from the right repo', async () => {
    const [conversation] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'product-manager', title: 'page count', createdBy: 'user-dana' } as never).returning();
    await db.insert(conversationMessageSchema).values({ conversationId: conversation!.id, role: 'user', content: 'On Harbor\'s document page, show how many pages the document has, next to its title.' } as never);
    const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'Show page count next to document title', metadata: { kind: 'gap', state: 'new', product: 'lantern', surface: 'ui', outcome: 'A reader sees how long a document is.', acceptance: ['The document page shows "N pages" beside its title.'] } }).returning();

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r!.id, conversationId: conversation!.id, byPerson: true });

    expect(judged.calls).toBe(1);
    expect(out.did).toMatch(/^start:.*:person$/);

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, r!.id));
    const m = row!.metadata as Record<string, any>;

    expect(m.product).toBe('harbor');
    expect(m.blocker).toBeUndefined();
    expect(m.recovery.log[0].text).toBe('Filed under HarborSend, not Lantern: you said "On Harbor\'s document page". Undo puts it back.');

    const [correction] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.actionId, 'objects.update_meta')));

    expect(correction).toMatchObject({ status: 'done', invokedBy: 'reference-read' });
  });
});

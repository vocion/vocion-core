/**
 * What the agent is told after a choice's bound action runs (#1028).
 *
 * The rule someone could get wrong: the line the agent reads carries the
 * action's own result, so it can name the source slug it reuses next step and
 * say "already existed" instead of claiming it created something. Both real
 * actions land pending (a person's pick is the approval), so these run the
 * decide path.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  apiTokenSchema,
  businessObjectSchema,
  businessObjectTypeSchema,
  conversationMessageSchema,
  conversationSchema,
  knowledgeSourceSchema,
  projectSchema,
  sourceDekSchema,
  tenantAccountSchema,
  userSchema,
} = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { sourceConnectAction } = await import('@/libs/actions/source-connect');
const { objectsCreateGroupAction } = await import('@/libs/actions/objects-create-group');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { sealLoginValues, storeLoginCredential } = await import('@/services/ApiTokenService');
const { answerChoice } = await import('@/services/chat/answerChoice');

const ORG = 'org_bound_results';
const ADMIN = 'user_bound_admin';

registerAction(sourceConnectAction);
registerAction(objectsCreateGroupAction);

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-bound-results', name: 'Northwind', slug: 'northwind-bound' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-bound-results', slug: 'northwind-bound', name: 'Northwind' });
  await db.insert(userSchema).values({ id: ADMIN, email: 'admin@northwind-bound.example' });
  await db.insert(accountMembershipSchema).values({ accountId: 'acct-bound-results', userId: ADMIN, role: 'admin' });
});

afterEach(async () => {
  forgetCachedObjectTypes();
  await db.delete(knowledgeSourceSchema);
  await db.delete(apiTokenSchema);
  await db.delete(sourceDekSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

async function seedChoice(cardId: string, actions: Array<{ actionId: string; input: Record<string, unknown> }>) {
  const [conversation] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'lead', title: 'Setup' }).returning();
  const card = { type: 'card', id: cardId, kind: 'choice', label: 'Go?', actionId: '', state: 'proposed', options: [{ id: 'A', label: 'Yes', actions }] };
  await db.insert(conversationMessageSchema).values({ conversationId: conversation!.id, role: 'assistant', content: '', runsJson: [card as never] });
  return conversation!.id;
}

async function pick(cardId: string, conversationId: number) {
  const out = await answerChoice({ orgId: ORG, userId: ADMIN, conversationId, answer: { cardId, optionId: 'A' } });
  if (!out.ok) {
    throw new Error(out.error);
  }
  return out.modelPrefix;
}

describe('a bound action\'s result reaches the agent', () => {
  it('source.connect: the line names the slug of the source it saved', async () => {
    const values = { installationId: '42' };
    await storeLoginCredential({ orgId: ORG, platform: 'github', name: 'github login', account: 'northwind', values, sealed: await sealLoginValues(ORG, values), createdBy: ADMIN });
    const conversationId = await seedChoice('card_connect', [{ actionId: 'source.connect', input: { connector: 'github', config: { repos: ['northwind/portal'] } } }]);

    const prefix = await pick('card_connect', conversationId);
    const [source] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));

    expect(source).toBeDefined();
    expect(prefix).toContain(`"slug":"${source!.slug}"`);
    expect(prefix).toContain('"created":true');
  });

  it('objects.create_group: an existing parent reads as already existing (created:false)', async () => {
    forgetCachedObjectTypes();
    await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { 'type': 'object', 'x-agent-file': { dedupOn: ['slug'] }, 'properties': { slug: { type: 'string' } } } });
    const input = { parent: { type: 'product', title: 'Portal', fields: { slug: 'portal' } }, children: [], link: { childField: 'product', parentField: 'slug' } };
    const first = await pick('card_group_1', await seedChoice('card_group_1', [{ actionId: 'objects.create_group', input }]));
    const second = await pick('card_group_2', await seedChoice('card_group_2', [{ actionId: 'objects.create_group', input }]));

    expect(first).toContain('"created":true');
    expect(second).toContain('"created":false');
  });
});

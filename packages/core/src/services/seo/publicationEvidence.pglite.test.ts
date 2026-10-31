import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { createBusinessObject, upsertBusinessObjectByExternalKey, updateBusinessObject, getBusinessObject } = await import('@/services/BusinessObjectService');
const { mergeMeta } = await import('./records');
const { objectsUpdateMetaAction } = await import('@/libs/actions/objects-update-meta');
const { objectProposeCandidateAction, forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const org = 'proof-workspace';
const forged = { status: 'verified', checkedAt: '2026-10-30', url: 'https://northwind.example/page', evidence: 'Untrusted claim' };
let id = 0;

beforeEach(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  forgetCachedObjectTypes();
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: org, slug: 'seo_page', label: 'SEO page', schema: { type: 'object', properties: { publicationVerification: { type: 'object' }, keyword: { type: 'string' } } } }).returning();
  const [page] = await db.insert(businessObjectSchema).values({ orgId: org, typeId: type!.id, title: 'Heating guide', externalSystem: 'site', externalId: 'page', metadata: { keyword: 'heating' } }).returning();
  id = page!.id;
});

it.each(['person', 'agent'])('blocks generic %s create, upsert, replacement and action execution even when the schema declares proof', async (actor) => {
  await expect(createBusinessObject({ typeSlug: 'seo_page', title: 'Fake', metadata: { publicationVerification: forged } }, org, actor)).rejects.toThrow('server-produced');
  await expect(upsertBusinessObjectByExternalKey({ typeSlug: 'seo_page', title: 'Fake', metadata: { publicationVerification: forged }, externalKey: { system: 'site', id: 'page' } }, org, actor)).rejects.toThrow('server-produced');
  await expect(updateBusinessObject({ id, metadata: { publicationVerification: forged } }, org)).rejects.toThrow('server-produced');

  const ctx = { orgId: org, userId: actor, actorId: actor } as never;

  await expect(objectsUpdateMetaAction.execute(ctx, { objectType: 'seo_page', id, set: { publicationVerification: forged }, reason: 'Try forging verification' })).rejects.toThrow('server-produced');
  await expect(objectsUpdateMetaAction.undo!(ctx, { objectType: 'seo_page', id, set: { keyword: 'heating' }, reason: 'Undo' }, { previous: { publicationVerification: forged } })).rejects.toThrow('server-produced');
  await expect(objectProposeCandidateAction.execute(ctx, { objectType: 'seo_page', fields: { publicationVerification: forged }, title: 'Fake' } as never)).rejects.toThrow('server-produced');
  expect((await getBusinessObject(id, org))!.metadata).toEqual({ keyword: 'heating' });
});

it('allows the verifier lock path and preserves its proof when a generic metadata replacement omits it', async () => {
  await mergeMeta(org, id, () => ({ publicationVerification: forged }));
  await updateBusinessObject({ id, metadata: { keyword: 'efficient heating' } }, org);

  expect((await getBusinessObject(id, org))!.metadata).toEqual({ keyword: 'efficient heating', publicationVerification: forged });
});

it('does not permit an external key to bypass proof protection by naming a different type', async () => {
  await db.insert(businessObjectTypeSchema).values({ orgId: org, slug: 'other', label: 'Other' });

  await expect(upsertBusinessObjectByExternalKey({ typeSlug: 'other', title: 'Fake', metadata: { publicationVerification: forged }, externalKey: { system: 'site', id: 'page' } }, org, 'person')).rejects.toThrow('different object type');
  expect((await getBusinessObject(id, org))!.metadata).toEqual({ keyword: 'heating' });
});

it('blocks forged audit findings/coverage and preserves complete domain evidence on generic replacement', async () => {
  const { serverProducedFields } = await import('@/libs/objects/serverProducedFields');
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: org, slug: 'seo_audit', label: 'SEO audit', schema: { type: 'object', properties: { findings: { type: 'array' }, coverage: { type: 'object' }, report: { type: 'string' } } } }).returning();
  const evidence = { projectId: 9, site: 'https://northwind.example', coverage: { complete: false }, findings: [{ status: 'open', verification: 'not_checked' }], counts: { open: 1 }, openCount: 1, highCount: 0, checkedAt: '2026-10-30', report: 'Check incomplete', pagesRead: 2 };
  const [audit] = await db.insert(businessObjectSchema).values({ orgId: org, typeId: type!.id, title: 'Audit', metadata: evidence }).returning();
  for (const key of serverProducedFields('seo_audit')) {
    await expect(updateBusinessObject({ id: audit!.id, metadata: { [key]: null } }, org)).rejects.toThrow('server-produced');
  }

  await expect(objectsUpdateMetaAction.execute({ orgId: org } as never, { objectType: 'seo_audit', id: audit!.id, set: { findings: [], coverage: { complete: true } }, reason: 'Pretend complete' })).rejects.toThrow('server-produced');
  await expect(upsertBusinessObjectByExternalKey({ typeSlug: 'seo_audit', title: 'Fake audit', metadata: { projectId: 9, coverage: { complete: true }, findings: [] } }, org, 'person')).rejects.toThrow('server-produced');

  await updateBusinessObject({ id: audit!.id, metadata: { comment: 'Reviewed' } }, org);

  expect((await getBusinessObject(audit!.id, org))!.metadata).toEqual({ ...evidence, comment: 'Reviewed' });

  await mergeMeta(org, audit!.id, () => ({ coverage: { complete: true } }));

  expect((await getBusinessObject(audit!.id, org))!.metadata?.coverage).toEqual({ complete: true });
});

it('blocks generic strategy ownership, approval receipt and roadmap forgery and preserves authority on replacement', async () => {
  const { serverProducedFields } = await import('@/libs/objects/serverProducedFields');
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: org, slug: 'seo_strategy', label: 'SEO strategy', schema: { type: 'object', properties: { goalId: { type: 'number' }, roadmap: { type: 'object' }, pendingDraft: { type: 'object' } } } }).returning();
  const authority = { projectId: 9, goalId: 41, goalStatus: 'active', roadmap: { revision: 3, initiatives: [], outcomes: [] }, pendingDraft: { token: 'real-receipt', createdBy: 'owner' }, previousStrategy: { goalId: 40 } };
  const [strategy] = await db.insert(businessObjectSchema).values({ orgId: org, typeId: type!.id, title: 'Strategy', externalSystem: 'seo-strategy', externalId: '9', metadata: authority }).returning();
  for (const key of serverProducedFields('seo_strategy')) {
    await expect(updateBusinessObject({ id: strategy!.id, metadata: { [key]: null } }, org)).rejects.toThrow('server-produced');
  }

  await expect(createBusinessObject({ typeSlug: 'seo_strategy', title: 'Fake', metadata: { goalId: 99 } }, org, 'other-member')).rejects.toThrow('server-produced');
  await expect(upsertBusinessObjectByExternalKey({ typeSlug: 'seo_strategy', title: 'Fake', metadata: { goalId: 99, roadmap: { revision: 0 } }, externalKey: { system: 'seo-strategy', id: '9' } }, org, 'other-member')).rejects.toThrow('server-produced');
  await expect(objectsUpdateMetaAction.execute({ orgId: org } as never, { objectType: 'seo_strategy', id: strategy!.id, set: { pendingDraft: { token: 'forged', createdBy: 'other-member' } }, reason: 'Replace ownership' })).rejects.toThrow('server-produced');

  await updateBusinessObject({ id: strategy!.id, metadata: { comment: 'Reviewed' } }, org);

  expect((await getBusinessObject(strategy!.id, org))!.metadata).toEqual({ ...authority, comment: 'Reviewed' });

  await mergeMeta(org, strategy!.id, () => ({ roadmap: { ...authority.roadmap, revision: 4 } }));

  expect((await getBusinessObject(strategy!.id, org))!.metadata?.roadmap).toEqual({ ...authority.roadmap, revision: 4 });
});

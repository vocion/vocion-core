import { describe, expect, it, vi } from 'vitest';

/**
 * The report's pictures are read by ARTIFACT id. A picture may be filed on
 * another record — the Share dialog request 87 shipped was captured on
 * request 121 — and `visuals.afterArtifactIds` names it by its own id; it
 * was being looked up as if it were a record id and never reached the page.
 * Fixtures are fictional.
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema, toolCallSchema } = await import('@/models/Schema');
const { loadFeatureReport } = await import('./featureReportData');

const ORG = 'org_report_visuals';

describe('the pictures on a feature page', () => {
  it('shows an after-shot filed on another record, named by its artifact id', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [other] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Send from the file page', metadata: {} } as never).returning({ id: businessObjectSchema.id });
    // Unrelated artifacts first, so the picture's id cannot equal any record
    // id here — the bug read artifact ids as record ids, and a collision
    // would hide it.
    for (let i = 0; i < 5; i++) {
      await db.insert(artifactSchema).values({ orgId: 'org_elsewhere', kind: 'markdown', title: `filler ${i}`, spec: {} } as never);
    }
    const [shot] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'file', title: 'The Kestrel share dialog', recordType: 'object', recordId: String(other!.id), recordRole: 'before-shot', spec: { contentType: 'image/png' }, url: 'https://files.example.test/share.png' } as never).returning({ id: artifactSchema.id });
    const [request] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Share a document', metadata: { state: 'shipped', surface: 'ui', visuals: { afterArtifactIds: [shot!.id] } } } as never).returning({ id: businessObjectSchema.id });

    const report = await loadFeatureReport(ORG, request!.id, new Date('2026-09-25T12:00:00Z'));

    const pictures = report!.sections.flatMap(s => s.evidence ?? []);

    expect(pictures.map(p => p.id)).toContain(shot!.id);
  });

  it('lists the conversations that worked on it, newest first, and nothing that only resembles it', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: 'org_activity', slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [request] = await db.insert(businessObjectSchema).values({ orgId: 'org_activity', typeId: type!.id, title: 'Expiring links', metadata: { state: 'triaged' } } as never).returning({ id: businessObjectSchema.id });
    const [conv] = await db.insert(conversationSchema).values({ orgId: 'org_activity', agentSlug: 'product-manager', title: 'Backfill Expiring links', createdBy: 'usr-kestrel' } as never).returning({ id: conversationSchema.id });
    const [other] = await db.insert(conversationSchema).values({ orgId: 'org_activity', agentSlug: 'product-manager', title: 'Something else', createdBy: 'usr-kestrel' } as never).returning({ id: conversationSchema.id });
    await db.insert(toolCallSchema).values([
      { orgId: 'org_activity', agentSlug: 'product-manager', tool: 'update_object', input: { object_type: 'request', id: request!.id }, output: 'ok', conversationId: conv!.id },
      { orgId: 'org_activity', agentSlug: 'product-manager', tool: 'read_object', input: { object_type: 'request', id: request!.id + 999 }, output: 'ok', conversationId: other!.id },
    ] as never);

    const report = await loadFeatureReport('org_activity', request!.id, new Date('2026-09-25T12:00:00Z'));

    expect(report!.activity!.map(a => [a.kind, a.id, a.status])).toEqual([['conversation', conv!.id, 'wrote']]);
  });
});

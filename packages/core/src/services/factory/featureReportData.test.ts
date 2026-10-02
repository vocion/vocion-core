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
const { artifactSchema, automationRunSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema, missionRunSchema, toolCallSchema, userSchema } = await import('@/models/Schema');
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

  it('names the plan\'s approver from the directory, never by their raw user id', async () => {
    const orgId = 'org_report_people';
    const [reqType] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [planType] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'architecture_plan', label: 'Plan', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    await db.insert(userSchema).values({ id: 'user_7kestrelfixture01', name: 'Priya Kestrel', email: 'priya@kestrel.example' } as never);
    const [request] = await db.insert(businessObjectSchema).values({ orgId, typeId: reqType!.id, title: 'Expiring links', metadata: { state: 'in_scope' } } as never).returning({ id: businessObjectSchema.id });
    await db.insert(businessObjectSchema).values({ orgId, typeId: planType!.id, title: 'Sign the link', status: 'candidate', metadata: { requestId: request!.id, approvedBy: 'user_7kestrelfixture01', approvedAt: '2026-09-24T10:00:00Z' } } as never);
    await db.insert(businessObjectSchema).values({ orgId, typeId: planType!.id, title: 'Sign it again', status: 'candidate', metadata: { requestId: request!.id, approvedBy: 'user_9nobodyfixture02', approvedAt: '2026-09-25T10:00:00Z', supersededBy: 1 } } as never);

    const report = await loadFeatureReport(orgId, request!.id, new Date('2026-09-26T12:00:00Z'));

    // "candidate" with an approval on it resolves to Approved, by name.
    expect(report!.planSummary).toMatchObject({ status: 'Approved', approver: 'Priya Kestrel' });
    expect(JSON.stringify(report!.sections.find(s => s.key === 'plan'))).not.toContain('user_9nobodyfixture02');
  });

  it('finds the run writing its plan from the fire that names it, whatever the automation is called (#265)', async () => {
    const orgId = 'org_report_live_plan';
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [request] = await db.insert(businessObjectSchema).values({ orgId, typeId: type!.id, title: 'Fix the header overflow', metadata: { state: 'building', recovery: { stage: 'planning', line: 'Planning — the change spans two packages' } } } as never).returning({ id: businessObjectSchema.id });
    const team = { lead: 'product-manager', members: [] };
    const [planning] = await db.insert(missionRunSchema).values({ orgId, title: 'Any name at all', brief: 'plan it', status: 'running', team } as never).returning({ id: missionRunSchema.id });
    const [finished] = await db.insert(missionRunSchema).values({ orgId, title: 'An earlier pass', brief: 'plan it', status: 'completed', team } as never).returning({ id: missionRunSchema.id });
    const [unrelated] = await db.insert(missionRunSchema).values({ orgId, title: 'Someone else', brief: 'other work', status: 'running', team } as never).returning({ id: missionRunSchema.id });
    await db.insert(automationRunSchema).values([
      { orgId, slug: 'whatever-the-workspace-named-it', kind: 'mission_check', status: 'running', input: { requestId: request!.id }, targetRunId: planning!.id },
      { orgId, slug: 'whatever-the-workspace-named-it', kind: 'mission_check', status: 'ok', input: { requestId: request!.id }, targetRunId: finished!.id },
      { orgId, slug: 'another', kind: 'mission_check', status: 'running', input: { requestId: request!.id + 999 }, targetRunId: unrelated!.id },
    ] as never);

    const report = await loadFeatureReport(orgId, request!.id, new Date());

    expect(report!.live).toMatchObject({ kind: 'planning', label: 'Writing the plan', runRef: { type: 'mission_run', id: String(planning!.id) } });
    expect(report!.status.action).toEqual({ kind: 'link', label: 'Watch the plan being written', href: `/dashboard/p/runs/agent-${planning!.id}` });
  });

  it('finds an agent run working on its task from the tool calls that name it', async () => {
    const orgId = 'org_report_live_review';
    const [reqType] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [taskType] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'engineering_task', label: 'Task', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [request] = await db.insert(businessObjectSchema).values({ orgId, typeId: reqType!.id, title: 'Expiring links', metadata: { state: 'building' } } as never).returning({ id: businessObjectSchema.id });
    const [task] = await db.insert(businessObjectSchema).values({ orgId, typeId: taskType!.id, title: 'Sign the link', status: 'awaiting_review', metadata: { requestId: request!.id, prUrl: 'https://github.com/example/northwind-portal/pull/135' } } as never).returning({ id: businessObjectSchema.id });
    const [review] = await db.insert(missionRunSchema).values({ orgId, title: 'Review', brief: 'check it', status: 'running', team: { lead: 'change-reviewer', members: [] } } as never).returning({ id: missionRunSchema.id });
    await db.insert(toolCallSchema).values({ orgId, agentSlug: 'change-reviewer', tool: 'read_object', input: { object_type: 'engineering_task', id: task!.id }, output: 'ok', missionRunId: review!.id } as never);

    const report = await loadFeatureReport(orgId, request!.id, new Date());

    expect(report!.live).toMatchObject({ kind: 'reviewing', runRef: { type: 'mission_run', id: String(review!.id) } });
  });
});

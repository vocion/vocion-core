/**
 * A run started from a conversation brings its approve step's Decision back
 * to that conversation, waiting on the person who started it; what the step
 * reviews links the artifacts an earlier step made. Every name is fictional.
 */
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { askSchema, conversationSchema, userSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { getAskBySourceRef } = await import('@/services/AskService');
const { startWorkflow } = await import('@/services/WorkflowService');
const { outputMarkdown } = await import('./approvals');

const ORG = 'proj_approvaldocks_cedar';
const PERSON = 'usr-approvaldocks-dana';

describe('an approve step in a run started from a conversation', () => {
  afterEach(async () => {
    await new Promise(r => setTimeout(r, 50));
    await db.delete(askSchema).where(eq(askSchema.orgId, ORG));
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
    await db.delete(conversationSchema).where(eq(conversationSchema.orgId, ORG));
    await db.delete(userSchema).where(eq(userSchema.id, PERSON));
  });

  it('docks in that conversation and waits on its starter', async () => {
    await db.insert(userSchema).values({ id: PERSON, email: 'dana@northwind.example', name: 'Dana' }).onConflictDoNothing();
    const [conversation] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'coordinator', title: 'Enroll' }).returning();
    await db.insert(workflowSchema).values({
      orgId: ORG,
      slug: 'rosters',
      name: 'Rosters',
      status: 'active',
      trigger: { type: 'manual' },
      ownerAgentSlug: 'coordinator',
      steps: [{ name: 'approve', type: 'approve', label: 'Approve the rosters', prompt: 'Approve the rosters?' }],
    });

    const paused = await startWorkflow({ orgId: ORG, slug: 'rosters', invokedBy: PERSON, triggerContext: { trigger: 'chat', conversationId: conversation!.id } });

    expect(paused.pauseReason).toBe('awaiting_approval:approve');

    const ask = await getAskBySourceRef(ORG, `workflow-run:${paused.id}:approve`);

    expect(ask).toMatchObject({ kind: 'approval', status: 'open', conversationId: conversation!.id, ownerUserId: PERSON });
  });

  it('a run nobody started from a conversation files its Decision with no conversation or owner', async () => {
    await db.insert(workflowSchema).values({ orgId: ORG, slug: 'gate', name: 'Gate', status: 'active', trigger: { type: 'manual' }, ownerAgentSlug: 'coordinator', steps: [{ name: 'approve', type: 'approve', prompt: 'Go?' }] });

    const paused = await startWorkflow({ orgId: ORG, slug: 'gate', invokedBy: 'mcp' });
    const ask = await getAskBySourceRef(ORG, `workflow-run:${paused.id}:approve`);

    expect(ask).toMatchObject({ conversationId: null, ownerUserId: null });
  });

  it('reads what it reviews as a person would, each artifact a step made one link away', () => {
    const md = outputMarkdown({ groups: [{ group: 'Northwind Counseling, LLC', provider_count: '4', roster: 'artifact:31' }] });

    expect(md).toBe('**groups:**\n- group: Northwind Counseling, LLC · provider_count: 4 · roster: [Open](/dashboard/artifacts/31)');
  });
});

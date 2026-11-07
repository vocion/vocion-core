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
const { outputMarkdown, reviewedFacts } = await import('./approvals');
const { factsOf, factsTable } = await import('@/libs/decisions/decision');

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

  it('a list of items reads as one fact per item, each opening the artifact it names', () => {
    const facts = reviewedFacts({ groups: [
      { group: 'Northwind Counseling, LLC', providers: 'Dana Reyes (LCSW); Ari Bell (LCPC)', provider_count: '2', roster: 'artifact:31', w9: 'https://files.example/w9.pdf' },
      { group: 'Kestrel Family Therapy, LLC', providers: 'Sam Ode (LMFT)', provider_count: '1' },
    ] });

    expect(facts).toEqual([
      { label: 'Northwind Counseling, LLC', value: 'Dana Reyes (LCSW); Ari Bell (LCPC) · provider count 2', href: '/dashboard/artifacts/31' },
      { label: 'Kestrel Family Therapy, LLC', value: 'Sam Ode (LMFT) · provider count 1' },
    ]);
    // Through the card's own table, the link survives as the fact's href.
    expect(factsOf(factsTable(facts!.map(f => ({ label: f.label, value: f.href ? `[${f.value}](${f.href})` : f.value })), 'Rosters')).facts[0]).toEqual(facts![0]);
    expect(reviewedFacts({ verdict: 'pass', findings: [] })).toBeNull();
    expect(reviewedFacts('Done.')).toBeNull();
  });
});

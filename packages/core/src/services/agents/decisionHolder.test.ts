/**
 * THE PERSON ASKING IS THE OWNER (backlog 044).
 *
 * Conversation 392, turn 2 (2026-09-30): "Merge PR #127: engineering owner's
 * call" was filed as an ask to the person who owned it and was talking to the
 * product manager. The ask and card tools now answer who holds a decision
 * from the records — the turn, the merge's trust rule, the feature's facts —
 * and say so in their result, so nothing is filed "for the owner". Fixtures
 * are fictional (Northwind; Dana Reyes at northwind.example).
 */
import type { AgentEvent, RuntimeContext } from './types';
import type { WorkFacts } from '@/libs/factory/workFacts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const loadRecordStatus = vi.fn();
vi.mock('@/services/objects/recordStatus', () => ({ loadRecordStatus: (...a: unknown[]) => loadRecordStatus(...a) }));

const saidToDecide = vi.fn(async (): Promise<{ said: boolean; quote: string | null }> => ({ said: false, quote: null }));
vi.mock('./turnJudge', async orig => ({ ...(await orig<object>()), saidToDecide: (...a: unknown[]) => (saidToDecide as (...x: unknown[]) => unknown)(...a), readIntent: async () => ({ files_new_record: false, changes_page_record: false, changes_existing_record: false, changed_record_type: null }) }));

vi.mock('./owedDecision', async orig => ({ ...(await orig<object>()), personMessages: async () => ['merge #127 when it is ready'] }));

const mergeRunsItself = vi.fn(async (_org: string, _cls: string): Promise<boolean | null> => false);
vi.mock('@/services/factory/pullSignals', async orig => ({ ...(await orig<object>()), mergeRunsItself: (org: string, cls: string) => mergeRunsItself(org, cls) }));

const { db } = await import('@/libs/DB');
const { askSchema, actionRunSchema, userSchema } = await import('@/models/Schema');
const { askHeldByThePersonHere, mergeCardRunsItself, personIsHere } = await import('./decisionHolder');
const { fileAskTool } = await import('./tools/fileAsk');
const { recommendActionTool } = await import('./tools/recommendAction');

const ORG = 'org_decision_holder';
const PR = 'https://github.com/northwind/portal/pull/127';

function facts(over: Partial<WorkFacts> = {}): WorkFacts {
  return {
    request: { id: 246, stage: 'awaiting_qa', recordState: 'building', line: 'Awaiting QA.' },
    taskId: 300,
    verdict: { value: null, proven: null, total: null, commit: null, at: null, line: 'QA has not judged it yet' },
    pullRequest: { url: PR, label: 'PR #127', merge: 'not_merged', mergedAt: null, line: 'PR #127 is not merged (nothing records a merge)' },
    ci: { state: 'failed', failedChecks: 'integration', commit: 'abc1234', at: null, line: 'CI failed on PR #127 (integration)' },
    mergeRule: { runsItself: false, riskClass: 'auth', line: 'A person approves this merge (auth): once QA approves, the merge card lands on Review, and anyone in the workspace can approve it' },
    shipped: false,
    next: 'CI failed, so QA does not start; the factory sends it back to the engineer with what failed',
    ...over,
  };
}

function status(f: WorkFacts) {
  return { ok: true, status: { record: { id: 246, objectType: 'request', title: 'Theme toggle', href: '/w/northwind/dashboard/p/feature/246' }, stage: { key: 'qa', label: 'CI failed', tone: 'warn' }, you: { needsYou: false, line: 'Nothing needs you', why: null, move: null }, live: null, next: null, facts: f, readAt: '2026-09-30T18:00:00.000Z' } };
}

function ctxFor(over: Partial<RuntimeContext> = {}): RuntimeContext & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    orgId: ORG,
    userId: 'user_dana',
    conversationId: 392,
    agentSlug: 'product-manager',
    connectorSources: [],
    objectTypeSlugs: ['request'],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: (e: AgentEvent) => events.push(e),
    events,
    ...over,
  } as RuntimeContext & { events: AgentEvent[] };
}

beforeEach(async () => {
  vi.clearAllMocks();
  loadRecordStatus.mockResolvedValue(status(facts()));
  saidToDecide.mockResolvedValue({ said: false, quote: null });
  mergeRunsItself.mockResolvedValue(false);
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
  await db.delete(userSchema);
  await db.insert(userSchema).values({ id: 'user_dana', name: 'Dana Reyes', email: 'dana@northwind.example' });
});

afterAll(async () => {
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
  await db.delete(userSchema);
});

describe('who is here', () => {
  it('is the person in their own conversation turn — never an agent on its schedule or a token client', () => {
    expect(personIsHere(ctxFor())).toBe(true);
    expect(personIsHere(ctxFor({ missionRunId: 41 }))).toBe(false);
    expect(personIsHere(ctxFor({ conversationId: undefined }))).toBe(false);
    expect(personIsHere(ctxFor({ userId: 'token:42' }))).toBe(false);
  });
});

describe('an ask the person here holds is not filed for "the owner"', () => {
  it('conversation 392: a merge routed to "the engineering owner" is refused, naming the person, the link and what the records say', async () => {
    const out = await askHeldByThePersonHere(ctxFor(), { kind: 'ruling', title: 'Merge PR #127: engineering owner\'s call', objectRefs: [{ type: 'request', id: 246 }] });

    expect(out).toContain('Not filed: Dana Reyes is in this conversation');
    expect(out).toContain('Do not route it to "the owner"');
    expect(out).toContain('/w/northwind/dashboard/p/feature/246');
    expect(out).toContain('QA has not judged it yet; CI failed on PR #127 (integration); PR #127 is not merged');
  });

  it('files as before when the person said to put it on the queue (their word runs)', async () => {
    saidToDecide.mockResolvedValueOnce({ said: true, quote: 'put it on the queue' });

    expect(await askHeldByThePersonHere(ctxFor(), { kind: 'ruling', title: 'Pick the export format', objectRefs: [] })).toBeNull();
  });

  it('files a credential ask: a secret never travels through the chat', async () => {
    expect(await askHeldByThePersonHere(ctxFor(), { kind: 'credential', title: 'Paste the Northwind API key' })).toBeNull();
  });

  it('files as before on an agent\'s own schedule, where nobody is here to ask', async () => {
    expect(await askHeldByThePersonHere(ctxFor({ missionRunId: 41, userId: 'scheduled' }), { kind: 'ruling', title: 'Pick the export format', objectRefs: [{ type: 'request', id: 246 }] })).toBeNull();
  });
});

describe('a merge nobody decides is asked of nobody', () => {
  it('refuses a merge ask in any turn when the class merges itself on its trust rule — and promises no merge card', async () => {
    loadRecordStatus.mockResolvedValue(status(facts({ mergeRule: { runsItself: true, riskClass: 'ui', line: 'This merge (ui) runs itself on its trust rule once QA approves; no card, nobody presses merge' } })));

    const out = await askHeldByThePersonHere(ctxFor({ missionRunId: 41, userId: 'scheduled' }), { kind: 'merge', title: 'Merge PR #127', objectRefs: [{ type: 'request', id: 246 }] });

    expect(out).toContain('Not filed: This merge (ui) runs itself on its trust rule');
    expect(out).toContain('never that a merge card is coming');
  });

  it('refuses a merge ask for a pull request already recorded merged', async () => {
    loadRecordStatus.mockResolvedValue(status(facts({ pullRequest: { url: PR, label: 'PR #127', merge: 'merged', mergedAt: '2026-09-30T17:58:00Z', line: 'PR #127 merged 2026-09-30T17:58:00Z' } })));

    expect(await askHeldByThePersonHere(ctxFor({ missionRunId: 41, userId: 'scheduled' }), { kind: 'merge', title: 'Merge PR #127', objectRefs: [{ type: 'request', id: 246 }] })).toContain('so there is no merge to ask anyone about');
  });

  it('reads the request a named task serves', async () => {
    loadRecordStatus.mockImplementation(async (_org: string, id: number) => (id === 246 ? status(facts({ mergeRule: { runsItself: true, riskClass: 'ui', line: 'runs itself' } })) : { ok: false, reason: 'no_report' }));
    const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'engineering_task', label: 'Task' }).returning();
    const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Theme toggle', metadata: { requestId: 246 } }).returning();

    expect(await askHeldByThePersonHere(ctxFor({ missionRunId: 41, userId: 'scheduled' }), { kind: 'merge', title: 'Merge PR #127', objectRefs: [{ type: 'engineering_task', id: row!.id }] })).toContain('Not filed: runs itself');

    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
  });
});

describe('the tools enforce it in their results', () => {
  it('file_ask files nothing in the person\'s turn and says what to do instead', async () => {
    const out = await fileAskTool(ctxFor()).invoke({ title: 'Merge PR #127: engineering owner\'s call', kind: 'ruling', object_refs: [{ type: 'request', id: 246 }], confidence: 0.9 });

    expect(out).toContain('Not filed: Dana Reyes is in this conversation');
    expect(await db.select().from(askSchema)).toHaveLength(0);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('recommend_action shows no merge card for a class that merges itself', async () => {
    mergeRunsItself.mockResolvedValueOnce(true);
    const ctx = ctxFor();
    const out = await (recommendActionTool(ctx) as unknown as { invoke: (i: Record<string, unknown>) => Promise<string> }).invoke({
      action_id: 'git.merge',
      action_input: { title: 'Merge the theme toggle', summary: 'QA approved it.', steps: [{ say: 'Merge it.', url: PR }], externalRef: { system: 'github', id: 'northwind/portal/pull/127', url: PR }, riskClass: 'ui', commitSha: 'abc1234', rollback: 'Revert the pull request.' },
      label: 'Merge PR #127',
    });

    expect(JSON.parse(out)).toMatchObject({ ok: false });
    expect(JSON.parse(out).error).toContain('runs itself on its trust rule');
    expect(ctx.events.some(e => e.type === 'recommended_action')).toBe(false);
  });

  it('a merge card for a class a person approves is still shown', async () => {
    expect(await mergeCardRunsItself({ orgId: ORG }, 'auth')).toBeNull();
  });
});

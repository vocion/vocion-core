/**
 * A change is written to the record it is about, never filed as a new one.
 *
 * Conversation 367 (2026-09-29 05:13Z): "Change this: the note is at most 280
 * characters, …" on a page with no record open was read as "file a new
 * request" and filed #232 (action run 5042). The same words on a request's
 * page must land on that request, never beside it.
 *
 * What the person meant is the turn's intent read (`turnJudge.readIntent`),
 * a model's reading — never a word match — so each case states the reading.
 */
import type { TurnIntent } from './turnJudge';
import type { RuntimeContext } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({ runId: 41, status: 'done', outcome: 'created', result: { objectId: 88, objectType: 'request' } })),
}));

// Out of process there is no turn read, so the check makes one: here, a
// reading that the latest message is a change to something already there.
vi.mock('./turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('./turnJudge')>();
  return { ...real, readIntent: vi.fn(async () => ({ ...real.NO_INTENT, changes_existing_record: true, wants_action: true })) };
});

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { proposeAction } = await import('@/services/ActionService');
const { NO_INTENT } = await import('./turnJudge');
const { anchoredAskCheck, anchoredAskRefusal, anchoredFilingCheck, anchoredFilingRefusal, hasClearFavourite } = await import('./anchoredFiling');
const { runProposal } = await import('./tools/proposeAction');

const ORG = 'org_anchored_filing';
const CHANGE = 'Change this: the note is at most 280 characters, the sender can edit or remove it any time, and viewers see it only after the gate (never on the public preview).';
const onRequest = { id: 227, objectType: 'request' };
const I = (over: Partial<TurnIntent>): TurnIntent => ({ ...NO_INTENT, ...over });

describe('anchoredFilingRefusal', () => {
  it('refuses a new request when the person asked to change the request on their page', () => {
    const out = anchoredFilingRefusal({ message: 'Three changes to this request: 1) email only 2) 48 hours 3) name who has not opened it', intent: I({ changes_page_record: true, changes_existing_record: true }), objectType: 'request', anchor: onRequest });

    expect(out).toContain('Not filed');
    expect(out).toContain('update_object (object_type "request", id 227)');
    expect(out).toContain('new version of #227');
  });

  it('refuses a change to something already there with no record open — the misread that filed #232', () => {
    const out = anchoredFilingRefusal({ message: CHANGE, intent: I({ changes_existing_record: true }), objectType: 'request', anchor: null });

    expect(out).toContain('no request is open on their page');
    expect(out).toContain('lookup_objects');
    expect(out).toContain('in one question');
  });

  it('refuses it on a page about a record of another type too', () => {
    expect(anchoredFilingRefusal({ message: CHANGE, intent: I({ changes_existing_record: true }), objectType: 'request', anchor: { id: 25, objectType: 'product' } })).toContain('no request is open');
  });

  it('files when the person wants a new or separate record, whatever else they said', () => {
    expect(anchoredFilingRefusal({ message: 'Change this so it is its own request: a pinned note for viewers.', intent: I({ files_new_record: true, changes_page_record: true }), objectType: 'request', anchor: onRequest })).toBeNull();
    expect(anchoredFilingRefusal({ message: 'Fix this: uploads fail on a phone when the signal drops.', intent: I({ files_new_record: true }), objectType: 'request', anchor: null })).toBeNull();
  });

  it('files when the reading is no change at all', () => {
    expect(anchoredFilingRefusal({ message: 'What is worth building next?', intent: I({}), objectType: 'request', anchor: onRequest })).toBeNull();
    expect(anchoredFilingRefusal({ message: 'Add a way for senders to pin a note.', intent: I({ wants_action: true }), objectType: 'request', anchor: null })).toBeNull();
  });

  it('leaves another type\'s filing alone on a record\'s page', () => {
    // A change on request #227's page does not stop a plan being filed for it.
    expect(anchoredFilingRefusal({ message: 'Add the 48-hour rule to this request.', intent: I({ changes_page_record: true }), objectType: 'architecture_plan', anchor: onRequest })).toBeNull();
  });
});

function ctxFor(over: Partial<RuntimeContext>, intent?: Partial<TurnIntent>): RuntimeContext {
  return { orgId: ORG, agentSlug: 'designer', userId: 'usr-1', conversationId: 1, connectorSources: [], objectTypeSlugs: ['request'], emit: () => {}, ...(intent ? { turnIntent: Promise.resolve(I(intent)) } : {}), ...over } as unknown as RuntimeContext;
}

const filing = {
  actionId: 'objects.propose_candidate',
  input: { objectType: 'request', title: 'Note on a send: 280-char limit', fields: {}, dedupOn: ['title'] },
  confidence: 0.8,
  rationale: 'Filing the request asked for.',
  suggestedDecision: 'approve' as const,
  suggestedDecisionReason: 'Filing the request asked for.',
};

describe('a filing in a person\'s turn (runProposal)', () => {
  beforeEach(async () => {
    vi.mocked(proposeAction).mockClear();
    await db.delete(conversationMessageSchema);
    await db.delete(conversationSchema);
  });

  it('is refused on a request\'s page when the person asked to change it, and nothing is proposed', async () => {
    const ctx = ctxFor({ turnMessage: 'Change this request: make the reminder 48 hours.', pageContext: { path: '/dashboard/p/feature/227', title: 'Feature', record: { type: 'object', id: '227', objectType: 'request' } } }, { changes_page_record: true, changes_existing_record: true });

    const out = await runProposal(ctx, filing, { tool: 'file_request' });

    expect(out).toContain('id 227');
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('reads the conversation\'s latest person message, and its intent, when the call is out of process', async () => {
    const [conv] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'designer', title: 'Note' } as never).returning();
    await db.insert(conversationMessageSchema).values([
      { conversationId: conv!.id, role: 'user', content: 'Let senders pin a note.' },
      { conversationId: conv!.id, role: 'assistant', content: 'Filed.' },
      { conversationId: conv!.id, role: 'user', content: CHANGE },
    ] as never);

    const out = await anchoredFilingCheck(ctxFor({ conversationId: conv!.id, pageContext: { path: '/dashboard/p/feature', title: 'Features' } }), filing.input);

    expect(out).toContain('no request is open on their page');
  });

  it('files as before when the person asked for one', async () => {
    const ctx = ctxFor({ turnMessage: 'File a feature request: senders pin a note on a send.', pageContext: { path: '/dashboard/p/feature/227', title: 'Feature', record: { type: 'object', id: '227', objectType: 'request' } } }, { files_new_record: true, wants_action: true });

    await runProposal(ctx, filing, { tool: 'file_request' });

    expect(proposeAction).toHaveBeenCalledTimes(1);
  });
});

/**
 * A conflict found while doing the work is an edit, not an ask. Request
 * #224 (2026-09-29 16:34Z): asked on the feature page to add mocks, the
 * designer found a criterion that did not fit the drawing and filed a ruling
 * recommending its own answer at 0.85 over 0.3, instead of changing the
 * request.
 */
describe('anchoredAskRefusal', () => {
  const MOCKS = 'can you add mocks/images to this request?';
  const working = I({ wants_work_on_record: true, wants_action: true });
  const lopsided = [
    { label: 'Amend criterion 1 to "every row with a share link"', recommended: true, confidence: 0.85 },
    { label: 'A disabled control on locked rows too', confidence: 0.3 },
    { label: 'Move the control beside the badge' },
  ];
  const even = [
    { label: 'In the row', confidence: 0.5 },
    { label: 'In the menu', confidence: 0.5 },
  ];

  it('refuses the #224 shape — a ruling about the page\'s request with a clear favourite — and says to edit it', () => {
    const out = anchoredAskRefusal({ message: MOCKS, intent: working, anchor: onRequest, kind: 'ruling', options: lopsided, objectRefs: [{ type: 'request', id: 227 }, { type: 'architecture_plan', id: 9 }] });

    expect(out).toContain('Not asked');
    expect(out).toContain('update_object (object_type "request", id 227)');
    expect(out).toContain('Ask only when two readings are equally good');
  });

  it('refuses an input ask while the person has the agent working on the record', () => {
    expect(anchoredAskRefusal({ message: 'Change this: the reminder goes out after 48 hours.', intent: I({ changes_page_record: true }), anchor: onRequest, kind: 'input' })).toContain('a gap you found in it is yours to close');
    expect(anchoredAskRefusal({ message: 'mock this up', intent: working, anchor: onRequest, kind: 'input' })).toContain('Not asked');
  });

  it('lets through two equally good readings, a choice the person asked for, and decisions only a person makes', () => {
    expect(anchoredAskRefusal({ message: MOCKS, intent: working, anchor: onRequest, kind: 'ruling', options: even })).toBeNull();
    expect(anchoredAskRefusal({ message: 'Mock it up and give me options for where the button goes.', intent: I({ wants_work_on_record: true, wants_to_choose: true }), anchor: onRequest, kind: 'ruling', options: lopsided })).toBeNull();

    for (const kind of ['approval', 'recommendation', 'credential', 'merge', 'gate']) {
      expect(anchoredAskRefusal({ message: MOCKS, intent: working, anchor: onRequest, kind, options: lopsided })).toBeNull();
    }
  });

  it('leaves an ask about another record, or with no record on the page, alone', () => {
    expect(anchoredAskRefusal({ message: MOCKS, intent: working, anchor: onRequest, kind: 'ruling', options: lopsided, objectRefs: [{ type: 'request', id: 300 }] })).toBeNull();
    expect(anchoredAskRefusal({ message: MOCKS, intent: working, anchor: null, kind: 'ruling', options: lopsided })).toBeNull();
  });

  it('reads a favourite only off scored options', () => {
    expect(hasClearFavourite(lopsided)).toBe(true);
    expect(hasClearFavourite(even)).toBe(false);
    expect(hasClearFavourite([{ label: 'A', recommended: true }, { label: 'B' }])).toBe(false);
    expect(hasClearFavourite([{ label: 'A', recommended: true, confidence: 0.6 }, { label: 'B', confidence: 0.5 }])).toBe(false);
    expect(hasClearFavourite(['A', 'B'])).toBe(false);
  });

  it('never gates an unattended run, and reads the page and the intent from the turn', async () => {
    const page = { path: '/dashboard/p/feature/227', title: 'Feature', record: { type: 'object' as const, id: '227', objectType: 'request' } };

    expect(await anchoredAskCheck(ctxFor({ turnMessage: MOCKS, pageContext: page }, { wants_work_on_record: true }), { kind: 'ruling', options: lopsided })).toContain('Not asked');
    expect(await anchoredAskCheck(ctxFor({ turnMessage: MOCKS, pageContext: page, missionRunId: 5 } as Partial<RuntimeContext>, { wants_work_on_record: true }), { kind: 'ruling', options: lopsided })).toBeNull();
  });
});

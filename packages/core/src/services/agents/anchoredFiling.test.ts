/**
 * A change is written to the record it is about, never filed as a new one.
 *
 * Conversation 367 (2026-09-29 05:13Z): "Change this: the note is at most 280
 * characters, …" on a page with no record open was read as "file a new
 * request" and filed #232 (action run 5042). The same words on a request's
 * page must land on that request, never beside it.
 */
import type { RuntimeContext } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({ runId: 41, status: 'done', outcome: 'created', result: { objectId: 88, objectType: 'request' } })),
}));

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const { proposeAction } = await import('@/services/ActionService');
const { anchoredFilingCheck, anchoredFilingRefusal, asksForANewRecord } = await import('./anchoredFiling');
const { runProposal } = await import('./tools/proposeAction');

const ORG = 'org_anchored_filing';
const CHANGE = 'Change this: the note is at most 280 characters, the sender can edit or remove it any time, and viewers see it only after the gate (never on the public preview).';
const onRequest = { id: 227, objectType: 'request' };

describe('anchoredFilingRefusal', () => {
  it('refuses a new request when the person asked to change the request on their page', () => {
    const out = anchoredFilingRefusal({ message: 'Three changes to this request: 1) email only 2) 48 hours 3) name who has not opened it', objectType: 'request', anchor: onRequest });

    expect(out).toContain('Not filed');
    expect(out).toContain('update_object (object_type "request", id 227)');
    expect(out).toContain('new version of #227');
  });

  it('refuses "Change this: …" with no record open — the misread that filed #232', () => {
    const out = anchoredFilingRefusal({ message: CHANGE, objectType: 'request', anchor: null });

    expect(out).toContain('no request is open on their page');
    expect(out).toContain('lookup_objects');
    expect(out).toContain('in one question');
  });

  it('refuses it on a page about a record of another type too', () => {
    expect(anchoredFilingRefusal({ message: CHANGE, objectType: 'request', anchor: { id: 25, objectType: 'product' } })).toContain('no request is open');
  });

  it('files when the person asked for a new or separate one', () => {
    expect(anchoredFilingRefusal({ message: 'Change this so it is its own request: a pinned note for viewers.', objectType: 'request', anchor: onRequest })).toBeNull();
    expect(anchoredFilingRefusal({ message: 'Update this, and file a new request for the digest email.', objectType: 'request', anchor: onRequest })).toBeNull();
    expect(anchoredFilingRefusal({ message: 'File a feature request: senders pin a note on a send.', objectType: 'request', anchor: null })).toBeNull();
    expect(asksForANewRecord('split this out into a separate feature')).toBe(true);
  });

  it('files when nothing in the words is a change', () => {
    expect(anchoredFilingRefusal({ message: 'What is worth building next?', objectType: 'request', anchor: onRequest })).toBeNull();
    expect(anchoredFilingRefusal({ message: 'Let senders pin a short note on a send.', objectType: 'request', anchor: null })).toBeNull();
    // With no record open, only a change aimed at "this" is a change: an
    // idea that opens on "add" is an idea.
    expect(anchoredFilingRefusal({ message: 'Add a way for senders to pin a note.', objectType: 'request', anchor: null })).toBeNull();
  });

  it('leaves another type\'s filing alone on a record\'s page', () => {
    // A change on request #227's page does not stop a plan being filed for it.
    expect(anchoredFilingRefusal({ message: 'Add the 48-hour rule to this request.', objectType: 'architecture_plan', anchor: onRequest })).toBeNull();
  });
});

function ctxFor(over: Partial<RuntimeContext>): RuntimeContext {
  return { orgId: ORG, agentSlug: 'designer', userId: 'usr-1', conversationId: 1, connectorSources: [], objectTypeSlugs: ['request'], emit: () => {}, ...over } as unknown as RuntimeContext;
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
    const ctx = ctxFor({ turnMessage: 'Change this request: make the reminder 48 hours.', pageContext: { path: '/dashboard/p/feature/227', title: 'Feature', record: { type: 'object', id: '227', objectType: 'request' } } });

    const out = await runProposal(ctx, filing, { tool: 'file_request' });

    expect(out).toContain('id 227');
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('reads the conversation\'s latest person message when the turn carries none (a tool call out of process)', async () => {
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
    const ctx = ctxFor({ turnMessage: 'File a feature request: senders pin a note on a send.', pageContext: { path: '/dashboard/p/feature/227', title: 'Feature', record: { type: 'object', id: '227', objectType: 'request' } } });

    await runProposal(ctx, filing, { tool: 'file_request' });

    expect(proposeAction).toHaveBeenCalledTimes(1);
  });
});

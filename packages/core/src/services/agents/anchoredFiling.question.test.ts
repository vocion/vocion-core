/**
 * A question is answered, not filed as work (2026-10-01, CHAT-423): asked
 * "how does this work without me manually registering an app with the
 * vendor?" on a feature's page, the product manager filed a request, and its
 * build started. A type that asks for work when filed (`x-asks-for-work`) is
 * refused back to the agent when a model reading of the person's words says
 * they asked for an answer. Every name is invented.
 */
import type { TurnIntent } from './turnJudge';
import type { RuntimeContext } from './types';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({ runId: 41, status: 'done', outcome: 'created', result: { objectId: 88, objectType: 'request' } })),
}));
const asked = vi.hoisted(() => ({ value: null as null | 'work' | 'answer' | 'hold', seen: [] as string[][] }));
vi.mock('./turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('./turnJudge')>();
  return {
    ...real,
    readIntent: vi.fn(async () => real.NO_INTENT),
    saidToDecide: vi.fn(async () => ({ said: false, quote: null })),
    readAsked: vi.fn(async (input: { messages: string[] }) => {
      asked.seen.push(input.messages);
      return asked.value ? { asked: asked.value, quote: input.messages[0] ?? null } : null;
    }),
  };
});

const { proposeAction } = await import('@/services/ActionService');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { NO_INTENT } = await import('./turnJudge');
const { runProposal } = await import('./tools/proposeAction');

const ORG = 'org_question_filing';
const QUESTIONS = [
  'how does this work without me manually registering an app with the assistant vendor?',
  'how do we implement this so it\'s a globally available assistant plugin? and not require manual intervention for every Northwind user?',
  'i\'m also here, and don\'t understand how to manually add. your instructions. what do I need to do to manually build and test this?',
];

beforeAll(async () => {
  await createObjectType({ slug: 'request', label: 'Request', schema: { 'type': 'object', 'x-asks-for-work': true, 'properties': {} } } as never, ORG);
  await createObjectType({ slug: 'note', label: 'Note', schema: { type: 'object', properties: {} } } as never, ORG);
});

beforeEach(() => {
  vi.mocked(proposeAction).mockClear();
  asked.value = null;
});

function ctxFor(message: string, intent: Partial<TurnIntent> = {}): RuntimeContext {
  return { orgId: ORG, agentSlug: 'product-manager', userId: 'usr-1', conversationId: 1, turnMessage: message, connectorSources: [], objectTypeSlugs: ['request'], emit: () => {}, turnIntent: Promise.resolve({ ...NO_INTENT, ...intent }), pageContext: { path: '/dashboard/p/feature/308', title: 'Feature', record: { type: 'object', id: '308', objectType: 'request' } } } as unknown as RuntimeContext;
}

const filing = (objectType = 'request') => ({
  actionId: 'objects.propose_candidate',
  input: { objectType, title: 'Explain the assistant integration', fields: {}, dedupOn: ['title'] },
  confidence: 0.8,
  rationale: 'Filing the question.',
  suggestedDecision: 'approve' as const,
  suggestedDecisionReason: 'Filing the question.',
});

describe('a question in a person\'s turn', () => {
  it('is refused back to the agent to answer, for each of CHAT-423\'s three questions, and nothing is proposed', async () => {
    asked.value = 'answer';
    for (const q of QUESTIONS) {
      const out = await runProposal(ctxFor(q), filing(), { tool: 'file_request' });

      expect(out).toMatch(/^Not filed: the person asked a question \(".+"\), so what they want is the answer, not a new request that starts work\. Answer it in this turn/);
      expect(asked.seen.at(-1)![0]).toBe(q);
    }

    expect(proposeAction).not.toHaveBeenCalled();
  });

  it('files as before when they asked for work, asked for a new record, the read failed, or the type asks for no work', async () => {
    asked.value = 'work';
    await runProposal(ctxFor('Build the vendor registration step.'), filing(), { tool: 'file_request' });
    asked.value = 'answer';
    await runProposal(ctxFor(QUESTIONS[0]!, { files_new_record: true }), filing(), { tool: 'file_request' });
    await runProposal(ctxFor(QUESTIONS[0]!), filing('note'), { tool: 'file_note' });
    asked.value = null;
    await runProposal(ctxFor(QUESTIONS[0]!), filing(), { tool: 'file_request' });

    expect(proposeAction).toHaveBeenCalledTimes(4);
  });
});

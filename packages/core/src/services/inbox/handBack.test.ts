import type { Ask } from '@/services/AskService';
import { describe, expect, it } from 'vitest';
import { answerGoesBack, answerOf, handBackMessage, handsBackNow } from './handBack';

/**
 * A decided ask from an agent, answered on Needs you in the person's own words.
 * @param over - The fields this case changes.
 */
function ask(over: Partial<Ask> = {}): Ask {
  return {
    id: 41,
    orgId: 'org-northwind',
    projectId: null,
    kind: 'input',
    title: 'Name the author for each of the 3 sample posts',
    body: 'Northwind Home Services posts carry a byline.',
    sourceRef: 'action_run:900',
    agentSlug: 'seo-strategist',
    teamSlug: 'seo',
    risk: null,
    options: [],
    objectRefs: [{ type: 'seo_batch', id: '7' }],
    decisionCost: null,
    groupKey: null,
    groupTitle: null,
    contextUrl: null,
    contextMd: null,
    status: 'done',
    decision: 'other',
    decisionNote: 'Dana Reyes for all three, and make her the default author.',
    followUp: false,
    decidedBy: 'usr-dana',
    decidedAt: new Date('2026-10-27T10:00:00Z'),
    dueAt: null,
    notifyAt: null,
    notified: false,
    createdBy: 'agent:seo-strategist',
    createdAt: new Date('2026-10-27T09:00:00Z'),
    updatedAt: new Date('2026-10-27T10:00:00Z'),
    conversationId: null,
    ownerUserId: null,
    allowOther: true,
    multiSelect: false,
    chosenOptionIds: null,
    decidedVia: 'needs_you',
    effectRunId: null,
    outcomes: null,
    ...over,
  } as Ask;
}

const nothingElse = { parked: false, subscribed: false };

describe('which answers go back to the agent that asked', () => {
  it('an agent\'s question answered on Needs you goes back', () => {
    expect(answerGoesBack(ask())).toBe(true);
    expect(handsBackNow(ask(), nothingElse)).toBe(true);
  });

  it('a question nobody\'s agent asked has no one to resume', () => {
    expect(answerGoesBack(ask({ agentSlug: null }))).toBe(false);
  });

  it('stands aside where the asker carries its own answer on', () => {
    expect(answerGoesBack(ask({ outcomes: { onApprove: 'The briefs start.' } }))).toBe(false);

    for (const ref of ['seo-page:3:9:1', 'seo-plan:7:1', 'routine-run:5', 'resume-gate:2']) {
      expect(answerGoesBack(ask({ sourceRef: ref }))).toBe(false);
    }
  });

  it('is not handed back twice: an answer in the conversation\'s own turn already ran the agent', () => {
    expect(handsBackNow(ask({ conversationId: 12, decidedVia: 'card' }), nothingElse)).toBe(false);
    expect(handsBackNow(ask({ conversationId: 12, decidedVia: 'composer' }), nothingElse)).toBe(false);
    expect(handsBackNow(ask({ conversationId: 12, decidedVia: 'chat_chip' }), nothingElse)).toBe(false);
    // Recorded by decide_ask from the person's words: the agent's own turn is the follow-up.
    expect(handsBackNow(ask({ decidedVia: 'chat' }), nothingElse)).toBe(false);
    // The same docked question answered from Needs you goes back into that conversation.
    expect(handsBackNow(ask({ conversationId: 12, decidedVia: 'needs_you' }), nothingElse)).toBe(true);
  });

  it('leaves a parked run to its gate and an answer to the automation subscribed to it', () => {
    expect(handsBackNow(ask(), { parked: true, subscribed: false })).toBe(false);
    expect(handsBackNow(ask(), { parked: false, subscribed: true })).toBe(false);
  });

  it('hands back only a person\'s answer', () => {
    for (const by of ['trust-ladder', 'by-default', 'agent:seo-editor', 'token:abc', null]) {
      expect(handsBackNow(ask({ decidedBy: by }), nothingElse)).toBe(false);
    }
  });

  it('never for a question still open or withdrawn', () => {
    expect(handsBackNow(ask({ status: 'open' }), nothingElse)).toBe(false);
    expect(handsBackNow(ask({ status: 'superseded' }), nothingElse)).toBe(false);
  });
});

describe('what the agent reads', () => {
  it('types the answer: their words, an option, or a skip', () => {
    expect(answerOf(ask())).toEqual({ kind: 'free_text', text: 'Dana Reyes for all three, and make her the default author.' });
    expect(answerOf(ask({ decision: 'approve', decisionNote: null }))).toEqual({ kind: 'option', optionIds: ['approve'] });
    expect(answerOf(ask({ status: 'skipped', decision: null }))).toEqual({ kind: 'skip' });
  });

  it('is the typed decision event, with where it was answered and that it carries on', async () => {
    const text = await handBackMessage(ask(), 'on Needs you');

    expect(text).toContain('[decision #41 answered] Name the author for each of the 3 sample posts');
    expect(text).toContain('Answered in their own words: Dana Reyes for all three, and make her the default author.');
    expect(text).toContain('They answered on Needs you');
  });
});

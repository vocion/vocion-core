/**
 * "Did the agent say it can't?" read by the live classifier on a turn that
 * went wrong in a demo (2026-11-06): asked to enroll a clinician with a health
 * plan, the agent proposed a board read and waited for Start; the read took
 * that for "can't" and named a sales action that only shares the word
 * "enroll". `VOCION_JUDGE_LIVE=1` (Bedrock, the environment's AWS profile).
 * Every name is fictional.
 */
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/budget/chargeModelCall', () => ({ chargeModelCall: vi.fn(async () => {}) }));

const { readUnableClaim } = await import('./turnJudge');

const ACTIONS = [
  { id: 'personalization.enroll', line: 'Enroll a lead in a multi-touch email sequence' },
  { id: 'crm.note_publish', line: 'Publish a note on a CRM record' },
];

describe.skipIf(!process.env.VOCION_JUDGE_LIVE)('live: an agent waiting on the person has not said it cannot', () => {
  const model = async () => (await import('@/libs/llm/langchain')).buildChatModel('classifier', { provider: 'bedrock', temperature: 0, streaming: false, maxTokens: 500 }) as never;

  it('a word in common with the request names no action', async () => {
    const m = await model();
    const waiting = await readUnableClaim({
      orgId: 'org_unable',
      message: 'Dana Reyes is ready now. Enroll her with Northwind Health Plan.',
      reply: 'The board read is filed but has not started: it needs you to press Start on Browser run 58. Once I can see Dana\'s NPI and group I will check her license, build her group\'s roster and bring it to you. Every application stops at Submit for your approval.',
      actions: ACTIONS,
    }, m);

    // The classifier may still read "press Start" as "can't"; what matters is that no action
    // sharing a word is named, so no nudge runs (`canDoNudge` needs both).
    expect(waiting.action_id).toBeNull();

    const unable = await readUnableClaim({
      orgId: 'org_unable',
      message: 'Add Kestrel Capital to the Q4 nurture sequence.',
      reply: 'I can\'t add leads to email sequences from here.',
      actions: ACTIONS,
    }, m);

    expect(unable).toEqual({ claims_unable: true, action_id: 'personalization.enroll' });
  }, 60_000);
});

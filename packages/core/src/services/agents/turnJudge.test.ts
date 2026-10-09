import { describe, expect, it } from 'vitest';
import { NO_INTENT, readIntent } from './turnJudge';

/**
 * A model bound to the one report tool, answering with these fields.
 * @param args
 * @param seen
 */
function modelSaying(args: Record<string, unknown>, seen: unknown[] = []) {
  return {
    bindTools: (tools: Array<{ name: string }>, opts: unknown) => {
      seen.push({ tools: tools.map(t => t.name), opts });
      return { invoke: async (messages: unknown) => {
        seen.push(messages);
        return { tool_calls: [{ name: tools[0]!.name, args }] };
      } };
    },
  } as never;
}

describe('what the person meant, read by a model', () => {
  it('returns the typed reading the model reports, with the report tool forced', async () => {
    const seen: unknown[] = [];
    const intent = await readIntent({ orgId: 'org_judge', message: 'can you expand the scope of this request and send it back?', page: 'request #41' }, modelSaying({ asks: 'change', changed_record_type: 'request', record_type: null, summary: 'widen #41 and rebuild' }, seen));

    expect(intent).toEqual({ asks: 'change', changed_record_type: 'request', record_type: null, summary: 'widen #41 and rebuild' });
    expect(seen[0]).toEqual({ tools: ['report_intent'], opts: { tool_choice: 'report_intent' } });
  });

  it('is "no signal" when the model fails or answers out of shape', async () => {
    const broken = { bindTools: () => ({ invoke: async () => {
      throw new Error('rate limited');
    } }) } as never;

    expect(await readIntent({ orgId: 'org_judge', message: 'hi' }, broken)).toEqual(NO_INTENT);
    expect(await readIntent({ orgId: 'org_judge', message: 'hi' }, modelSaying({ asks: 'maybe' }))).toEqual(NO_INTENT);
    expect(NO_INTENT.unread).toBe(true);
  });
});

describe('consent to a decision, read by a model', () => {
  it('reads "this" as the record on the page the person is on', async () => {
    const { saidToDecide } = await import('./turnJudge');
    const seen: unknown[] = [];
    await saidToDecide({ orgId: 'org_judge', messages: ['Plan this again and build it.'], decision: 'Start the build for request #224', page: 'request #224 Copy link on each row' }, modelSaying({ said: true, quote: 'Plan this again and build it.' }, seen));
    const human = JSON.stringify(seen[1]);

    expect(human).toContain('The person is on the page of request #224 Copy link on each row');
  });

  it('is the model\'s reading of the person\'s own words, and no consent when there are none or the read fails', async () => {
    const { saidToDecide } = await import('./turnJudge');

    expect(await saidToDecide({ orgId: 'org_judge', messages: ['approve the first one'], decision: 'approve proposal #41' }, modelSaying({ said: true, quote: 'approve the first one' }))).toEqual({ said: true, quote: 'approve the first one' });
    expect(await saidToDecide({ orgId: 'org_judge', messages: [], decision: 'approve proposal #41' }, modelSaying({ said: true, quote: 'x' }))).toEqual({ said: false, quote: null });
    expect(await saidToDecide({ orgId: 'org_judge', messages: ['approve it'], decision: 'approve proposal #41' }, { bindTools: () => ({ invoke: async () => {
      throw new Error('down');
    } }) } as never)).toEqual({ said: false, quote: null });
  });
});

describe('answers first: does the message answer the open Decision?', () => {
  const decision = { question: 'Which area should the factory start on?', options: [{ id: 'uploads', label: 'Uploads' }, { id: 'exports', label: 'Exports' }, { id: 'billing', label: 'Billing' }], allowOther: true, multiple: false };

  it('returns the typed reading, with the report tool forced and the options numbered as the card shows them', async () => {
    const { readDecisionAnswer } = await import('./turnJudge');
    const seen: unknown[] = [];
    const out = await readDecisionAnswer({ orgId: 'org_judge', message: 'the second one', decision }, modelSaying({ answers_open_decision: { kind: 'option', option_ids: ['exports'], free_text: null } }, seen));

    expect(out).toEqual({ kind: 'option', option_ids: ['exports'], free_text: null });
    expect(seen[0]).toEqual({ tools: ['report_decision_answer'], opts: { tool_choice: 'report_decision_answer' } });
    expect(JSON.stringify(seen[1])).toContain('2. [id exports] Exports');
  });

  it('is "none" when the read fails, so the message routes as usual and nothing is held up', async () => {
    const { readDecisionAnswer, NO_DECISION_ANSWER } = await import('./turnJudge');
    const broken = { bindTools: () => ({ invoke: async () => {
      throw new Error('rate limited');
    } }) } as never;

    expect(await readDecisionAnswer({ orgId: 'org_judge', message: '2', decision }, broken)).toEqual(NO_DECISION_ANSWER);
    expect(await readDecisionAnswer({ orgId: 'org_judge', message: '2', decision }, modelSaying({ answers_open_decision: { kind: 'maybe' } }))).toEqual(NO_DECISION_ANSWER);
  });

  it('routes on the reading: options it has, "1 and 3" as words where one is taken, nothing for a new topic', async () => {
    const { decisionAnswerFromReading } = await import('./turnJudge');

    expect(decisionAnswerFromReading(decision, { kind: 'option', option_ids: ['exports'], free_text: null }, '2')).toEqual({ kind: 'option', optionIds: ['exports'] });
    expect(decisionAnswerFromReading(decision, { kind: 'option', option_ids: ['uploads', 'billing'], free_text: null }, '1 and 3')).toEqual({ kind: 'free_text', text: '1 and 3' });
    expect(decisionAnswerFromReading({ ...decision, multiple: true }, { kind: 'option', option_ids: ['uploads', 'billing', 'uploads'], free_text: null }, '1 and 3')).toEqual({ kind: 'option', optionIds: ['uploads', 'billing'] });
    expect(decisionAnswerFromReading({ ...decision, allowOther: false }, { kind: 'option', option_ids: ['uploads', 'billing'], free_text: null }, '1 and 3')).toBeNull();
    expect(decisionAnswerFromReading(decision, { kind: 'free_text', option_ids: [], free_text: 'start with search' }, 'neither, start with search')).toEqual({ kind: 'free_text', text: 'start with search' });
    expect(decisionAnswerFromReading(decision, { kind: 'none', option_ids: [], free_text: null }, 'what is the weather')).toBeNull();
  });

  it('marks a turn that answered as a decision, never read-only', async () => {
    const { answeredIntent, asksForAct } = await import('./turnJudge');

    expect(asksForAct(answeredIntent('Chose Exports'))).toBe(true);
  });
});

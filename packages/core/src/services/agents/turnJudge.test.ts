import { describe, expect, it } from 'vitest';
import { judgeAnswer, NO_INTENT, NO_JUDGEMENT, readIntent, stepLines } from './turnJudge';

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
    const intent = await readIntent({ orgId: 'org_judge', message: 'can you expand the scope of this request and send it back?', page: 'request #41' }, modelSaying({ changes_page_record: true, files_new_record: false, decides: true, wants_action: true, summary: 'widen #41 and rebuild' }, seen));

    expect(intent).toEqual({ changes_page_record: true, files_new_record: false, decides: true, wants_action: true, summary: 'widen #41 and rebuild' });
    expect(seen[0]).toEqual({ tools: ['report_intent'], opts: { tool_choice: 'report_intent' } });
  });

  it('is "no signal" when the model fails or answers out of shape', async () => {
    const broken = { bindTools: () => ({ invoke: async () => {
      throw new Error('rate limited');
    } }) } as never;

    expect(await readIntent({ orgId: 'org_judge', message: 'hi' }, broken)).toEqual(NO_INTENT);
    expect(await readIntent({ orgId: 'org_judge', message: 'hi' }, modelSaying({ changes_page_record: 'yes' }))).toEqual(NO_INTENT);
  });
});

describe('how the reply ended, read by a model', () => {
  it('returns the typed judgement, and "no signal" on failure', async () => {
    const judged = await judgeAnswer({ orgId: 'org_judge', message: 'file it', reply: 'Filed.', steps: stepLines([{ tool: 'lookup_objects', output: '[]' }]), cards: 0 }, modelSaying({ ...NO_JUDGEMENT, claims_unrecorded_work: true, claim: 'Filed.' }));

    expect(judged.claims_unrecorded_work).toBe(true);
    expect(judged.claim).toBe('Filed.');
    expect(await judgeAnswer({ orgId: 'org_judge', message: 'x', reply: 'y', steps: [], cards: 0 }, { bindTools: () => ({ invoke: async () => ({}) }) } as never)).toEqual(NO_JUDGEMENT);
  });

  it('lists each step with what it answered, for the model to read', () => {
    expect(stepLines([{ tool: 'withdraw_proposal', output: 'Proposal #5232 is not yours to withdraw.' }])).toEqual(['withdraw_proposal → Proposal #5232 is not yours to withdraw.']);
  });
});

/**
 * The person asked for a record and the turn wrote nothing: one pass with
 * propose_action chosen files it (conversation 349, 2026-09-28). The tool is
 * the real propose_action schema behind the real wrapper; the model and the
 * action behind the tool are written down.
 */
import type { RuntimeContext } from './types';
import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { explainProposeActionMiss, normalizeProposeActionArgs, proposeActionArgsSchema } from '@/libs/actions/proposeActionArgs';
import { asksToFile, fileOwedWrite, owedWriteLine } from './owedWriteBackstop';

vi.mock('@/libs/DB');

const { withArgumentRepair, withToolCallRecord } = await import('./toolCallRecord');

const ctx = { orgId: 'org_owed_write', agentSlug: 'product-manager', emit: () => {}, citationSeq: { current: 0 }, delegations: new Map() } as unknown as RuntimeContext;

const ENVELOPE = { confidence: 0.8, rationale: 'The person asked for it in chat.', suggested_decision: 'approve', suggested_decision_reason: 'Asked for directly by the product owner.' };
const PAYLOAD = { objectType: 'request', title: 'Export the viewer list as a CSV', fields: { product: 'send', kind: 'feature' } };

function proposeTool(answer: string, received: unknown[]) {
  const t = tool(async (input) => {
    received.push(input);
    return answer;
  }, { name: 'propose_action', description: 'Propose an action.', schema: proposeActionArgsSchema });
  return withToolCallRecord(withArgumentRepair(t, { normalizeArgs: normalizeProposeActionArgs, explainSchemaMiss: explainProposeActionMiss }) as never, ctx);
}

/**
 * A model bound to the one tool that answers each call in turn.
 * @param calls - The arguments of each call it makes.
 */
function modelMaking(calls: Array<Record<string, unknown>>) {
  const seen: unknown[][] = [];
  const bound: Array<{ opts: unknown }> = [];
  return {
    seen,
    bound,
    bindTools: (_tools: unknown[], opts?: unknown) => {
      bound.push({ opts });
      return {
        invoke: async (messages: unknown[]) => {
          seen.push([...messages]);
          const args = calls[seen.length - 1];
          return new AIMessage({ content: '', tool_calls: args ? [{ id: `c${seen.length}`, name: 'propose_action', args }] : [] });
        },
      };
    },
  };
}

describe('which messages ask for a filing', () => {
  it('reads the two asks of conversation 349 as asks', () => {
    expect(asksToFile('Founders keep asking for the viewer list. File a feature request for Send: a Download CSV button.')).toBe(true);
    expect(asksToFile('You said nothing was saved. Please file it now.')).toBe(true);
    expect(asksToFile('Log a bug for the upload retry.')).toBe(true);
  });

  it('leaves questions and everything else alone', () => {
    expect(asksToFile('How do I file a feature request?')).toBe(false);
    expect(asksToFile('Don\'t file this yet, just draft it.')).toBe(false);
    expect(asksToFile('What should I do right now?')).toBe(false);
    expect(asksToFile('Which requests were filed this week?')).toBe(false);
  });
});

describe('the line the person reads', () => {
  it('links a record that was filed, and says plainly when it waits for approval', () => {
    expect(owedWriteLine('objects.propose_candidate is DONE: filed as request #131 (run #7, confidence 0.8), open at /w/northwind/dashboard/p/feature/131. Title: Export the list. It was within bounds…'))
      .toBe('Filed from this conversation: [request #131](/w/northwind/dashboard/p/feature/131).');
    expect(owedWriteLine('Proposed objects.propose_candidate → action run #9 is PENDING human approval in the review queue (confidence 0.8).'))
      .toMatch(/^Filed from this conversation for approval: it is waiting in Review as action run #9\./);
    expect(owedWriteLine('Not recorded: invalid arguments for propose_action — …')).toBeNull();
  });
});

describe('the filing pass', () => {
  it('files what the person asked for with the tool chosen, from the conversation', async () => {
    const received: unknown[] = [];
    const model = modelMaking([{ action_id: 'objects.propose_candidate', action_input: PAYLOAD, ...ENVELOPE }]);
    const res = await fileOwedWrite({
      request: 'Please file it now.',
      history: [{ role: 'user', content: 'File a feature request for Send: export the viewer list as a CSV.' }, { role: 'assistant', content: 'Nothing was saved in this turn.' }],
      answer: 'Filed. The request card is on your screen.',
      tool: proposeTool('objects.propose_candidate is DONE: filed as request #131 (run #7, confidence 0.8), open at /w/northwind/dashboard/p/feature/131. Title: Export.', received),
      model: model as never,
    });

    expect(model.bound[0]?.opts).toEqual({ tool_choice: 'propose_action' });
    expect(String((model.seen[0]![1] as { content: unknown }).content)).toContain('export the viewer list as a CSV');
    expect(received).toHaveLength(1);
    expect(res).toMatchObject({ filed: true, line: 'Filed from this conversation: [request #131](/w/northwind/dashboard/p/feature/131).' });
  });

  it('a refused first call gets one more try with the refusal in front of it', async () => {
    const received: unknown[] = [];
    const cut = '{"objectType":"request","title":"Export the viewer list","extractionNotes":"Filed from chat, 2026-';
    const model = modelMaking([
      { action_id: 'objects.propose_candidate', action_input: cut },
      { action_id: 'objects.propose_candidate', action_input: PAYLOAD, ...ENVELOPE },
    ]);
    const res = await fileOwedWrite({
      request: 'File a feature request: export the viewer list.',
      history: [],
      answer: '',
      tool: proposeTool('Proposed objects.propose_candidate → action run #9 is PENDING human approval in the review queue (confidence 0.8).', received),
      model: model as never,
    });

    expect(model.seen).toHaveLength(2);

    const refusal = model.seen[1]!.at(-1) as { content: unknown };

    expect(String(refusal.content)).toContain('action_input was cut off after');
    expect(res.filed).toBe(true);
    expect(received).toHaveLength(1);
  });

  it('gives up after two refusals and says why', async () => {
    const model = modelMaking([{ action_id: 'objects.propose_candidate' }, { action_id: 'objects.propose_candidate' }]);
    const res = await fileOwedWrite({ request: 'File it.', history: [], answer: '', tool: proposeTool('unused', []), model: model as never });

    expect(res.filed).toBe(false);
    expect(res.output).toMatch(/^Not recorded: invalid arguments for propose_action/);
  });
});

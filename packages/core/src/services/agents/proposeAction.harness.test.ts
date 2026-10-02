/**
 * A BROKEN propose_action CALL, THROUGH A REAL deepagents LOOP.
 *
 * Conversation 349 (2026-09-28): the product manager's propose_action arrived
 * with `action_input` as a 1,588-character JSON string that stopped mid-value
 * and no envelope at all; LangChain refused it before the tool ran, and the
 * refusal the model got was the schema's own list of paths. Here the graph,
 * the tool node, the tool-call wrapper and the schema are all real — only the
 * model is written down — so what is asserted is what a turn does:
 *
 *   - a string payload the model plainly meant is parsed and the tool runs;
 *   - a cut payload is refused in words that name the cut and each missing
 *     field, the refusal reaches the rail, and the row keeps why the model
 *     stopped (`stop_reason`);
 *   - after the refusal the model gets another step, and its answer lands.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { RuntimeContext } from './types';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { explainProposeActionMiss, normalizeProposeActionArgs, proposeActionArgsSchema } from '@/libs/actions/proposeActionArgs';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { toolCallSchema } = await import('@/models/Schema');
const { withArgumentRepair, withToolCallRecord } = await import('./toolCallRecord');

const ORG = 'org_propose_harness';

/** A model that plays two steps: the call it is given, then an answer; it keeps what it was shown. */
class TwoStepModel extends BaseChatModel {
  seen: BaseMessage[][] = [];
  constructor(private readonly first: AIMessage) {
    super({});
  }

  _llmType(): string {
    return 'two-step';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const message = this.seen.length === 1 ? this.first : new AIMessage({ content: 'It was not filed; I will send it again as an object.' });
    return { generations: [{ text: '', message }] };
  }
}

/**
 * propose_action as the registry builds it — the real schema and repair, a
 * body that records what it was given.
 * @param ctx - The turn's context.
 * @param received - Where the body puts the arguments it ran with.
 */
function proposeTool(ctx: RuntimeContext, received: unknown[]) {
  const t = tool(async (input) => {
    received.push(input);
    return 'Proposed objects.propose_candidate → action run #7 is PENDING human approval in the review queue (confidence 0.8).';
  }, { name: 'propose_action', description: 'Propose an action.', schema: proposeActionArgsSchema });
  return withToolCallRecord(withArgumentRepair(t, { normalizeArgs: normalizeProposeActionArgs, explainSchemaMiss: explainProposeActionMiss }) as never, ctx);
}

function ctxFor(events: unknown[]): RuntimeContext {
  return {
    orgId: ORG,
    agentSlug: 'product-manager',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: (e: unknown) => events.push(e),
    provider: 'local',
    delegations: new Map(),
  } as unknown as RuntimeContext;
}

async function runTurn(model: TwoStepModel, t: ReturnType<typeof proposeTool>): Promise<string> {
  const graph = createDeepAgent({ model, tools: [t as never] });
  const out = await graph.invoke({ messages: [{ role: 'user', content: 'File a feature request: export the viewer list as a CSV.' }] } as never) as { messages: BaseMessage[] };
  const last = out.messages.at(-1);
  return typeof last?.content === 'string' ? last.content : '';
}

const ENVELOPE = { confidence: 0.8, rationale: 'Northwind asked for it.', suggested_decision: 'approve', suggested_decision_reason: 'Asked for twice this month.' };
const PAYLOAD = { objectType: 'request', title: 'Export the viewer list', fields: { product: 'send', kind: 'feature' } };

beforeEach(async () => {
  await db.delete(toolCallSchema).where(eq(toolCallSchema.orgId, ORG));
});

describe('propose_action in a real loop', () => {
  it('runs a call whose action_input came as a JSON string, with the object the model meant', async () => {
    const received: unknown[] = [];
    const model = new TwoStepModel(new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'propose_action', args: { action_id: 'objects.propose_candidate', action_input: JSON.stringify(PAYLOAD), ...ENVELOPE } }] }));

    await runTurn(model, proposeTool(ctxFor([]), received));

    expect(received).toHaveLength(1);
    expect((received[0] as { action_input: unknown }).action_input).toEqual(PAYLOAD);
  });

  it('refuses a cut call in words that name the cut, says so on the rail, records why the model stopped, and the turn goes on', async () => {
    const received: unknown[] = [];
    const events: Array<{ type?: string; message?: string }> = [];
    const cut = `{"objectType":"request","title":"Export the viewer list","fields":{"body":"${'Founders copy the list by hand. '.repeat(48)}"},"extractionNotes":"Filed from chat, 2026-`;
    const model = new TwoStepModel(new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_cut', name: 'propose_action', args: { action_id: 'objects.propose_candidate', action_input: cut } }],
      response_metadata: { stop_reason: 'max_tokens' },
    }));

    const answer = await runTurn(model, proposeTool(ctxFor(events), received));

    // Nothing ran.
    expect(received).toHaveLength(0);
    // The model was given one more step, and what it saw was our refusal.
    expect(model.seen).toHaveLength(2);

    const refusal = model.seen[1]!.find(m => m.getType() === 'tool');
    const text = String(refusal?.content);

    expect(text).toContain(`action_input was cut off after ${cut.length.toLocaleString('en-US')} characters`);
    expect(text).toContain('send it again, shorter, as an object, not a string');
    expect(text).toContain('confidence (a number 0–1), rationale');
    expect(text).toContain('Your message reached its output limit while writing this call');
    expect(text).not.toContain('expected record, received string');
    // The answer after the refusal is the turn's answer.
    expect(answer).toBe('It was not filed; I will send it again as an object.');
    // The person's rail says so: LangChain refused before any tool event.
    expect(events.some(e => e.type === 'tool_error' && e.message?.includes('cut off after'))).toBe(true);

    await vi.waitFor(async () => {
      const [row] = await db.select().from(toolCallSchema).where(eq(toolCallSchema.orgId, ORG));

      expect(row?.error).toContain('did not match expected schema');
      expect(row?.error).toContain('[stop_reason: max_tokens]');
      // The row keeps the call as it arrived — the evidence of what was sent.
      expect((row?.input as { action_input?: unknown }).action_input).toBe(cut);
    });
  });
});

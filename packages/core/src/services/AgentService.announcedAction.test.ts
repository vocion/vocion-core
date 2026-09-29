/**
 * Conversation 378 (2026-09-29), in the turn loop. "approve, fix and run" on
 * request #201's page; the turn explained and ENDED on "Let me write the plan
 * now." The loop re-enters once with its tools, the announcement as its own
 * last words and the person's instruction in front of it — and only when the
 * person asked for the act. A write that lands in a turn on a record's page
 * is announced as a version beneath that record, so the page refetches.
 *
 * The loop is a stand-in that streams what each pass says (the pattern of
 * `AgentService.budgetStop.test.ts`).
 */
import type { AgentEvent } from '@/services/agents/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// What the person wants and how each pass ended are a model's reading
// (`agents/turnJudge.ts`); each test says what that reading is.
const judge = vi.hoisted(() => ({ intent: {} as Record<string, unknown>, readings: [] as Array<Record<string, unknown>> }));
vi.mock('@/services/agents/turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/agents/turnJudge')>();
  return {
    ...real,
    readIntent: vi.fn(async () => ({ ...real.NO_INTENT, ...judge.intent })),
    judgeAnswer: vi.fn(async () => ({ ...real.NO_JUDGEMENT, ...(judge.readings.shift() ?? {}) })),
  };
});

const streamEvents = vi.fn();

vi.mock('@/services/agents/harness', () => ({
  chatModelOptionsFor: () => ({}),
  chatModelOptionsWithOverride: (_h: unknown, o?: { model: string }) => (o ? { ...o } : {}),
  buildInitialFiles: vi.fn(async () => ({})),
  compileAgentForRequest: vi.fn(async () => ({
    graph: { streamEvents },
    agentRow: { id: 1, slug: 'product-manager', name: 'Product manager', systemPrompt: 'Be useful.', harnessConfig: {} },
    ctx: { delegations: new Map() },
  })),
}));

vi.mock('@/libs/Langfuse', () => ({
  createLangfuseCallback: vi.fn(() => ({ handler: {}, trace: { id: 'trace-1', update: vi.fn() } })),
  flushTraces: vi.fn(async () => {}),
}));

vi.mock('@/services/BudgetService', () => ({ preflightCheck: vi.fn(async () => ({ ok: true })), chargeUsage: vi.fn(async () => {}) }));

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');

const ORG = 'org_announced_action';

const EXPLAINED = 'The run failed because the contract touches two packages without an approved plan, and the factory requires one any time allowed paths span more than one package. Plan #215 carries it now.';

type Pass = Array<Record<string, unknown>>;
const say = (t: string) => ({ event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:m1' }, data: { chunk: { content: [{ type: 'text', text: t }] } } });
const toolEnd = (name: string, output: string) => ({ event: 'on_tool_end', name, run_id: `run-${name}`, metadata: { checkpoint_ns: 'tools:t1' }, data: { input: { requestId: 201 }, output: { content: output, status: 'success' } } });

/**
 * Each call to the graph streams the next pass; the inputs are kept.
 * @param all
 */
function passes(...all: Pass[]) {
  const inputs: Array<{ messages: Array<{ role?: string; content?: unknown }> }> = [];
  streamEvents.mockReset().mockImplementation(async (input: (typeof inputs)[number]) => {
    inputs.push(input);
    const events = all.shift() ?? [say('Done.')];
    return { async* [Symbol.asyncIterator]() {
      yield* events;
    } };
  });
  return inputs;
}

async function run(message: string, pageContext?: unknown) {
  const events: AgentEvent[] = [];
  const result = await runAgentDeep({ orgId: ORG, agentSlug: 'product-manager', message, onEvent: e => void events.push(e), ...(pageContext ? { pageContext: pageContext as never } : {}) });
  return { result, events };
}

beforeEach(async () => {
  judge.intent = {};
  judge.readings = [];
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'product-manager', name: 'Product manager', systemPrompt: 'Be useful.', harnessConfig: {} } as never);
});

describe('a turn that ends on the move it announced', () => {
  it('continues once, with its tools, when the person asked for the act', async () => {
    const inputs = passes([say(`${EXPLAINED}\n\nLet me write the plan now.`)], [say('Approved proposal #5201; the build of #203 is running on plan #215.')]);
    judge.intent = { wants_action: true, decides: true };
    judge.readings = [{ ends_on_promise: true, promise: 'Let me write the plan now.' }];

    const { result } = await run('approve, fix and run');

    expect(inputs).toHaveLength(2);

    const nudge = String(inputs[1]!.messages.at(-1)!.content);

    expect(nudge).toContain('You ended your turn on "Let me write the plan now."');
    expect(nudge).toContain('"approve, fix and run"');
    expect(inputs[1]!.messages.at(-2)).toMatchObject({ role: 'assistant' });
    expect(result.response).toContain('Approved proposal #5201');
  });

  it('does not continue when the person asked a question — an offer is an answer to one', async () => {
    const inputs = passes([say(`${EXPLAINED}\n\nLet me write the plan now.`)]);

    await run('this is critical, what do we need to unblock and finish?');

    expect(inputs).toHaveLength(1);
  });

  it('never loops: a continuation that announces again is not continued a second time', async () => {
    const inputs = passes([say(`${EXPLAINED}\n\nLet me write the plan now.`)], [say(`${EXPLAINED}\n\nI'll put the card up now.`)]);
    judge.intent = { wants_action: true };
    judge.readings = [{ ends_on_promise: true, promise: 'Let me write the plan now.' }, { ends_on_promise: true, promise: 'I\'ll put the card up now.' }];

    await run('write it');

    expect(inputs).toHaveLength(2);
  });
});

describe('a write beneath the page\'s record reaches the page', () => {
  it('announces a version beneath request #201 when a plan is filed from its page, and names no version', async () => {
    passes([toolEnd('file_architecture_plan', 'architecture plan #230 is DONE: filed as architecture plan #230 (run #9001).'), say(`${EXPLAINED} Filed plan #230 for it.`)]);

    const { events, result } = await run('write the plan', { path: '/w/squatch/dashboard/p/feature/201', title: 'Request 201', record: { type: 'object', id: '201', label: 'request #201' } });

    const beneath = events.filter(e => e.type === 'version_written');

    expect(beneath).toEqual([{ type: 'version_written', ref: { type: 'object', id: '201', label: 'request #201' }, artifactId: 0, from: null, to: 0, related: 'file_architecture_plan' }]);
    expect(result.response).not.toMatch(/version 0|v0\b/);
  });

  it('announces nothing for a read, or off a record page', async () => {
    passes([toolEnd('read_object', '{"id":203}'), say(EXPLAINED)]);
    const read = await run('what next?', { path: '/w/squatch/dashboard/p/feature/201', title: 'Request 201', record: { type: 'object', id: '201' } });
    passes([toolEnd('file_architecture_plan', 'architecture plan #230 is DONE: filed as architecture plan #230 (run #9001).'), say(EXPLAINED)]);
    const off = await run('write the plan');

    expect(read.events.some(e => e.type === 'version_written')).toBe(false);
    expect(off.events.some(e => e.type === 'version_written')).toBe(false);
  });
});

describe('a re-entry continues the real conversation (conversation 384)', () => {
  it('hands the next pass the graph\'s own messages, with the results in the tool channel, and pastes no transcript', async () => {
    const state = [
      { role: 'user', content: 'Add branded share links to Northwind' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'lookup_objects', args: { type_slug: 'product' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: '[{"id":120,"title":"Northwind Share"}]' },
      { role: 'assistant', content: 'Let me read the capabilities page and open requests before filing.' },
    ];
    const inputs = passes(
      [toolEnd('lookup_objects', '[{"id":120,"title":"Northwind Share"}]'), say('Let me read the capabilities page and open requests before filing.'), { event: 'on_chain_end', name: 'LangGraph', parent_ids: [], data: { output: { messages: state } } }],
      [say('Branded share links are not built yet; request #88 asks for them. Build it when you are ready.')],
    );
    judge.readings = [{ answered: false, ends_on_promise: true, promise: 'Let me read the capabilities page and open requests before filing.' }];

    await run('Add branded share links to Northwind');

    expect(inputs).toHaveLength(2);

    const next = inputs[1]!.messages;

    expect(next.slice(0, state.length)).toEqual(state);
    expect(next).toHaveLength(state.length + 1);
    expect(next.at(-1)).toMatchObject({ role: 'user' });
    expect(JSON.stringify(next)).not.toContain('What your tool calls in this turn returned');
    expect(JSON.stringify(next)).not.toContain('### lookup_objects');
  });
});

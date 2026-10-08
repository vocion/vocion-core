/**
 * ONE READ, THEN THE TURN (CHAT-423, 2026-10-01). Five questions on a
 * feature's page filed two features, rewrote the one they were about,
 * rejected its merge and started three builds. What the person wants is read
 * once, before the turn runs (`agents/turnJudge.ts`): a question makes the
 * turn read-only (`agents/turnScope.ts`), and an act the person asked for that
 * wrote nothing gets one more pass — no other continuation.
 *
 * The loop is a stand-in that streams what each pass says (the pattern of
 * `AgentService.budgetStop.test.ts`).
 */
import type { AgentEvent } from '@/services/agents/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

// What the person wants is a model's reading (`agents/turnJudge.ts`); each test says what it is.
const judge = vi.hoisted(() => ({ intent: {} as Record<string, unknown> }));
vi.mock('@/services/agents/turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/agents/turnJudge')>();
  return {
    ...real,
    readIntent: vi.fn(async () => ({ asks: 'answer', changed_record_type: null, record_type: null, summary: '', ...judge.intent })),
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
const { REFUSAL_NOTICE, runAgentDeep, stopReasonOf } = await import('@/services/AgentService');
const { actionRunSchema } = await import('@/models/Schema');
const { proposeAction } = await import('@/services/ActionService');
const { noteWrite, writesRefused, READ_ONLY_RECEIPT } = await import('@/services/agents/turnScope');

const ORG = 'org_one_read';
const PERSON = 'usr-reader';

const EXPLAINED = 'The run failed because the contract touches two packages without an approved plan, and the factory requires one any time allowed paths span more than one package. Plan #215 carries it now.';

type Pass = Array<Record<string, unknown>> | (() => Promise<Array<Record<string, unknown>>>);
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
    const next = all.shift() ?? [say('Done.')];
    const events = typeof next === 'function' ? await next() : next;
    return { async* [Symbol.asyncIterator]() {
      yield* events;
    } };
  });
  return inputs;
}

async function run(message: string, pageContext?: unknown, userId?: string) {
  const events: AgentEvent[] = [];
  const result = await runAgentDeep({ orgId: ORG, agentSlug: 'product-manager', message, onEvent: e => void events.push(e), ...(pageContext ? { pageContext: pageContext as never } : {}), ...(userId ? { userId } : {}) });
  return { result, events };
}

beforeEach(async () => {
  judge.intent = {};
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'product-manager', name: 'Product manager', systemPrompt: 'Be useful.', harnessConfig: {} } as never);
});

const PAGE = { path: '/w/northwind/dashboard/p/feature/41', title: 'Send from a chat assistant', record: { type: 'object', id: '41', label: 'request #41' } };

// The five questions, as a person asked them on a built feature's page.
const QUESTIONS = [
  'how does this work without me manually registering an app with the assistant\'s platform?',
  'how do we implement this so it is globally available? and not require manual intervention for every user?',
  'i don\'t understand how to manually add it. what do I need to do to build and test this?',
  'just tell me. what did you build in request #41? how do i use it?',
  'that looks like old instructions. why aren\'t you pulling current docs when I ask questions like that?',
];

describe('a question is answered, and nothing is written (CHAT-423)', () => {
  it('runs each of the five questions in one pass, refuses every write at the seam, and answers', async () => {
    for (const question of QUESTIONS) {
      const tried: Array<{ refused: boolean; code: string | null }> = [];
      const inputs = passes(async () => {
        // The agent reaches for a write anyway: the seam refuses it before anything is stored.
        const err = await proposeAction({ orgId: ORG, actionId: 'objects.propose_candidate', input: { objectType: 'request', title: question }, principal: { kind: 'user', id: PERSON, role: 'member', scope: { orgId: ORG } } as never }).then(() => null, (e: { code?: string }) => e);
        tried.push({ refused: writesRefused(), code: err?.code ?? null });
        return [toolEnd('file_request', READ_ONLY_RECEIPT), say('Request #41 serves its schema at /v1/assistant/openapi.json; you create the assistant once and every user signs in on the consent screen.')];
      });

      const { result } = await run(question, PAGE, PERSON);

      expect(inputs).toHaveLength(1);
      expect(tried).toEqual([{ refused: true, code: 'read_only_turn' }]);
      expect(result.response).toContain('/v1/assistant/openapi.json');
    }

    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('a failed read changes nothing: the turn is not read-only', async () => {
    judge.intent = { unread: true };
    const seen: boolean[] = [];
    passes(async () => {
      seen.push(writesRefused());
      return [say('Here it is.')];
    });

    await run('what is this?', PAGE, PERSON);

    expect(seen).toEqual([false]);
  });
});

describe('a refusal is an outcome, not an empty pass', () => {
  it('ends the turn in one pass, asks no other model, and says the model declined', async () => {
    const declined = { event: 'on_chat_model_end', metadata: { checkpoint_ns: 'model_request:m1' }, data: { output: { content: [], response_metadata: { stop_reason: 'refusal' } } } };
    const inputs = passes([declined]);

    const { result } = await run(QUESTIONS[0]!, PAGE, PERSON);

    expect(inputs).toHaveLength(1);
    expect(result.response).toContain(REFUSAL_NOTICE);
  });

  it('a seat on another model gets one more pass on the main model, and the person hears its answer (Walk 12)', async () => {
    const declined = { event: 'on_chat_model_end', metadata: { checkpoint_ns: 'model_request:m1' }, data: { output: { content: [], response_metadata: { stop_reason: 'refusal' } } } };
    const inputs = passes([declined], [say('Filed FE-12 and started it.')]);
    const { compileAgentForRequest } = await import('@/services/agents/harness');
    const { resolvedModelId } = await import('@/libs/llm/langchain');

    const result = await runAgentDeep({ orgId: ORG, agentSlug: 'product-manager', message: 'Put a New badge on documents uploaded today.', onEvent: () => {}, userId: PERSON, modelOverride: { model: 'claude-opus-5-5' } });

    expect(inputs).toHaveLength(2);
    expect(result.response).toContain('Filed FE-12');
    expect(result.response).not.toContain(REFUSAL_NOTICE);
    expect(vi.mocked(compileAgentForRequest).mock.calls.at(-1)?.[3]).toMatchObject({ modelOverride: { model: resolvedModelId('main') } });
  });

  it('reads the stop reason the provider typed', () => {
    expect(stopReasonOf({ response_metadata: { stop_reason: 'refusal' } })).toBe('refusal');
    expect(stopReasonOf({ response_metadata: { stopReason: 'end_turn' } })).toBe('end_turn');
    expect(stopReasonOf({})).toBeNull();
  });
});

describe('an act the person asked for that wrote nothing gets one more pass, no more', () => {
  it('a change that landed ends the turn in one pass', async () => {
    judge.intent = { asks: 'change', changed_record_type: 'request', summary: 'add a size limit to request #41' };
    const inputs = passes(async () => {
      expect(writesRefused()).toBe(false);

      noteWrite();
      return [toolEnd('update_object', 'request #41 updated — acceptance written. Done for you; a person can undo it from Review › Decided.'), say('Added the size limit to request #41.')];
    });

    await run('change this request: add a 25 MB size limit', PAGE, PERSON);

    expect(inputs).toHaveLength(1);
  });

  it('a change that wrote nothing goes once more with what was asked, and never a third time', async () => {
    judge.intent = { asks: 'change', changed_record_type: 'request', summary: 'add a size limit to request #41' };
    const inputs = passes([say('I will add the size limit.')], [say('I could not: the field is locked.')]);

    const { result } = await run('change this request: add a 25 MB size limit', PAGE, PERSON);

    expect(inputs).toHaveLength(2);
    expect(String(inputs[1]!.messages.at(-1)!.content)).toBe('You were asked to add a size limit to request #41. Do it now with your tools, or say in one line why you can\'t. Never write a tool call as text.');
    expect(result.response).toContain('the field is locked');
  });

  it('a Decision answered on its card already landed: the asking agent is not told to "do it now"', async () => {
    const { answeredIntent } = await import('@/services/agents/turnJudge');
    const inputs = passes([say('Building in the Northwind API now.')]);

    await runAgentDeep({ orgId: ORG, agentSlug: 'product-manager', message: '[decision #41 answered] Which repo?\nChosen: Northwind API (option api)', onEvent: () => {}, userId: PERSON, intent: answeredIntent('Northwind API'), landedWrites: 1 });

    expect(inputs).toHaveLength(1);
  });

  it('an answer that only promises is not continued: the turn ends as written', async () => {
    const inputs = passes([say('Let me look into that.')]);

    await run('what is blocking request #41?', PAGE, PERSON);

    expect(inputs).toHaveLength(1);
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
    judge.intent = { asks: 'file', record_type: 'request', summary: 'file branded share links for Northwind' };

    await run('Add branded share links to Northwind', undefined, PERSON);

    expect(inputs).toHaveLength(2);

    const next = inputs[1]!.messages;

    expect(next.slice(0, state.length)).toEqual(state);
    expect(next).toHaveLength(state.length + 1);
    expect(next.at(-1)).toMatchObject({ role: 'user' });
    expect(JSON.stringify(next)).not.toContain('What your tool calls in this turn returned');
    expect(JSON.stringify(next)).not.toContain('### lookup_objects');
  });
});

describe('a head start the router did not pick', () => {
  it('writes nothing and ends dropped, even when its model reached for a write', async () => {
    const tried: Array<string | null> = [];
    passes(async () => {
      const err = await proposeAction({ orgId: ORG, actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'Uploads drop on cellular' }, principal: { kind: 'user', id: PERSON, role: 'member', scope: { orgId: ORG } } as never }).then(() => null, (e: Error) => e.name);
      tried.push(err);
      return [say('Filed it.')];
    });

    const turn = runAgentDeep({ orgId: ORG, agentSlug: 'product-manager', message: 'File the upload bug.', userId: PERSON, hold: Promise.resolve(false), onEvent: () => {} });

    await expect(turn).rejects.toThrow(/did not pick/);
    expect(tried).toEqual(['HeadStartDropped']);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });
});

/**
 * The card pass, on the scripted model: a small list call, then one call per
 * card, all in flight at once, each card on screen the moment its own call
 * returns (Chris, 2026-09-25/28: "why does it take 40 seconds to render the card").
 *
 * The model is `ScriptedChatModel` — the script names the list reply and each
 * card's tool call; the real `recommend_action` tool runs and emits. Timing is
 * made visible by holding each writer back a known number of milliseconds.
 */
import type { CardBackstopDeps } from './cardBackstop';
import type { AgentEvent, RuntimeContext } from './types';
import type { Script } from '@/libs/llm/scripted';
import { describe, expect, it, vi } from 'vitest';
import { ScriptedChatModel } from '@/libs/llm/scripted';
import { buildOrFiling, cardRulesOf, FILE_ACTION, isSameCard, parseTouches, runCardBackstop } from './cardBackstop';
import { cardRecordRef, recommendActionTool } from './tools/recommendAction';

vi.mock('@/services/objects/recordHref', () => ({
  recordHref: async (_org: string, ref: { objectType: string; id: number }) => `/w/kestrel/dashboard/p/${ref.objectType === 'request' ? 'feature' : 'objects'}/${ref.id}`,
}));

const ANSWER = `Seven customers lost uploads on cellular this week. ${'This is a data-loss bug on Send and it needs a fix now. '.repeat(6)}Approve the upload fix, tell Northwind, and defer the admin panel.`;

type Card = { label: string; args: Record<string, unknown>; delayMs: number };

const mail = (label: string, to: string, delayMs: number): Card => ({
  label,
  delayMs,
  args: { action_id: 'gmail.send', action_input: { to, subject: label, body: `${label} — the full ready-to-send body.`, draft: true }, label, rationale: 'named in the answer' },
});

/**
 * The scripted part: one list reply naming every card, then one tool call per card.
 * @param cards - The cards, in the order the list names them.
 */
function script(cards: Card[]): Script {
  return {
    turns: [
      ...cards.map(c => ({ match: `CARD FOR: ${c.label}`, steps: [{ tool: 'recommend_action', args: c.args }], reply: 'Done.' })),
      { match: 'LIST THE DECISIONS', steps: [], reply: JSON.stringify(cards.map(c => ({ label: c.label, why: 'named in the answer', action: c.args.action_id }))) },
    ],
    fallback: 'no line',
  };
}

/**
 * The pass wired to the scripted model and the real tool, with a clock.
 * @param cards - What the script says.
 * @param over - Deps to replace.
 */
function harness(cards: Card[], over: Partial<CardBackstopDeps> = {}) {
  const t0 = Date.now();
  const log: Array<{ at: number; what: string }> = [];
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent): void => {
    events.push(e);
    if (e.type === 'recommended_action') {
      log.push({ at: Date.now() - t0, what: `on screen: ${e.recommendation.label}` });
    }
  };
  const scripted = new ScriptedChatModel({ script: script(cards) });
  const ctx = { orgId: 'org_cards', agentSlug: 'product-manager', emit } as unknown as RuntimeContext;
  const charge = vi.fn(async () => {});
  const record = vi.fn(async () => {});
  const deps: CardBackstopDeps = {
    listModel: async () => scripted,
    // Each writer is the scripted model, held back by its card's delay, so the
    // order the calls START and FINISH is on the record.
    cardModel: async () => ({
      bindTools: (tools: unknown[], opts?: unknown) => ({
        invoke: async (messages: Array<{ content: unknown }>, options?: unknown) => {
          const human = String(messages.at(-1)?.content ?? '');
          const card = cards.find(c => human.startsWith(`CARD FOR: ${c.label}\n`))!;
          log.push({ at: Date.now() - t0, what: `starts: ${card.label}` });
          await new Promise(r => setTimeout(r, card.delayMs));
          void opts;
          const out = await scripted.bindTools(tools as never).invoke(messages as never, options as never);
          log.push({ at: Date.now() - t0, what: `returns: ${card.label}` });
          return out;
        },
      }),
    }) as never,
    tool: actionIds => recommendActionTool(ctx, { actionIds }),
    actionCatalog: () => 'gmail.send — Send an email.\nfactory.dispatch_task — Start the build.\nobjects.propose_candidate — File a record.',
    hasAction: id => ['gmail.send', 'factory.dispatch_task', 'objects.propose_candidate'].includes(id),
    precheck: async () => undefined,
    requestExists: async () => false,
    charge,
    record,
    emit,
    log: () => {},
    ...over,
  };
  return { deps, log, events, charge, record, elapsed: () => Date.now() - t0 };
}

describe('the card pass writes every card at once, on the scripted model', () => {
  it('dispatches every card call before any returns, and emits each card as its own call completes', async () => {
    const cards = [mail('Approve the upload fix', 'ops@northwind.example', 120), mail('Tell Northwind it is fixed', 'cs@northwind.example', 10), mail('Defer the admin panel', 'pm@northwind.example', 60)];
    const h = harness(cards);

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'You are the PM. Put decisions up as cards.' }, h.deps);

    expect(out).toMatchObject({ listed: 3, emitted: 3, refused: 0, notes: [] });

    const whats = h.log.map(l => l.what);

    // Parallel: all three calls started before the first one returned.
    const firstReturn = whats.findIndex(w => w.startsWith('returns:'));

    expect(whats.slice(0, firstReturn).filter(w => w.startsWith('starts:'))).toHaveLength(3);
    // Per card: each card is on screen right after ITS call — fastest first.
    expect(whats.filter(w => !w.startsWith('starts:'))).toEqual([
      'returns: Tell Northwind it is fixed',
      'on screen: Tell Northwind it is fixed',
      'returns: Defer the admin panel',
      'on screen: Defer the admin panel',
      'returns: Approve the upload fix',
      'on screen: Approve the upload fix',
    ]);
    // The status line counts, and never sits on one label.
    expect(h.events.filter(e => e.type === 'status').map(e => (e as { label: string }).label)).toEqual([
      'Finding the decisions in the answer',
      'Writing 3 decision cards · 0 of 3 ready',
      'Writing 3 decision cards · 1 of 3 ready',
      'Writing 3 decision cards · 2 of 3 ready',
      '3 of 3 decision cards ready',
    ]);
  });

  it('puts the first card up before the last card\'s call resolves, and the pass takes the slowest card, not the sum', async () => {
    const cards = [mail('Approve the upload fix', 'ops@northwind.example', 200), mail('Tell Northwind it is fixed', 'cs@northwind.example', 20), mail('Defer the admin panel', 'pm@northwind.example', 80)];
    const h = harness(cards);

    await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);
    const total = h.elapsed();

    const firstCard = h.log.find(l => l.what.startsWith('on screen:'))!;
    const lastReturn = h.log.findLast(l => l.what.startsWith('returns:'))!;

    expect(firstCard.at).toBeLessThan(lastReturn.at);
    expect(lastReturn.at - firstCard.at).toBeGreaterThanOrEqual(150);
    // In sequence this would be 300ms of writing; in parallel it is ~200.
    expect(total).toBeLessThan(290);
  });

  it('charges every model call and writes a tool_call row for every card attempt', async () => {
    const cards = [mail('Approve the upload fix', 'ops@northwind.example', 5), mail('Defer the admin panel', 'pm@northwind.example', 5)];
    const h = harness(cards);

    await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);

    expect(h.charge.mock.calls.map(c => (c as unknown[])[0])).toEqual(['classifier', 'extractor', 'extractor']);
    expect(h.record).toHaveBeenCalledTimes(2);
    expect(h.record.mock.calls.every(c => typeof ((c as unknown[])[0] as { output?: string }).output === 'string')).toBe(true);
  });

  it('never writes a card already on screen — not from the list, not from a writer that renamed it', async () => {
    const cards = [mail('Approve the upload fix', 'ops@northwind.example', 5), mail('Defer the admin panel', 'pm@northwind.example', 5)];
    const h = harness(cards);

    const out = await runCardBackstop({ answer: ANSWER, already: ['Approve the upload fix'], agentPrompt: 'Cards.' }, h.deps);

    expect(out.emitted).toBe(1);
    expect(h.events.filter(e => e.type === 'recommended_action').map(e => (e as { recommendation: { label: string } }).recommendation.label)).toEqual(['Defer the admin panel']);
    expect(h.charge).toHaveBeenCalledTimes(2);
  });

  it('a card its action refuses is no card at all: one line for under the answer, a tool_call row saying why', async () => {
    const cards = [mail('Approve the upload fix', 'ops@northwind.example', 5)];
    const h = harness(cards, { precheck: async () => 'the mailbox is not connected' });

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);

    expect(h.events.some(e => e.type === 'recommended_action')).toBe(false);
    expect(out).toMatchObject({ emitted: 0, refused: 1 });
    expect(out.notes).toEqual(['- **Approve the upload fix** — not a card: the mailbox is not connected.']);
    expect((h.record.mock.calls[0] as unknown[])[0]).toMatchObject({ error: 'not put up: the mailbox is not connected' });
  });

  it('one card\'s failed call is that card\'s alone: the others go up and the count finishes', async () => {
    const cards = [mail('Approve the upload fix', 'ops@northwind.example', 5), mail('Defer the admin panel', 'pm@northwind.example', 5)];
    const h = harness(cards);
    const real = h.deps.cardModel;
    let n = 0;
    h.deps.cardModel = async () => {
      n += 1;
      if (n === 1) {
        return { bindTools: () => ({ invoke: async () => {
          throw new Error('socket hang up');
        } }) } as never;
      }
      return real();
    };

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);

    expect(out.emitted).toBe(1);
    expect(h.events.filter(e => e.type === 'status').at(-1)).toEqual({ type: 'status', label: '1 of 1 decision card ready' });
  });

  it('a card with no action is a line, not a card with nothing to press', async () => {
    const note: Card = { label: 'Call Nadia this week', delayMs: 5, args: { action_id: '', action_input: {}, label: 'Call Nadia this week' } };
    const h = harness([note]);

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);

    expect(h.events.some(e => e.type === 'recommended_action')).toBe(false);
    expect(out.notes[0]).toMatch(/Call Nadia this week\*\* — not a card: no action can carry it/);
  });
});

describe('a build of something nobody filed is a filing (conversation 351, 2026-09-28)', () => {
  const dispatch: Card = {
    label: 'Dispatch: link expiry & auto-disable',
    delayMs: 5,
    args: { action_id: 'factory.dispatch_task', action_input: { contract: { objective: 'Links stop working after a date the sender picks.' } }, label: 'Dispatch: link expiry & auto-disable', rationale: 'asked twice this month' },
  };

  it('turns the build into objects.propose_candidate, and a filing gate\'s refusal means NO card, with the reason', async () => {
    const seen: Array<{ id: string; input: Record<string, unknown> }> = [];
    const h = harness([dispatch], {
      precheck: async (id, input) => {
        seen.push({ id, input });
        return id === FILE_ACTION ? 'Not proposed: this request fails the "still-missing" bar: gapCheck.finding: the gap check found this already ships' : undefined;
      },
    });

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);

    expect(seen).toEqual([{ id: FILE_ACTION, input: expect.objectContaining({ objectType: 'request', title: 'link expiry & auto-disable', dedupOn: ['title'] }) }]);
    expect(h.events.some(e => e.type === 'recommended_action')).toBe(false);
    expect(out).toMatchObject({ mapped: 1, refused: 1, emitted: 0 });
    expect(out.notes[0]).toMatch(/not a card: this request fails the "still-missing" bar: gapCheck\.finding: the gap check found this already ships/);
  });

  it('a filing its gates accept goes up as "File as a feature request"', async () => {
    const h = harness([dispatch]);

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);
    const card = h.events.find(e => e.type === 'recommended_action') as Extract<AgentEvent, { type: 'recommended_action' }>;

    expect(out.emitted).toBe(1);
    expect(card.recommendation).toMatchObject({ actionId: FILE_ACTION, label: 'File as a feature request: link expiry & auto-disable' });
  });

  it('a build that names a real request stays a Build card, and links to the feature page', async () => {
    const build: Card = { ...dispatch, label: 'Approve build: link expiry', args: { ...dispatch.args, label: 'Approve build: link expiry', action_input: { requestId: 201 } } };
    const h = harness([build], { requestExists: async id => id === 201 });

    await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);
    const card = h.events.find(e => e.type === 'recommended_action') as Extract<AgentEvent, { type: 'recommended_action' }>;

    expect(card.recommendation).toMatchObject({ actionId: 'factory.dispatch_task', input: { requestId: 201 }, href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });
  });

  it('maps only an unfiled build', async () => {
    const shaped = { action_id: 'factory.dispatch_task', action_input: { taskId: 9 }, label: 'Build it' };

    expect((await buildOrFiling(shaped, async () => false)).mapped).toBe(false);
    expect((await buildOrFiling({ ...shaped, action_input: { requestId: 12 } }, async () => false)).mapped).toBe(true);
    expect((await buildOrFiling({ ...shaped, action_id: 'gmail.send' }, async () => false)).mapped).toBe(false);
  });
});

describe('a filing card is written through file_<type>, and one that misses the bar is drafted, not dropped (conversation 355)', () => {
  const LABEL = 'File in-app notifications as its own request in core';
  // The card as the writer filled it in production: free-form fields, no story, no acceptance.
  const filingCard: Card = {
    label: LABEL,
    delayMs: 0,
    args: { action_id: FILE_ACTION, action_input: { objectType: 'request', title: 'Add in-app notifications to core', fields: { product: 'vocion', kind: 'gap' }, dedupOn: ['title', 'product'] }, label: LABEL, rationale: 'Split out of 124 when push was cut.' },
  };
  const BAR = 'Not proposed: this request fails the "proposal-ready" bar: story: write the story as one person in their words; acceptance: write three to six acceptance lines a person can check on the screen';
  const hasBar = (input: Record<string, unknown>) => {
    const f = (input.fields ?? {}) as Record<string, unknown>;
    return typeof f.story === 'string' && Array.isArray(f.acceptance) && f.acceptance.length >= 3;
  };

  /**
   * The typed filing tool, schema only, and a card writer that answers the
   * typed pass with `typedArgs` and the card pass with the card as written.
   * @param typedArgs - What the model writes into file_request, or null for no call.
   */
  function typed(typedArgs: Record<string, unknown> | null) {
    const bound: string[] = [];
    const typedTool = { name: 'file_request' } as never;
    const filingTool: CardBackstopDeps['filingTool'] = objectType => (objectType === 'request'
      ? { tool: typedTool, label: 'request', input: args => ({ objectType: 'request', title: String(args.title ?? ''), fields: { ...args, title: String(args.title ?? '') }, dedupOn: ['title'] }) }
      : undefined);
    const cardModel = async () => ({
      bindTools: (_tools: unknown[], opts?: { tool_choice?: string }) => {
        bound.push(String(opts?.tool_choice ?? ''));
        return {
          invoke: async () => (opts?.tool_choice === 'file_request'
            ? { content: '', tool_calls: typedArgs ? [{ name: 'file_request', args: typedArgs }] : [] }
            : { content: '', tool_calls: [{ name: 'recommend_action', args: filingCard.args }] }),
        };
      },
    }) as never;
    return { bound, filingTool, cardModel };
  }

  it('the typed pass writes story, outcome and acceptance from the conversation, and the card carries them', async () => {
    const t = typed({ title: 'Add in-app notifications to core', story: 'As a founder, I want to see what happened in the app without checking my email.', outcome: 'Every event that emails also shows in an in-app list.', acceptance: [{ statement: 'A list shows each notification.' }, { statement: 'Each can be marked read.' }, { statement: 'No push anywhere.' }], product: 'vocion' });
    const h = harness([filingCard], { filingTool: t.filingTool, cardModel: t.cardModel, precheck: async (_id, input) => (hasBar(input) ? undefined : BAR) });

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.', conversation: 'Person: remove push notifications from scope' }, h.deps);
    const card = h.events.find(e => e.type === 'recommended_action') as Extract<AgentEvent, { type: 'recommended_action' }>;

    expect(t.bound).toContain('file_request');
    expect(out).toMatchObject({ emitted: 1, typed: 1, drafts: 0, notes: [] });
    expect(card.recommendation).toMatchObject({ actionId: FILE_ACTION, label: LABEL, input: { objectType: 'request', fields: { story: expect.stringContaining('As a founder'), acceptance: expect.any(Array) } } });
    expect(card.recommendation.draft).toBeUndefined();
  });

  it('still missing the bar, the card says Draft needed with a prompt that asks for the whole request — never a dead line', async () => {
    const t = typed({ title: 'Add in-app notifications to core', product: 'vocion' });
    const h = harness([filingCard], { filingTool: t.filingTool, cardModel: t.cardModel, precheck: async (_id, input) => (hasBar(input) ? undefined : BAR) });

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);
    const card = h.events.find(e => e.type === 'recommended_action') as Extract<AgentEvent, { type: 'recommended_action' }>;

    expect(out).toMatchObject({ emitted: 1, drafts: 1, refused: 0, notes: [] });
    expect(card.recommendation.draft).toEqual({
      missing: 'this request fails the "proposal-ready" bar: story: write the story as one person in their words; acceptance: write three to six acceptance lines a person can check on the screen',
      prompt: 'Draft the full request "Add in-app notifications to core" from this conversation — this request fails the "proposal-ready" bar: story: write the story as one person in their words; acceptance: write three to six acceptance lines a person can check on the screen. Write every field it needs, in my words where I gave them, then file it.',
    });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ output: expect.stringMatching(/^draft needed: /) }));
  });

  it('an agent without a typed tool keeps the old behaviour: the refusal is one line', async () => {
    const h = harness([filingCard], { precheck: async () => BAR });

    const out = await runCardBackstop({ answer: ANSWER, already: [], agentPrompt: 'Cards.' }, h.deps);

    expect(out).toMatchObject({ emitted: 0, refused: 1 });
    expect(out.notes[0]).toMatch(/not a card: this request fails the "proposal-ready" bar/);
  });
});

describe('the pieces', () => {
  it('reads the list leniently and drops what is not a decision', () => {
    expect(parseTouches('Here: [{"label":"Approve it","why":"now","action":"gmail.send"},{"why":"no label"}] done')).toEqual([{ label: 'Approve it', why: 'now', actionId: 'gmail.send' }]);
    expect(parseTouches('none')).toEqual([]);
    expect(parseTouches('[not json')).toEqual([]);
  });

  it('knows a card already on screen by its words', () => {
    expect(isSameCard('Approve the upload fix', ['approve the upload fix!'])).toBe(true);
    expect(isSameCard('Approve the upload fix today', ['Approve the upload fix'])).toBe(true);
    expect(isSameCard('Defer it', ['Approve it'])).toBe(false);
  });

  it('hands a writer the whole of a small prompt, and the card paragraphs of a large one', () => {
    expect(cardRulesOf('Be useful.')).toBe('Be useful.');

    const big = ['You are the PM.', 'You speak plainly.', ...Array.from({ length: 400 }, (_, i) => `Filler paragraph ${i} about planning cadence and nothing else at all here.`), 'Anything a person should decide is a CARD (`recommend_action`).'].join('\n\n');
    const rules = cardRulesOf(big);

    expect(rules).toContain('You are the PM.');
    expect(rules).toContain('is a CARD (`recommend_action`)');
    expect(rules).not.toContain('Filler paragraph 3 ');
  });

  it('knows which record a card is about', () => {
    expect(cardRecordRef({ requestId: '201' })).toEqual({ objectType: 'request', id: 201 });
    expect(cardRecordRef({ objectType: 'deal', id: 7 })).toEqual({ objectType: 'deal', id: 7 });
    expect(cardRecordRef({ to: 'a@b.example' })).toBeNull();
  });
});

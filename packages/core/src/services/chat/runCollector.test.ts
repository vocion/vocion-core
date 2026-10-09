import { describe, expect, it } from 'vitest';
import { RunCollector } from './runCollector';

/**
 * What a RELOADED transcript says about a turn that went wrong.
 *
 * The turn this was written for persisted `trace_json` with exactly one node —
 * `{ kind: 'delegate', status: 'start' }` — and nothing about the failure that
 * ended it. Two gaps, both here: the collector had no case for `tool_error`,
 * and the emitter never produced a terminal node for it to merge.
 */
describe('RunCollector', () => {
  it('merges a trace node by id, so the persisted trace ends where the live one did', () => {
    const c = new RunCollector();
    c.onTraceNode({ type: 'trace_node', id: 'task-1', kind: 'delegate', status: 'start', label: 'Delegating to Pipeline Analyst', detail: 'Full pipeline read' });
    c.onTraceNode({ type: 'trace_node', id: 'task-1', kind: 'delegate', status: 'error', label: 'Pipeline Analyst could not finish', result: 'the specialist could not be reached' });

    const { trace } = c.finalise();

    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({ id: 'task-1', status: 'error', result: 'the specialist could not be reached' });
    // The `start` event's detail survives the merge — a terminal event that
    // carries only a status must not blank what the surface already showed.
    expect(trace[0]?.detail).toBe('Full pipeline read');
  });

  it('persists a tool failure as a failed step rather than dropping it', () => {
    const c = new RunCollector();
    c.onTextDelta('Handing this to the analyst.');
    c.onToolError('task', 'the specialist could not be reached');

    const { runs, text } = c.finalise();

    expect(text).toBe('Handing this to the analyst.');

    const failed = runs.filter(r => r.type === 'tool' && r.state === 'error');

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: 'task', output: 'the specialist could not be reached' });
  });

  it('closes an in-flight step rather than appending a second row for it', () => {
    const c = new RunCollector();
    c.onToolStart('lookup_objects', { type_slug: 'deal' });
    c.onToolError('lookup_objects', 'object type not found');

    const { runs } = c.finalise();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ type: 'tool', name: 'lookup_objects', state: 'error', output: 'object type not found' });
  });

  it('keeps a step that landed as a landed step', () => {
    const c = new RunCollector();
    c.onToolStart('search_knowledge', { query: 'renewals' });
    c.onToolEnd('search_knowledge', '[1] **A note** [granola]');

    const { runs } = c.finalise();

    expect(runs[0]).toMatchObject({ name: 'search_knowledge', output: '[1] **A note** [granola]' });
    expect((runs[0] as { state?: string }).state).toBeUndefined();
  });

  it('records the artifacts a turn touched, ignoring the pending shell', () => {
    const c = new RunCollector();
    c.onArtifact(12);
    c.onArtifact(12);
    c.onArtifact(-1);

    expect(c.touchedArtifactIds).toEqual([12]);
  });

  it('links the answer\'s record mentions in the stored text, and keeps a card\'s record link (2026-09-28)', () => {
    const c = new RunCollector();
    c.onTextDelta('Build #201 next.');
    c.onCard({ label: 'Approve build: link expiry', actionId: 'factory.dispatch_task', input: { requestId: 201 }, href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });
    c.onTextDelta('Then request 202.');
    c.onRecordLinks([{ text: '#201', href: '/w/kestrel/dashboard/p/feature/201' }, { text: 'request 202', href: '/w/kestrel/dashboard/p/feature/202' }]);

    const { text, runs } = c.finalise();

    expect(text).toBe('Build [#201](/w/kestrel/dashboard/p/feature/201) next.\n\nThen [request 202](/w/kestrel/dashboard/p/feature/202).');
    expect(runs.find(r => r.type === 'card')).toMatchObject({ href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' });
    // Finalised twice (the done event, then the write): the same text.
    expect(c.finalise().text).toBe(text);
  });

  it('stores a card\'s rationale so a reload can show why (#1080)', () => {
    const c = new RunCollector();
    c.onCard({ label: 'Connect GitHub', actionId: '', rationale: 'So the factory can read the repos.', href: '/dashboard/connectors?add=github' });

    expect(c.finalise().runs.find(r => r.type === 'card')).toMatchObject({ rationale: 'So the factory can read the repos.' });
  });

  it('keeps everything a link card shows, so a reload draws the same card', () => {
    const c = new RunCollector();
    const link = {
      id: 'card_1',
      kind: 'link',
      label: 'Connect GitHub',
      actionId: '',
      body: 'Your repos live there.',
      fields: [{ label: 'Account', value: 'northwind' }],
      state: 'proposed',
      href: '/api/connect/github/start?connector=github',
      hrefLabel: 'Connect GitHub',
      secondaryHref: '/dashboard/connectors?add=github&paste=1',
      secondaryHrefLabel: 'Paste a token',
      lastAttempt: { at: '2026-10-01T16:12:00.000Z', reason: 'access_denied', summary: 'GitHub denied access' },
    };
    c.onCard(link);
    // The same card surfaced again, now carrying a newer attempt, is still one run.
    c.onCard({ ...link, lastAttempt: { at: '2026-10-01T16:20:00.000Z', reason: 'timeout', summary: 'GitHub did not answer' } });

    const runs = c.finalise().runs.filter(r => r.type === 'card');

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: 'card_1',
      kind: 'link',
      body: 'Your repos live there.',
      fields: [{ label: 'Account', value: 'northwind' }],
      href: '/api/connect/github/start?connector=github',
      hrefLabel: 'Connect GitHub',
      secondaryHref: '/dashboard/connectors?add=github&paste=1',
      secondaryHrefLabel: 'Paste a token',
      lastAttempt: { reason: 'access_denied', summary: 'GitHub denied access' },
    });
  });
});

describe('RunCollector — Decisions and Done receipts', () => {
  it('keeps one run per Decision a turn raised, with its state current', () => {
    const c = new RunCollector();
    c.onTextDelta('One question before I go on.');
    c.onDecision({ id: 41, question: 'Which repo should the factory build in?', state: 'open' });
    c.onDecision({ id: 41, question: 'Which repo should the factory build in?', state: 'expired' });

    expect(c.finalise().runs).toEqual([
      { type: 'text', text: 'One question before I go on.' },
      { type: 'decision', id: 41, question: 'Which repo should the factory build in?', state: 'expired' },
    ]);
  });

  it('keeps one receipt per run, so a reload shows the Done line — and its Undo only where it was real', () => {
    const c = new RunCollector();
    c.onReceipt({ runId: 7, actionId: 'objects.update_meta', label: 'Updated Northwind', undoable: true });
    c.onReceipt({ runId: 7, actionId: 'objects.update_meta', label: 'Updated Northwind', undoable: true });
    c.onReceipt({ runId: 8, actionId: 'gmail.send', label: 'Sent the follow-up', undoable: false });

    expect(c.finalise().runs).toEqual([
      { type: 'receipt', receipt: { runId: 7, actionId: 'objects.update_meta', label: 'Updated Northwind', undoable: true } },
      { type: 'receipt', receipt: { runId: 8, actionId: 'gmail.send', label: 'Sent the follow-up', undoable: false } },
    ]);
  });
});

describe('the follow-ups a turn ended with', () => {
  it('are kept after the text, one set per turn, so a reload draws the same pills', () => {
    const c = new RunCollector();
    c.onTextDelta('The quote went out.');
    c.onSuggestions([{ label: 'Old', prompt: 'Old' }]);
    c.onSuggestions([{ label: 'Draft the reply to Dana', prompt: 'Draft the reply to Dana' }]);

    expect(c.finalise().runs).toEqual([
      { type: 'text', text: 'The quote went out.' },
      { type: 'suggestions', items: [{ label: 'Draft the reply to Dana', prompt: 'Draft the reply to Dana' }] },
    ]);
  });
});

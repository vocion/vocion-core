import { describe, expect, it } from 'vitest';
import { extractChunk, parseCitations, TraceEmitter } from './traceEmitter';

/**
 * Event shapes below are copied from a real `streamEvents(v2)` capture
 * (src/scripts/dump-agent-events.ts) so the emitter is tested against what
 * the runtime actually produces — including SUBAGENT nesting via the
 * `tools:<taskId>|…` namespace.
 */

const TASK_ID = 'ed972b48-607f-520b-9487-11cf1b905f01';

function chunk(blocks: Array<{ type: string; text?: string; thinking?: string }>): unknown {
  return { content: blocks };
}

describe('extractChunk', () => {
  it('separates text from thinking blocks', () => {
    expect(extractChunk(chunk([{ type: 'text', text: 'hi' }, { type: 'thinking', thinking: 'hmm' }])))
      .toEqual({ text: 'hi', thinking: 'hmm' });
  });
  it('handles a plain string content', () => {
    expect(extractChunk({ content: 'plain' })).toEqual({ text: 'plain', thinking: '' });
  });
});

describe('parseCitations', () => {
  it('pulls title + sourceType + snippet from a search_knowledge result', () => {
    const content = '[1] **Gauge <> metacto — 2026-05-29** [granola] discussed referral pipeline\n[2] **Intro note** [gmail] follow-up owed';
    const cites = parseCitations(content, 'lead');
    expect(cites).toHaveLength(2);
    expect(cites[0]).toMatchObject({ title: 'Gauge <> metacto — 2026-05-29', sourceType: 'granola', actorId: 'lead' });
    expect(cites[1]).toMatchObject({ sourceType: 'gmail' });
  });
});

describe('traceEmitter — lead work', () => {
  it('emits a lead reason node (start then progress) from thinking chunks', () => {
    const em = new TraceEmitter({ leadName: 'Founder GTM Lead' });
    const ns = 'model_request:abc';
    const first = em.handle({ event: 'on_chat_model_stream', metadata: { checkpoint_ns: ns }, data: { chunk: chunk([{ type: 'thinking', thinking: 'Let me check' }]) } });
    const second = em.handle({ event: 'on_chat_model_stream', metadata: { checkpoint_ns: ns }, data: { chunk: chunk([{ type: 'thinking', thinking: ' the tracker.' }]) } });
    expect(first[0]).toMatchObject({ kind: 'reason', status: 'start', actor: { kind: 'lead' }, delta: 'Let me check' });
    expect(second[0]).toMatchObject({ status: 'progress', delta: ' the tracker.' });
    expect(first[0]?.actor.name).toBe('Founder GTM Lead');
  });

  it('ignores answer text (only thinking makes a reason node)', () => {
    const em = new TraceEmitter({ leadName: 'Lead' });
    const out = em.handle({ event: 'on_chat_model_stream', metadata: { checkpoint_ns: 'model_request:x' }, data: { chunk: chunk([{ type: 'text', text: 'Here is the answer' }]) } });
    expect(out).toHaveLength(0);
  });

  it('emits a search node with citations on tool end, attributed to the lead', () => {
    const em = new TraceEmitter({ leadName: 'Lead' });
    const start = em.handle({ event: 'on_tool_start', name: 'search_knowledge', metadata: { checkpoint_ns: 'tools:s1' }, data: { input: { input: '{"query":"Gauge follow-up"}' } } });
    expect(start[0]).toMatchObject({ kind: 'search', status: 'start', detail: '"Gauge follow-up"' });
    expect(start[0]?.label).toBe('Searching "Gauge follow-up"');

    const end = em.handle({ event: 'on_tool_end', name: 'search_knowledge', metadata: { checkpoint_ns: 'tools:s1' }, data: { output: { content: '[1] **Gauge <> metacto** [granola] pipeline talk' } } });
    expect(end[0]).toMatchObject({ kind: 'search', status: 'done', result: '1 source' });
    expect(end[0]?.citations?.[0]).toMatchObject({ title: 'Gauge <> metacto', sourceType: 'granola', actorId: 'lead' });
    expect(em.citations()).toHaveLength(1);
  });

  it('classifies run_operation as a skill node', () => {
    const em = new TraceEmitter({ leadName: 'Lead' });
    const out = em.handle({ event: 'on_tool_start', name: 'run_operation', metadata: { checkpoint_ns: 'tools:op1' }, data: { input: { input: '{"operation":"draft_follow_up"}' } } });
    expect(out[0]).toMatchObject({ kind: 'skill', status: 'start', detail: 'draft_follow_up' });
    expect(out[0]?.label).toBe('Running draft_follow_up');
  });

  it('drops plumbing tools (write_todos, ls, …)', () => {
    const em = new TraceEmitter({ leadName: 'Lead' });
    expect(em.handle({ event: 'on_tool_start', name: 'write_todos', metadata: { checkpoint_ns: 'tools:t' }, data: {} })).toHaveLength(0);
  });
});

describe('traceEmitter — delegation + nested specialist work', () => {
  it('opens a delegate node, then attributes the subagent\'s reasoning UNDER it', () => {
    const em = new TraceEmitter({ leadName: 'Founder GTM Lead' });

    // 1) Lead dispatches a specialist via the `task` tool.
    const del = em.handle({
      event: 'on_tool_start',
      name: 'task',
      metadata: { checkpoint_ns: `tools:${TASK_ID}` },
      data: { input: { input: JSON.stringify({ subagent_type: 'pipeline-analyst', description: 'Rank the Gauge follow-ups by ROI and return the top 3.' }) } },
    });
    expect(del[0]).toMatchObject({ id: TASK_ID, kind: 'delegate', status: 'start', actor: { kind: 'lead' } });
    expect(del[0]?.label).toBe('Delegating to Pipeline Analyst');

    // 2) The specialist reasons — ns is prefixed with tools:<taskId>| .
    const subReason = em.handle({
      event: 'on_chat_model_stream',
      metadata: { checkpoint_ns: `tools:${TASK_ID}|model_request:sub1` },
      data: { chunk: chunk([{ type: 'thinking', thinking: 'Comparing deal sizes…' }]) },
    });
    expect(subReason[0]).toMatchObject({ kind: 'reason', parentId: TASK_ID, actor: { kind: 'specialist', name: 'Pipeline Analyst' }, delta: 'Comparing deal sizes…' });

    // 3) The specialist runs its OWN search — citations attributed to the specialist and nested.
    const subSearchEnd = em.handle({
      event: 'on_tool_end',
      name: 'search_knowledge',
      metadata: { checkpoint_ns: `tools:${TASK_ID}|tools:subsearch` },
      data: { output: { content: '[1] **Gauge deal — $120k ARR** [hubspot] stage: proposal' } },
    });
    expect(subSearchEnd[0]).toMatchObject({ kind: 'search', parentId: TASK_ID, actor: { name: 'Pipeline Analyst' } });
    expect(subSearchEnd[0]?.citations?.[0]).toMatchObject({ sourceType: 'hubspot', actorId: TASK_ID });

    // 4) Delegation completes.
    const done = em.handle({ event: 'on_tool_end', name: 'task', metadata: { checkpoint_ns: `tools:${TASK_ID}` }, data: { output: { lg_name: 'Command', update: { messages: [] } } } });
    expect(done[0]).toMatchObject({ id: TASK_ID, kind: 'delegate', status: 'done' });
    expect(done[0]?.label).toBe('Pipeline Analyst finished');

    // The specialist's citation bubbled up to the message-level set.
    expect(em.citations().some(c => c.actorId === TASK_ID && c.sourceType === 'hubspot')).toBe(true);
  });

  it('mines a role name from the brief when subagent_type is generic', () => {
    const em = new TraceEmitter({ leadName: 'Lead' });
    const del = em.handle({
      event: 'on_tool_start',
      name: 'task',
      metadata: { checkpoint_ns: 'tools:gp1' },
      data: { input: { input: JSON.stringify({ subagent_type: 'general-purpose', description: 'You are a GTM ROI analyst for Metacto. Rank the follow-ups.' }) } },
    });
    expect(del[0]?.label).toBe('Delegating to GTM ROI Analyst');
  });
});

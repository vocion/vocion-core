import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { matchTurn, personLine, positionInTurn, resolveFileRefs, ScriptedChatModel, ScriptSchema, speechPieces } from './scripted';

const script = ScriptSchema.parse({
  turns: [
    { match: 'cut page 3', steps: [{ tool: 'edit_document', args: { ops: [{ op: 'remove_sheet', n: 3 }], change_summary: 'cut page 3' } }], reply: 'Cut it. 4 sheets now, verified.' },
    { match: 'draft the proposal', steps: [{ tool: 'read_data_room', args: {} }, { tool: 'render_document', args: { title: 'Northwind - Proposal', html: '<html/>' } }], reply: 'The proposal is open beside you.' },
  ],
  fallback: 'No line for that.',
});

const fakeTools = ['read_data_room', 'render_document', 'edit_document'].map(name => tool(async () => 'ok', { name, description: name, schema: z.object({}) }));

describe('ScriptedChatModel', () => {
  it('plays a turn as tool calls in order, then the reply', async () => {
    const model = new ScriptedChatModel({ script }).bindTools(fakeTools);
    const human = new HumanMessage('Draft the proposal for Northwind');
    const first = await model.invoke([human]);

    expect((first as AIMessage).tool_calls?.[0]?.name).toBe('read_data_room');

    const second = await model.invoke([human, first, new ToolMessage({ content: 'room…', tool_call_id: (first as AIMessage).tool_calls![0]!.id! })]);

    expect((second as AIMessage).tool_calls?.[0]?.name).toBe('render_document');
    expect((second as AIMessage).tool_calls?.[0]?.args).toMatchObject({ title: 'Northwind - Proposal' });

    const third = await model.invoke([human, first, new ToolMessage({ content: 'a', tool_call_id: 'x' }), second, new ToolMessage({ content: 'b', tool_call_id: 'y' })]);

    expect(third.content).toBe('The proposal is open beside you.');
    expect((third as AIMessage).tool_calls ?? []).toHaveLength(0);
  });

  it('matches the most recent human line, case-insensitively, first listed wins', () => {
    expect(matchTurn(script, 'Please CUT PAGE 3 now')?.reply).toContain('Cut it');
    expect(matchTurn(script, 'hello')).toBeNull();

    // The chat surface appends a page-context block that quotes the previous
    // line; only the person's own words count.
    const withContext = 'cut page 3\n\n--- where I am ---\nI am looking at "Draft the proposal for Northwind" in the app.';

    expect(personLine(withContext)).toBe('cut page 3');
    expect(matchTurn(script, withContext)?.match).toBe('cut page 3');
    expect(positionInTurn([new HumanMessage('a'), new AIMessage('x'), new HumanMessage('cut page 3'), new AIMessage({ content: '', tool_calls: [] }), new ToolMessage({ content: 'r', tool_call_id: '1' })])).toEqual({ human: 'cut page 3', toolResults: 1 });
  });

  it('says plainly when nothing is scripted, and when a step names a tool the agent lacks', async () => {
    const model = new ScriptedChatModel({ script }).bindTools(fakeTools.slice(0, 1));
    const miss = await model.invoke([new HumanMessage('what is the weather')]);

    expect(String(miss.content)).toContain('No line for that.');

    const bad = await model.invoke([new HumanMessage('cut page 3')]);

    expect(String(bad.content)).toContain('does not have');
  });

  it('resolves $file markers relative to the script', () => {
    const resolved = resolveFileRefs({ html: { $file: 'scripted.ts' }, keep: 1, list: [{ $file: 'scripted.ts' }] }, __dirname) as { html: string; keep: number; list: string[] };

    expect(resolved.html).toContain('ScriptedChatModel');
    expect(resolved.keep).toBe(1);
    expect(resolved.list[0]).toContain('ScriptedChatModel');
  });
});

describe('pacing', () => {
  it('cuts speech into pieces that join back to the text', () => {
    const text = 'Checked the ASI log.  A-501 is superseded\nby ASI-07.';
    const pieces = speechPieces(text);
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.join('')).toBe(text);
  });

  it('streams a paced reply in pieces and says a line with its call', async () => {
    const model = new ScriptedChatModel({
      script: {
        turns: [
          { match: 'draft', steps: [{ tool: 'search_knowledge', args: { query: 'ASI' }, say: 'Checking the ASI log.', thinkMs: 1 }], reply: 'Drafted and cited.', thinkMs: 1 },
        ],
        fallback: 'none',
        pace: { thinkMs: 0, charsPerSecond: 100000 },
      },
    });
    const call: Array<{ text: string; message: unknown }> = [];
    for await (const c of model._streamResponseChunks([new HumanMessage('draft it')], {} as never)) {
      call.push(c);
    }
    expect(call.map(c => c.text).join('')).toBe('Checking the ASI log.');
    expect((call.at(-1)!.message as unknown as { tool_call_chunks: unknown[] }).tool_call_chunks).toHaveLength(1);
  });
});

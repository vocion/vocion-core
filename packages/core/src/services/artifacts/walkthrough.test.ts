import { describe, expect, it, vi } from 'vitest';
import { describeRecording, writeWalkthrough } from './walkthrough';

/** The walkthrough a seat speaks: a typed script, timed to what the recording logged. */

function model(args: unknown) {
  const invoke = vi.fn(async () => ({ tool_calls: [{ name: 'record_walkthrough', args }] }));
  const bindTools = vi.fn(() => ({ invoke }));
  return { m: { bindTools } as never, invoke, bindTools };
}

const recording = { caption: 'Live check of REL-9, 2026-09-20', durationMs: 12_000, timeline: [{ atMs: 800, what: 'open /rooms (desktop)', ok: true }, { atMs: 5_100, what: 'click "Export as PDF"', ok: false, detail: 'button disabled' }], context: '- Export a room as a PDF' };

describe('writeWalkthrough', () => {
  it('returns the script the seat wrote, through its one tool', async () => {
    const lines = [{ atMs: 800, text: 'I open the rooms page.' }, { atMs: 5_100, text: 'Export is greyed out, so the PDF never starts.' }, { atMs: 9_000, text: 'That line is not seen live.' }];
    const { m, bindTools, invoke } = model({ lines });
    const res = await writeWalkthrough({ orgId: 'org_n', speaker: { name: 'QA', slug: 'change-reviewer', description: 'Reviews a finished task against its contract.' }, recording }, m);

    expect(res).toEqual({ ok: true, lines });
    expect(bindTools).toHaveBeenCalledWith([expect.objectContaining({ name: 'record_walkthrough' })], { tool_choice: 'record_walkthrough' });

    const [system, human] = (invoke.mock.calls[0] as unknown as [Array<{ content: string }>])[0];

    expect(system!.content).toMatch(/^You are QA: Reviews a finished task/);
    expect(human!.content).toContain('5100 ms: click "Export as PDF" (failed) — button disabled');
    expect(human!.content).toContain('It is 12 seconds long');
  });

  it('says so when the script cannot be read, never guessing one', async () => {
    const { m } = model({ lines: [{ atMs: 0, text: 'only one' }] });

    await expect(writeWalkthrough({ orgId: 'org_n', speaker: { name: 'QA' }, recording }, m)).resolves.toEqual({ ok: false, reason: 'the walkthrough came back without a script that could be read.' });
  });

  it('spreads the lines when nothing was logged, and budgets the words to the length', () => {
    const text = describeRecording({ caption: 'rename · desktop · before merge', durationMs: 20_000, timeline: [] });

    expect(text).toMatch(/spread the lines evenly/);
    expect(text).toMatch(/at most 224 characters/);
  });
});

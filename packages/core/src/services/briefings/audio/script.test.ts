import type { ScriptModel } from './script';
/**
 * The spoken script: a brief told, not read. It stays inside its length
 * bound, and never says a link, markdown or an id — whether the model
 * behaves, misbehaves once, misbehaves twice, or is not there at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_SCRIPT_WORDS, SCRIPT_BOUNDS, scriptProblems, scriptPrompt, scriptSeconds, speakable, trimToSeconds, writeSpokenScript } from './script';

const BRIEF = [
  '**Good morning, Alex — Fri, Oct 9. 2 meetings, 2 decisions on you.**',
  '',
  '## Today\'s meetings',
  '',
  '- **9:30 AM · Northwind renewal** — Dana asked for the revised terms (Gmail)',
  '- **2:00 PM · Kestrel Capital board prep** — deck in Drive',
  '',
  '## Waiting on you',
  '',
  '2 are yours, 3 decisions in all, across 1 workspace.',
  '',
  '- [Send the Contoso Supply renewal quote?](/w/revenue/dashboard/inbox?item=ask_7f3a9c2e1b) — Revenue Team, yours, waiting since Oct 6',
  '- [Which Bellwater Hall date holds?](https://app.vocion.example/w/revenue/dashboard/inbox?item=42) — Revenue Team, yours',
  '',
  '| Workspace | Waiting |',
  '|---|---|',
  '| Revenue Team | 3 |',
].join('\n');

const SOURCE = { title: 'Your day — Fri, Oct 9', markdown: BRIEF, listener: 'Alex', kind: 'brief' as const };

const GOOD = 'Good morning, Alex. Two things need you first today. Contoso Supply is waiting on the renewal quote, and it has been sitting since Tuesday. Then the Bellwater Hall date needs a call. At nine thirty you have the Northwind renewal, where Dana asked for the revised terms, so have those ready. This afternoon at two is the Kestrel Capital board prep; the deck is in Drive. That is your day.';

describe('the script\'s rules', () => {
  it('a good script breaks none', () => {
    expect(scriptProblems(GOOD)).toEqual([]);
  });

  it('names each rule a script breaks: links, markdown, ids, length', () => {
    expect(scriptProblems('Open https://app.vocion.example/w/revenue to see it.')).toContain('link');
    expect(scriptProblems('Look at northwind.example for details.')).toContain('link');
    expect(scriptProblems('**Today** you have two meetings.')).toContain('markdown');
    expect(scriptProblems('- one\n- two')).toContain('markdown');
    expect(scriptProblems('| a | b |')).toContain('markdown');
    expect(scriptProblems('Decide ask_7f3a9c2e1b today.')).toContain('id');
    expect(scriptProblems('Ticket #4821 is open.')).toContain('id');
    expect(scriptProblems('Record 3f2b8c1a-9d4e-4f6a-8b2c-1e5d7a9c0b3f changed.')).toContain('id');
    expect(scriptProblems('word '.repeat(MAX_SCRIPT_WORDS + 20))).toContain('too_long');
    expect(scriptProblems('   ')).toEqual(['empty']);
  });

  it('speakable takes out markdown, links, tables and ids and keeps the words', () => {
    const said = speakable(BRIEF);

    expect(said).toContain('Send the Contoso Supply renewal quote?');
    expect(said).toContain('Northwind renewal');
    expect(said).not.toMatch(/https?:|\/w\/|\*\*|##|[|[\]]|ask_7f3a9c2e1b/);
    expect(scriptProblems(said).filter(p => p !== 'too_long')).toEqual([]);
  });

  it('trims to the bound at a whole sentence', () => {
    const long = Array.from({ length: 80 }, (_, i) => `This is sentence number ${i + 1} of the brief.`).join(' ');
    const cut = trimToSeconds(long);

    expect(scriptSeconds(cut)).toBeLessThanOrEqual(SCRIPT_BOUNDS.maxSeconds);
    expect(cut.endsWith('.')).toBe(true);
    expect(cut).toMatch(/of the brief\.$/);
  });

  it('the model never sees a URL to repeat', () => {
    const prompt = scriptPrompt(SOURCE);

    expect(prompt).toContain('Send the Contoso Supply renewal quote?');
    expect(prompt).not.toMatch(/https?:|\/w\/revenue/);
  });
});

describe('writing the script', () => {
  it('takes a good answer as it is, in one call', async () => {
    const model = vi.fn<ScriptModel>(async () => GOOD);
    const out = await writeSpokenScript('org-1', SOURCE, { model, feature: 'brief.audio' });

    expect(out).toEqual({ text: GOOD, by: 'model' });
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0]![3]).toBe('brief.audio');
  });

  it('asks once more, naming the rule, when the answer breaks one', async () => {
    const model = vi.fn()
      .mockResolvedValueOnce('**Good morning.** See https://app.vocion.example for ask_7f3a9c2e1b.')
      .mockResolvedValueOnce(GOOD);
    const out = await writeSpokenScript('org-1', SOURCE, { model, feature: 'brief.audio' });

    expect(out.by).toBe('model-retry');
    expect(out.text).toBe(GOOD);

    const retry = model.mock.calls[1]![2] as string;

    expect(retry).toMatch(/link or web address/);
    expect(retry).toMatch(/formatting/);
    expect(retry).toMatch(/an id or code/);
  });

  it('a model that runs long twice is cut inside the bound, with nothing unsayable left', async () => {
    const rambling = `${'Here is a long point about the Northwind renewal and why it matters today. '.repeat(60)}See https://northwind.example/terms.`;
    const model = vi.fn(async () => rambling);
    const out = await writeSpokenScript('org-1', SOURCE, { model, feature: 'brief.audio' });

    expect(out.by).toBe('cleaned');
    expect(scriptSeconds(out.text)).toBeLessThanOrEqual(SCRIPT_BOUNDS.maxSeconds);
    expect(scriptProblems(out.text)).toEqual([]);
  });

  it('with no model, the brief\'s own words are spoken, in bounds and clean', async () => {
    const out = await writeSpokenScript('org-1', SOURCE, { model: null, feature: 'brief.audio' });

    expect(out.by).toBe('brief');
    expect(out.text.startsWith('Your day — Fri, Oct 9, for Alex.')).toBe(true);
    expect(scriptSeconds(out.text)).toBeLessThanOrEqual(SCRIPT_BOUNDS.maxSeconds);
    expect(scriptProblems(out.text)).toEqual([]);
  });

  it('a model that cannot answer falls back the same way', async () => {
    const out = await writeSpokenScript('org-1', SOURCE, { model: async () => null, feature: 'brief.audio' });

    expect(out.by).toBe('brief');
    expect(scriptProblems(out.text)).toEqual([]);
  });

  it('a full day lands between one and two and a half minutes', async () => {
    const full = Array.from({ length: 30 }, (_, i) => `Point ${i + 1}: the Northwind team moved the renewal forward and Dana needs the terms.`).join(' ');
    const out = await writeSpokenScript('org-1', SOURCE, { model: async () => full, feature: 'brief.audio' });

    expect(scriptSeconds(out.text)).toBeGreaterThanOrEqual(SCRIPT_BOUNDS.minSeconds);
    expect(scriptSeconds(out.text)).toBeLessThanOrEqual(SCRIPT_BOUNDS.maxSeconds);
  });
});

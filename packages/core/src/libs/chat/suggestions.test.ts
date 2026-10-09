import { describe, expect, it } from 'vitest';
import { DIG_DEEPER_PROMPT, MAX_SUGGESTIONS, parseSuggestions, stripSuggestBlocks, visibleSuggestions } from './suggestions';

describe('the follow-ups a reply ends with (founder, 2026-10-09)', () => {
  it('reads none from an empty block: zero is common and fine', () => {
    expect(parseSuggestions('')).toEqual([]);
    expect(parseSuggestions('\n  \n')).toEqual([]);
  });

  it('reads up to three, one per line, list marks and quotes dropped, each said once', () => {
    const items = parseSuggestions('\n- Draft the reply to Dana\n2. "Show who\'s waiting on me"\n* draft the reply to dana\nAdd this to my morning brief →\nOpen the Kestrel deal\n');

    expect(items.map(s => s.label)).toEqual(['Draft the reply to Dana', 'Show who\'s waiting on me', 'Add this to my morning brief']);
    expect(items).toHaveLength(MAX_SUGGESTIONS);
    // A pill sends its own words as the next message.
    expect(items.every(s => s.prompt === s.label)).toBe(true);
  });

  it('leaves out a line too long to be a pill', () => {
    expect(parseSuggestions(`${'Summarise every account '.repeat(5)}\nShow who's waiting on me`).map(s => s.label)).toEqual(['Show who\'s waiting on me']);
  });

  it('reads "Dig deeper" as the same ask one level up, shown only when there is one', () => {
    const items = parseSuggestions('Draft the reply to Dana\nDig deeper');

    expect(items[1]).toEqual({ label: 'Dig deeper →', prompt: DIG_DEEPER_PROMPT, deeper: true });
    expect(visibleSuggestions(items, true)).toHaveLength(2);
    expect(visibleSuggestions(items, false).map(s => s.label)).toEqual(['Draft the reply to Dana']);
    expect(visibleSuggestions(undefined, true)).toEqual([]);
  });

  it('never shows a block as words in a stored answer, closed or cut off', () => {
    expect(stripSuggestBlocks('The quote went out.\n\n<suggest>\nDraft the reply to Dana\n</suggest>')).toBe('The quote went out.');
    expect(stripSuggestBlocks('The quote went out.\n<suggest>\nDraft the')).toBe('The quote went out.');
    expect(stripSuggestBlocks('No block here.')).toBe('No block here.');
  });
});

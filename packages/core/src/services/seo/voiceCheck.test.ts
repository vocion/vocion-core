import type { ClientVoice } from '@/services/DataRoomService';
import { describe, expect, it } from 'vitest';
import { checkVoice, describeVoiceFindings } from './voiceCheck';

/**
 * The client's banned words and never-claim words, checked in code before a
 * person sees a draft — not left to the editor's reading. Fictional client.
 */

const voice: ClientVoice = {
  bannedPhrases: [{ text: 'cheap', source: 'doc:12' }, { text: 'world-class', source: 'https://northwind-home.example/about' }, { text: 'don\'t hesitate', source: 'doc:12' }],
  neverClaim: [{ text: 'Same-day service outside the metro', source: 'doc:12', phrases: ['same-day', 'same day'] }, { text: 'Licensed in other states', source: 'doc:12' }],
};

describe('checkVoice', () => {
  it('finds banned phrases and never-claim words as whole words, whatever the case or quote style', () => {
    const draft = 'Cheap furnace repair from a World-Class team. Don’t hesitate to call: same-day   service, every day.';
    const found = checkVoice(draft, voice);

    expect(found.map(f => [f.kind, f.phrase])).toEqual([
      ['banned', 'Cheap'],
      ['banned', 'World-Class'],
      ['banned', 'Don\'t hesitate'],
      ['never-claim', 'same-day'],
    ]);
    expect(found[3]!.line.text).toBe('Same-day service outside the metro');
    expect(found[0]!.excerpt).toContain('Cheap furnace repair');
  });

  it('does not match inside a longer word, and finds nothing in a clean draft or with no voice', () => {
    expect(checkVoice('The cheapest option is not always the best.', voice)).toEqual([]);
    expect(checkVoice('Book a visit with a technician.', voice)).toEqual([]);
    expect(checkVoice('Cheap', undefined)).toEqual([]);
  });

  it('counts repeats and says each finding with the line and its source', () => {
    const found = checkVoice('cheap, cheap, cheap. Same day guaranteed.', voice);
    const said = describeVoiceFindings(found);

    expect(found[0]!.count).toBe(3);
    expect(said).toContain('1. Uses "cheap" (3 times), which the client never uses (doc:12)');
    expect(said).toContain('2. "Same day" makes a claim the client may not make — "Same-day service outside the metro" (doc:12)');
  });
});

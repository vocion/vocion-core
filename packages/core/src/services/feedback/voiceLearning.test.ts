import type { VoiceRules } from '@/libs/writing/voiceRules';
import { describe, expect, it } from 'vitest';
import { PLATFORM_DEFAULT_VOICE_RULES } from '@/libs/writing/voiceRules';
import { copyFieldsOf, removedPhrases } from './voiceLearning';

const RULES: VoiceRules = PLATFORM_DEFAULT_VOICE_RULES;

describe('removedPhrases — what a reviewer deleted', () => {
  it('finds a phrase cut from the middle of a kept sentence', () => {
    const before = 'When you roll out a model, is that all in house or with partners?';
    const after = 'When you roll out a model, is that in house or with partners?';

    expect(removedPhrases(before, after, RULES)).toEqual([]);
  });

  it('proposes a multi-word deletion', () => {
    const before = 'Wondering out loud how the rollout works day to day.';
    const after = 'How the rollout works day to day.';

    expect(removedPhrases(before, after, RULES)).toContain('Wondering out loud');
  });

  it('returns nothing when the copy is unchanged', () => {
    expect(removedPhrases('Same text.', 'Same text.', RULES)).toEqual([]);
  });

  it('returns nothing when the proposal was empty', () => {
    expect(removedPhrases('', 'Anything.', RULES)).toEqual([]);
  });

  it('ignores a deleted phrase the rules already catch — that is the gate\'s job', () => {
    const before = 'No pitch, just curious how the rollout works.';
    const after = 'How the rollout works.';

    expect(removedPhrases(before, after, RULES).join(' ')).not.toContain('pitch');
  });

  it('ignores deletions that carry a proper noun — a name is not a phrasing', () => {
    const before = 'Saw the note about Northwind Logistics and wanted a word.';
    const after = 'Wanted a word.';

    expect(removedPhrases(before, after, RULES)).toEqual([]);
  });

  it('ignores deletions that carry a number, URL or address', () => {
    for (const before of [
      'we shipped 42 of them last quarter and it went fine',
      'see https://example.test/page for the details there',
      'write to someone@example.test for the details there',
    ]) {
      expect(removedPhrases(before, 'for the details there', RULES)).toEqual([]);
    }
  });

  it('ignores a single deleted word', () => {
    expect(removedPhrases('really good to meet you', 'good to meet you', RULES)).toEqual([]);
  });

  it('ignores a whole deleted sentence — too long to be a tell', () => {
    const before = 'one two three four five six seven eight nine ten. kept tail.';

    expect(removedPhrases(before, 'kept tail.', RULES)).toEqual([]);
  });

  it('caps what one decision can propose', () => {
    const before = 'aaa bbb K ccc ddd K eee fff K ggg hhh K iii jjj';

    expect(removedPhrases(before, 'K K K K', RULES).length).toBeLessThanOrEqual(3);
  });
});

describe('copyFieldsOf — where outbound copy lives in an action input', () => {
  it('reads a sequence\'s sends by step', () => {
    expect(copyFieldsOf({
      sends: [
        { step: 1, subject: 'S1', body: 'B1' },
        { step: 2, subject: 'S2', body: 'B2' },
      ],
    })).toEqual([
      { label: 'send-1.subject', text: 'S1' },
      { label: 'send-1.body', text: 'B1' },
      { label: 'send-2.subject', text: 'S2' },
      { label: 'send-2.body', text: 'B2' },
    ]);
  });

  it('reads a single-body action', () => {
    expect(copyFieldsOf({ subject: 'S', body: 'B' })).toEqual([
      { label: 'subject', text: 'S' },
      { label: 'body', text: 'B' },
    ]);
  });

  it('reads notes off properties when the input has no body', () => {
    expect(copyFieldsOf({ properties: { notes: 'N' } })).toEqual([{ label: 'notes', text: 'N' }]);
  });

  it('skips empty and non-string fields', () => {
    expect(copyFieldsOf({ body: '', subject: 7 })).toEqual([]);
  });

  it('survives a null input', () => {
    expect(copyFieldsOf(null)).toEqual([]);
  });
});

describe('the diff pairs fields by label, not by position', () => {
  it('compares send-2 with send-2', () => {
    const before = copyFieldsOf({ sends: [{ step: 1, body: 'kept' }, { step: 2, body: 'wondering out loud about the rollout' }] });
    const after = new Map(copyFieldsOf({ sends: [{ step: 1, body: 'kept' }, { step: 2, body: 'about the rollout' }] }).map(f => [f.label, f.text]));
    const phrases = before.flatMap(f => removedPhrases(f.text, after.get(f.label) ?? f.text, RULES));

    expect(phrases).toContain('wondering out loud');
  });
});

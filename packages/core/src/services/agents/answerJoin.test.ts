import { describe, expect, it } from 'vitest';
import { messageBreak } from './answerJoin';

describe('two of the model\'s messages in one answer are two paragraphs (2026-10-23)', () => {
  it('breaks between a sentence and the next message', () => {
    expect(messageBreak('Let me read the plan from the wiki.', 'Let me check what pages exist.')).toBe('\n\n');
  });

  it('adds nothing when either side already has the space, or at the start', () => {
    expect(messageBreak('Done.\n', 'Next')).toBe('');
    expect(messageBreak('Done.', ' next')).toBe('');
    expect(messageBreak('', 'First words')).toBe('');
  });
});

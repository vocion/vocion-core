import { describe, expect, it } from 'vitest';
import { transcriptOf } from './transcript';

const msg = (id: number, role: 'user' | 'assistant', content: string) => ({ id, role, content }) as never;

describe('the thread as plain text', () => {
  it('names each speaker and keeps the order', () => {
    const out = transcriptOf([msg(1, 'user', 'What did this cost?'), msg(2, 'assistant', '$24.12 so far.')], 'Send Lead');

    expect(out).toBe('You:\nWhat did this cost?\n\nSend Lead:\n$24.12 so far.');
  });

  it('falls back to a plain word when no agent is named', () => {
    expect(transcriptOf([msg(1, 'assistant', 'Hello.')], null)).toContain('Assistant:');
    expect(transcriptOf([msg(1, 'assistant', 'Hello.')], '   ')).toContain('Assistant:');
  });

  it('says a turn was tool work rather than emitting a name and nothing', () => {
    expect(transcriptOf([msg(1, 'assistant', '  ')], 'Lead')).toContain('tool work only');
  });

  it('is empty for an empty thread, not a stray newline', () => {
    expect(transcriptOf([], 'Lead')).toBe('');
  });
});

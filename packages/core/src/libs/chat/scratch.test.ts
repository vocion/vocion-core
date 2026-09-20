import { describe, expect, it } from 'vitest';
import { splitScratch, stripScratch } from './scratch';

describe('splitScratch — a scratch block is thinking wherever it lands', () => {
  it('leaves a plain answer whole', () => {
    expect(splitScratch('Fifteen runs, two still going.')).toEqual([
      { kind: 'answer', text: 'Fifteen runs, two still going.' },
    ]);
  });

  it('sets a leading block aside and keeps the answer after it', () => {
    expect(splitScratch('<scratch>raw rows</scratch>\n\nThe answer.')).toEqual([
      { kind: 'scratch', text: 'raw rows' },
      { kind: 'answer', text: '\n\nThe answer.' },
    ]);
  });

  it('finds a block in the middle of a turn, and a second one after it', () => {
    // The 2026-09-20 transcript: prose, a block after a tool call, prose, another block.
    const text = 'Checking.\n\n<scratch>No engineering tasks on record. Let me check the wiki.</scratch>\n\nStill looking.\n\n<scratch>Nothing there either.</scratch>\n\nNo worker runs on record.';

    expect(splitScratch(text)).toEqual([
      { kind: 'answer', text: 'Checking.\n\n' },
      { kind: 'scratch', text: 'No engineering tasks on record. Let me check the wiki.' },
      { kind: 'answer', text: '\n\nStill looking.\n\n' },
      { kind: 'scratch', text: 'Nothing there either.' },
      { kind: 'answer', text: '\n\nNo worker runs on record.' },
    ]);
  });

  it('treats a block that never closes as thinking to the end of the text', () => {
    // The screenshot's last line was cut mid-sentence inside the block.
    expect(splitScratch('So far so good.\n\n<scratch>Let me check knowledge / wiki for what was bui')).toEqual([
      { kind: 'answer', text: 'So far so good.\n\n' },
      { kind: 'scratch', text: 'Let me check knowledge / wiki for what was bui' },
    ]);
  });

  it('drops a close tag that has no open tag, keeping the words around it', () => {
    expect(splitScratch('Before</scratch>After')).toEqual([
      { kind: 'answer', text: 'Before' },
      { kind: 'answer', text: 'After' },
    ]);
  });

  it('never returns an empty segment', () => {
    expect(splitScratch('<scratch></scratch>')).toEqual([]);
    expect(splitScratch('<scratch>x</scratch>')).toEqual([{ kind: 'scratch', text: 'x' }]);
  });
});

describe('stripScratch — what a reader with no screen gets', () => {
  it('returns the text untouched when there is nothing to strip', () => {
    const text = 'Plain answer with a <br> in it.';

    expect(stripScratch(text)).toBe(text);
  });

  it('removes every block and collapses the gap it leaves', () => {
    const text = 'One.\n\n<scratch>a</scratch>\n\nTwo.\n\n<scratch>b</scratch>\n\nThree.';

    expect(stripScratch(text)).toBe('One.\n\nTwo.\n\nThree.');
  });

  it('removes an unclosed block to the end', () => {
    expect(stripScratch('The answer.\n\n<scratch>cut off mid-sen')).toBe('The answer.');
  });

  it('gives an empty string for a reply that was only scratch', () => {
    expect(stripScratch('<scratch>only thinking</scratch>')).toBe('');
  });
});

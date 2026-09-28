import { describe, expect, it } from 'vitest';
import { AnswerStreamer } from './answerStream';

/**
 * Feed text in arbitrary chunks; collect the streamed answer + thinking.
 * @param chunks
 */
function run(chunks: string[]): { answer: string; thinking: string } {
  const s = new AnswerStreamer();
  let answer = '';
  let thinking = '';
  for (const c of chunks) {
    const r = s.push(c);
    answer += r.answer;
    thinking += r.thinking;
  }
  const t = s.flush();
  return { answer: answer + t.answer, thinking: thinking + t.thinking };
}

describe('answerStreamer', () => {
  it('streams a plain answer with no scratch block', () => {
    expect(run(['Hello ', 'world'])).toEqual({ answer: 'Hello world', thinking: '' });
  });

  it('routes a scratch block to thinking and the rest to answer', () => {
    const out = run(['<scratch>raw data here</scratch>', 'The real answer.']);

    expect(out.thinking).toBe('raw data here');
    expect(out.answer).toBe('The real answer.');
  });

  it('handles the scratch OPEN tag split across chunks', () => {
    const out = run(['<scr', 'atch>secret', '</scr', 'atch>Answer']);

    expect(out.thinking).toBe('secret');
    expect(out.answer).toBe('Answer');
  });

  it('handles the CLOSE tag split across chunks without leaking it', () => {
    const out = run(['<scratch>a', 'b', 'c</', 'scratch>', 'done']);

    expect(out.thinking).toBe('abc');
    expect(out.answer).toBe('done');
    expect(out.answer).not.toContain('scratch');
  });

  it('tolerates leading whitespace before the scratch tag', () => {
    const out = run(['\n\n  <scratch>x</scratch>Y']);

    expect(out.thinking).toBe('x');
    expect(out.answer).toBe('Y');
  });

  it('never emits a partial tag into the answer mid-stream', () => {
    const s = new AnswerStreamer();
    // A chunk ending in a partial close tag must not stream the partial.
    const r1 = s.push('<scratch>data</scr');

    expect(r1.answer).toBe('');
    expect(r1.thinking).toBe('data');

    const r2 = s.push('atch>the answer');

    expect(r2.answer).toBe('the answer');
  });

  it('streams token-by-token once past scratch (true incremental)', () => {
    const s = new AnswerStreamer();
    s.push('<scratch>x</scratch>');
    const a = s.push('One ');
    const b = s.push('two ');
    const c = s.push('three');

    expect([a.answer, b.answer, c.answer]).toEqual(['One ', 'two ', 'three']);
  });

  // 2026-09-20: the model opened a block AFTER a tool call, mid-reply, and the
  // tags reached the transcript as body text — twice, the second cut short.
  describe('a block in the middle of the reply', () => {
    it('routes a mid-reply block to thinking and keeps the prose on both sides', () => {
      const out = run(['Checking the log.\n\n', '<scratch>No engineering tasks on record. Let me check the wiki.</scratch>', '\n\nFifteen runs.']);

      expect(out.thinking).toBe('No engineering tasks on record. Let me check the wiki.');
      expect(out.answer).toBe('Checking the log.\n\n\n\nFifteen runs.');
      expect(out.answer).not.toContain('scratch');
    });

    it('handles two blocks in one reply', () => {
      const out = run(['A ', '<scratch>one</scratch>', ' B ', '<scratch>two</scratch>', ' C']);

      expect(out.thinking).toBe('onetwo');
      expect(out.answer).toBe('A  B  C');
    });

    it('holds back a partial open tag mid-answer and releases it when it was not a tag', () => {
      const s = new AnswerStreamer();
      const r1 = s.push('cost <');

      expect(r1.answer).toBe('cost ');

      const r2 = s.push('$5, not <s');

      expect(r2.answer).toBe('<$5, not ');

      const r3 = s.push('ix>.');

      expect(r3.answer).toBe('<six>.');
    });

    it('handles the open tag split across chunks mid-answer', () => {
      const out = run(['Prose <sc', 'ratch>hidden</scratch> more']);

      expect(out.thinking).toBe('hidden');
      expect(out.answer).toBe('Prose  more');
    });

    it('says when a block closed, so the reasoning node can be closed with it', () => {
      const s = new AnswerStreamer();

      expect(s.push('Hi <scratch>a').closed).toBe(false);
      expect(s.push('b</scratch>').closed).toBe(true);
      expect(s.push(' done').closed).toBe(false);
    });
  });

  describe('a block that never closes', () => {
    it('is thinking to the end of the stream, never body text', () => {
      // The screenshot's last line was cut mid-sentence inside the block.
      const out = run(['The tasks list is empty.\n\n', '<scratch>Let me check knowledge / wiki for what was bui']);

      expect(out.answer).toBe('The tasks list is empty.\n\n');
      expect(out.thinking).toBe('Let me check knowledge / wiki for what was bui');
    });

    it('releases a held partial close tag as thinking at flush', () => {
      const s = new AnswerStreamer();
      const r1 = s.push('<scratch>data</scr');

      expect(r1.thinking).toBe('data');

      const tail = s.flush();

      expect(tail.thinking).toBe('</scr');
      expect(tail.answer).toBe('');
      expect(tail.closed).toBe(false);
    });
  });

  it('drops a partial open tag left at the very end of the stream, instead of storing "<sc"', () => {
    const s = new AnswerStreamer();
    const a = s.push('I\'ll get the state of things before answering. <sc');
    const b = s.flush();

    expect(a.answer + b.answer).toBe('I\'ll get the state of things before answering. ');
    expect(b.thinking).toBe('');
  });
});

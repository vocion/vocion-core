import { describe, expect, it } from 'vitest';
import { AnswerStreamer } from './answerStream';

/** Feed text in arbitrary chunks; collect the streamed answer + thinking. */
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
});

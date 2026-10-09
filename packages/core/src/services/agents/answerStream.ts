/**
 * Live answer streamer.
 *
 * The lead model reply may carry a `<scratch>…</scratch>` block (raw data it
 * lays out to reason over — see OUTPUT_DISCIPLINE). We must NOT stream that
 * into the user-visible answer; it belongs in the chain-of-thought. But we DO
 * want to stream everything else live, token by token, instead of buffering
 * the whole reply (which made the answer "dump" all at once).
 *
 * The block was first handled only at the very START of the reply, which is
 * where the prompt asks for it. On 2026-09-20 the model opened one in the
 * middle of a turn — after a tool call, where the reply resumes — and the
 * tags reached the transcript as body text, twice, the second one cut off
 * mid-sentence. So the streamer now watches for a block anywhere: text before
 * it is answer, the block is thinking, text after it is answer again, and a
 * block still open when the stream ends is thinking to the end.
 *
 * This is a tiny state machine fed incremental text deltas. It returns, per
 * push, the `answer` text to stream as `response_delta`, the `thinking` text
 * (scratch contents) to stream as `thinking_delta`, and `closed` — whether a
 * block finished in this push, so the caller can close the reasoning node it
 * opened. It is boundary-safe: `<scratch>` / `</scratch>` may be split across
 * token boundaries, so it holds back the minimum tail needed to detect a tag
 * rather than leaking a partial one into the answer. Pure + deterministic
 * (see answerStream.test.ts).
 */
const OPEN = '<scratch>';
const CLOSE = '</scratch>';

/**
 * A TOOL CALL WRITTEN AS TEXT never streams either (conversation 355,
 * 2026-09-28: two `<recommend_action> {json} </recommend_action>` blocks read
 * as the answer). The block is held back whole and handed to the caller as a
 * call (`calls`), which executes it as the real tool
 * (`services/agents/textToolCalls.ts`).
 */
const CALL_TAGS = ['recommend_action', 'propose_action'] as const;
type CallTag = (typeof CALL_TAGS)[number];

/**
 * FOLLOW-UPS (`libs/chat/suggestions.ts`): a `<suggest>` block at the end of
 * the reply is held back whole like a call, and handed over as `suggest` —
 * the pills under the answer, never its text.
 */
const SUGGEST = 'suggest';

type Mode = 'answer' | 'scratch' | CallTag | typeof SUGGEST;

export type StreamedText = { answer: string; thinking: string; closed: boolean; calls: Array<{ tag: CallTag; body: string }>; suggest: string[] };

/**
 * The longest suffix of `buf` that is a proper prefix of `tag` — the piece
 * that might still turn into the tag once more text arrives.
 * @param buf - Text seen so far.
 * @param tag - The tag to watch for.
 */
function partialTagTail(buf: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) {
    if (tag.startsWith(buf.slice(buf.length - k))) {
      return k;
    }
  }
  return 0;
}

/** Every tag that opens a held block in answer mode, with the mode it opens. */
const OPENERS: Array<{ tag: string; mode: Mode }> = [{ tag: OPEN, mode: 'scratch' }, ...CALL_TAGS.map(t => ({ tag: `<${t}>`, mode: t as Mode })), { tag: `<${SUGGEST}>`, mode: SUGGEST }];

export class AnswerStreamer {
  private buf = '';
  private mode: Mode = 'answer';
  /** A call block's text so far — never streamed. */
  private callBody = '';
  /** Whether any answer text has been released yet — leading whitespace before the first word (or the first block) is dropped. */
  private answered = false;

  /**
   * Feed a text delta; get the answer + thinking text ready to emit now.
   * @param delta
   */
  push(delta: string): StreamedText {
    this.buf += delta;
    return this.drain(false);
  }

  /** Call once at end-of-stream to release any held-back tail. */
  flush(): StreamedText {
    return this.drain(true);
  }

  private drain(final: boolean): StreamedText {
    let answer = '';
    let thinking = '';
    let closed = false;
    const calls: StreamedText['calls'] = [];
    const suggest: string[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;

      if (this.mode === 'answer') {
        if (!this.answered) {
          this.buf = this.buf.replace(/^\s+/, '');
        }
        if (this.buf === '') {
          break;
        }
        // The first block that opens, of any kind.
        let next: { idx: number; tag: string; mode: Mode } | null = null;
        for (const o of OPENERS) {
          const idx = this.buf.indexOf(o.tag);
          if (idx !== -1 && (next === null || idx < next.idx)) {
            next = { idx, tag: o.tag, mode: o.mode };
          }
        }
        if (next) {
          // Text before the tag is answer; whitespace alone before the first
          // word is not.
          const before = this.buf.slice(0, next.idx);
          if (before.length > 0 && (this.answered || before.trim().length > 0)) {
            answer += before;
            this.answered = true;
          }
          this.buf = this.buf.slice(next.idx + next.tag.length);
          this.mode = next.mode;
          this.callBody = '';
          progressed = true;
          continue;
        }
        // Hold back only a trailing PARTIAL open tag, so real answer text
        // streams immediately. At the END of the stream a partial open tag is
        // not text either: a turn that stopped mid-"<scratch>" stored "<sc"
        // as its answer (production turn 552, 2026-09-24). Drop it.
        const partial = Math.max(...OPENERS.map(o => partialTagTail(this.buf, o.tag)));
        if (final && partial > 0) {
          this.buf = this.buf.slice(0, this.buf.length - partial);
        }
        const hold = final ? 0 : partial;
        const keep = this.buf.length - hold;
        if (keep > 0) {
          answer += this.buf.slice(0, keep);
          this.buf = this.buf.slice(keep);
          this.answered = true;
        }
        break;
      }

      if (this.mode !== 'scratch') {
        // A call block: held whole until it closes, then handed over.
        const tag = this.mode;
        const close = `</${tag}>`;
        const idx = this.buf.indexOf(close);
        if (idx !== -1) {
          if (tag === SUGGEST) {
            suggest.push(this.callBody + this.buf.slice(0, idx));
          } else {
            calls.push({ tag, body: this.callBody + this.buf.slice(0, idx) });
          }
          this.callBody = '';
          this.buf = this.buf.slice(idx + close.length);
          this.mode = 'answer';
          progressed = true;
          continue;
        }
        const hold = final ? 0 : partialTagTail(this.buf, close);
        this.callBody += this.buf.slice(0, this.buf.length - hold);
        this.buf = this.buf.slice(this.buf.length - hold);
        if (final) {
          // Cut off by the end of the stream: still a call, and never text.
          if (tag === SUGGEST) {
            suggest.push(this.callBody);
          } else {
            calls.push({ tag, body: this.callBody });
          }
          this.callBody = '';
          this.mode = 'answer';
        }
        break;
      }

      // scratch mode
      const idx = this.buf.indexOf(CLOSE);
      if (idx !== -1) {
        thinking += this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + CLOSE.length);
        this.mode = 'answer';
        closed = true;
        progressed = true;
        continue;
      }
      // Hold back only a trailing PARTIAL close tag (the longest buf suffix
      // that is a prefix of CLOSE), so real scratch text streams immediately.
      // At the end of the stream an unclosed block is thinking to its last
      // character — never body text.
      const hold = final ? 0 : partialTagTail(this.buf, CLOSE);
      const keep = this.buf.length - hold;
      if (keep > 0) {
        thinking += this.buf.slice(0, keep);
        this.buf = this.buf.slice(keep);
      }
      break;
    }
    return { answer, thinking, closed, calls, suggest };
  }
}

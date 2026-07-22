/**
 * Live answer streamer.
 *
 * The lead model reply may open with a `<scratch>…</scratch>` block (raw data
 * it lays out to reason over — see OUTPUT_DISCIPLINE). We must NOT stream that
 * into the user-visible answer; it belongs in the chain-of-thought. But we DO
 * want to stream everything AFTER `</scratch>` live, token by token, instead of
 * buffering the whole reply (which made the answer "dump" all at once).
 *
 * This is a tiny state machine fed incremental text deltas. It returns, per
 * push, the `answer` text to stream as `response_delta` and the `thinking`
 * text (scratch contents) to stream as `thinking_delta`. It is boundary-safe:
 * `<scratch>` / `</scratch>` may be split across token boundaries, so it holds
 * back the minimum tail needed to detect a tag rather than leaking a partial
 * one into the answer. Pure + deterministic (see answerStream.test.ts).
 */
const OPEN = '<scratch>';
const CLOSE = '</scratch>';

type Mode = 'undecided' | 'scratch' | 'answer';

export class AnswerStreamer {
  private buf = '';
  private mode: Mode = 'undecided';

  /** Feed a text delta; get the answer + thinking text ready to emit now. */
  push(delta: string): { answer: string; thinking: string } {
    this.buf += delta;
    return this.drain(false);
  }

  /** Call once at end-of-stream to release any held-back tail. */
  flush(): { answer: string; thinking: string } {
    return this.drain(true);
  }

  private drain(final: boolean): { answer: string; thinking: string } {
    let answer = '';
    let thinking = '';
    let progressed = true;
    while (progressed) {
      progressed = false;

      if (this.mode === 'undecided') {
        const ws = /^\s*/.exec(this.buf)?.[0] ?? '';
        const rest = this.buf.slice(ws.length);
        if (rest === '') {
          break; // only whitespace so far — wait (or, if final, nothing to emit)
        }
        // Still possibly the opening tag (e.g. "<scr") — wait for more unless final.
        if (OPEN.startsWith(rest) && rest.length < OPEN.length) {
          if (final) {
            this.mode = 'answer';
            this.buf = rest;
            progressed = true;
            continue;
          }
          break;
        }
        if (rest.startsWith(OPEN)) {
          this.mode = 'scratch';
          this.buf = rest.slice(OPEN.length);
          progressed = true;
          continue;
        }
        // No scratch block — it's all answer.
        this.mode = 'answer';
        this.buf = rest;
        progressed = true;
        continue;
      }

      if (this.mode === 'scratch') {
        const idx = this.buf.indexOf(CLOSE);
        if (idx !== -1) {
          thinking += this.buf.slice(0, idx);
          this.buf = this.buf.slice(idx + CLOSE.length);
          this.mode = 'answer';
          progressed = true;
          continue;
        }
        // Hold back only a trailing PARTIAL close tag (the longest buf suffix
        // that is a prefix of CLOSE), so real scratch text streams immediately.
        let hold = 0;
        if (!final) {
          for (let k = Math.min(CLOSE.length - 1, this.buf.length); k > 0; k--) {
            if (CLOSE.startsWith(this.buf.slice(this.buf.length - k))) {
              hold = k;
              break;
            }
          }
        }
        const keep = this.buf.length - hold;
        if (keep > 0) {
          thinking += this.buf.slice(0, keep);
          this.buf = this.buf.slice(keep);
        }
        break;
      }

      // answer mode — stream everything.
      if (this.buf) {
        answer += this.buf;
        this.buf = '';
      }
      break;
    }
    return { answer, thinking };
  }
}

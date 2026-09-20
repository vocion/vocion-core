/**
 * The model's `<scratch>…</scratch>` blocks, found and set aside.
 *
 * The harness invites the lead to lay raw data out inside one such block at
 * the start of its reply (OUTPUT_DISCIPLINE in `services/agents/harness.ts`),
 * and the live streamer strips that block deterministically. On 2026-09-20 a
 * transcript showed the tags anyway — twice, between tool-call rows, once cut
 * mid-sentence — because the model opened a block in the middle of a turn,
 * after a tool call, where the streamer was no longer looking. Chris: *"should
 * our Chat be smarter than this?"*
 *
 * This is the one rule for a block wherever it lands: it is the model
 * thinking, never the answer. The server routes it to the trace as it
 * streams; the client folds whatever reached a stored text run (older turns,
 * another harness) into a collapsed "Thinking" line; and anything read as the
 * answer by a system with no screen — a briefing, an MCP reply, a Slack post
 * — takes {@link stripScratch}. Pure, shared by client and server, and the
 * text run keeps its tags so the audit trail is the turn as it was written.
 */

export type ScratchSegment = { kind: 'answer' | 'scratch'; text: string };

const OPEN = '<scratch>';
const CLOSE = '</scratch>';

/**
 * Split answer text into what the person is meant to read and what the model
 * was thinking. A block that never closes (the turn was cut off inside it)
 * runs to the end of the text and is still scratch, never body text. A close
 * tag with no open tag is dropped as noise. Segments are never empty.
 * @param text - A text run as the model wrote it.
 */
export function splitScratch(text: string): ScratchSegment[] {
  const out: ScratchSegment[] = [];
  const pushSegment = (kind: ScratchSegment['kind'], raw: string): void => {
    if (raw.trim().length === 0) {
      return;
    }
    out.push({ kind, text: raw });
  };
  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf(OPEN);
    const strayClose = rest.indexOf(CLOSE);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) {
      // A close with no open before it: keep the words, lose the tag.
      pushSegment('answer', rest.slice(0, strayClose));
      rest = rest.slice(strayClose + CLOSE.length);
      continue;
    }
    if (open === -1) {
      pushSegment('answer', rest);
      break;
    }
    pushSegment('answer', rest.slice(0, open));
    const afterOpen = rest.slice(open + OPEN.length);
    const close = afterOpen.indexOf(CLOSE);
    if (close === -1) {
      pushSegment('scratch', afterOpen);
      break;
    }
    pushSegment('scratch', afterOpen.slice(0, close));
    rest = afterOpen.slice(close + CLOSE.length);
  }
  return out;
}

/**
 * The answer with every scratch block removed — for a reader who has no way
 * to unfold one. Paragraph breaks left behind are collapsed to one.
 * @param text - A text run or a whole reply.
 */
export function stripScratch(text: string): string {
  if (!text.includes(OPEN) && !text.includes(CLOSE)) {
    return text;
  }
  return splitScratch(text)
    .filter(seg => seg.kind === 'answer')
    .map(seg => seg.text)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

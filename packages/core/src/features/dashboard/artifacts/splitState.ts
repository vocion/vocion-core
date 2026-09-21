/**
 * Where the line between the conversation and the document sits, and where
 * that memory lives.
 *
 * The split is stored as the CONVERSATION's fraction of the two panes, not a
 * pixel width, so one memory survives a resize, a second monitor and a
 * collapsed sidebar. Neither pane may be dragged into uselessness: a
 * transcript narrower than `CONVERSATION_MIN_WIDTH` is a column of single
 * words, and a document pane narrower than `PANE_MIN_WIDTH` is a thumbnail.
 *
 * The three widths are measured, not guessed:
 *
 * - **720px for the conversation** is 68–78 characters at the app's body
 *   size — the measure `MessageList` already centres its bubbles at
 *   (`max-w-3xl`), so the transcript reads the same here as everywhere else.
 * - **884px for the document** is `DOCUMENT_FRAME_WIDTH` (850px, the sheet
 *   layout `DocumentFrame` renders) plus the pane's own 34px of border and
 *   padding. That frame scales by `min(1, width / 850)`, so 884px is the
 *   width at which a US-Letter sheet stops being shrunk — and the width past
 *   which more pixels buy the document nothing.
 * - **420px** is the narrowest either pane may be dragged to.
 *
 * Hard-coded rather than imported from `DocumentFrame`, deliberately: this
 * module is pure and unit-tested in the node project, and importing a client
 * component to read one number would drag React, lucide and the orpc client
 * in with it.
 */

/** Neither pane may be dragged below this. */
export const CONVERSATION_MIN_WIDTH = 420;
export const PANE_MIN_WIDTH = 420;
/** The measure the transcript wants: 68–78 characters. */
export const CONVERSATION_TARGET_WIDTH = 720;
/** The width at which a US-Letter sheet renders 1:1 (`DOCUMENT_FRAME_WIDTH` + the pane's chrome). */
export const PANE_TARGET_WIDTH = 884;
/**
 * The ratio this surface shipped with (`5fr / 7fr`), kept as the floor on the
 * conversation's share and as what the server renders before the browser has
 * measured anything — so the first paint is the layout that was already there
 * and the measured correction is invisible.
 */
export const CONVERSATION_SHARE = 5 / 12;
export const SPLIT_FALLBACK = CONVERSATION_SHARE;
/** One arrow key. */
export const SPLIT_STEP = 0.02;
/**
 * The width at which the two panes stop stacking and stand side by side.
 *
 * This is Tailwind's `lg`, and `ConversationSplit`'s `lg:` variants are the
 * other half of it — the CSS decides the LAYOUT (so the first paint is right
 * with no JS) and this number is what a hook has to match when it decides
 * something CSS cannot express, like whether the pane's close control says
 * "close" or "back to the conversation". The two must move together.
 */
export const SPLIT_STACK_BREAKPOINT = 1024;

const SPLIT_KEY = 'vocion_conversation_split';

/**
 * Keep a requested split inside what both panes can live with.
 *
 * A container too narrow to honour both minimums (a small laptop with the
 * sidebar open) gets the proportional split rather than a nonsense range —
 * there is no good answer there, only a predictable one.
 * @param fraction - The conversation's share, 0–1.
 * @param usableWidth - The width the two panes share, in px; 0 when nothing has been measured yet.
 */
export function clampConversationSplit(fraction: number, usableWidth: number): number {
  const width = Number.isFinite(usableWidth) && usableWidth > 0 ? usableWidth : 0;
  if (width === 0) {
    // Nothing measured: only the absolute guard rails, so the server render
    // and the first client paint agree.
    return Number.isFinite(fraction) ? Math.min(0.8, Math.max(0.2, fraction)) : SPLIT_FALLBACK;
  }
  const floor = CONVERSATION_MIN_WIDTH / width;
  const ceiling = 1 - PANE_MIN_WIDTH / width;
  if (floor > ceiling) {
    return CONVERSATION_MIN_WIDTH / (CONVERSATION_MIN_WIDTH + PANE_MIN_WIDTH);
  }
  if (!Number.isFinite(fraction)) {
    return Math.min(ceiling, Math.max(floor, SPLIT_FALLBACK));
  }
  return Math.min(ceiling, Math.max(floor, fraction));
}

/**
 * The split to open at when this browser has never said otherwise.
 *
 * The document is served first, because it has a cliff and the transcript does
 * not: below 884px every pixel taken off the pane shrinks a US-Letter sheet
 * that a person is trying to read, while the transcript's own bubbles are
 * capped at 768px and simply re-wrap. So the conversation takes whichever is
 * LARGER of the ratio this surface always used and whatever is left once the
 * document has its 884px — and never more than its own 720px measure, so the
 * extra pixels of a wide monitor land on the document rather than on a line of
 * prose nobody can track.
 * @param usableWidth - The width the two panes share, in px.
 */
export function defaultConversationSplit(usableWidth: number): number {
  const width = Number.isFinite(usableWidth) && usableWidth > 0 ? usableWidth : 0;
  if (width === 0) {
    return SPLIT_FALLBACK;
  }
  const conversation = Math.min(
    CONVERSATION_TARGET_WIDTH,
    Math.max(width * CONVERSATION_SHARE, width - PANE_TARGET_WIDTH),
  );
  return clampConversationSplit(conversation / width, width);
}

/**
 * The split this browser was last left at, or null — a missing, unreadable,
 * out-of-range or corrupt value is "never said", never an error.
 */
export function readStoredConversationSplit(): number | null {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    const n = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
  } catch {
    return null;
  }
}

export function writeStoredConversationSplit(fraction: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, fraction.toFixed(3));
  } catch {
    /* storage unavailable — the split still holds for this session */
  }
}

/** Double-click on the divider: forget it, so the default rule applies again. */
export function clearStoredConversationSplit(): void {
  try {
    localStorage.removeItem(SPLIT_KEY);
  } catch {
    /* storage unavailable */
  }
}

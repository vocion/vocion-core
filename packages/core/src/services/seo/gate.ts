/**
 * THE VOLUME GATE — how many pages of an SEO batch may be written now.
 *
 * A batch is written in three stages, and the stage is decided here, in code,
 * never by a prompt:
 *
 *   sample   the first `sample` pages (3 by default). Nothing past them is
 *            drafted until a person has signed off on every one.
 *   tranche  the next `tranche` pages (10 by default), released once the
 *            whole sample is approved. Nothing past them until every page so
 *            far is approved.
 *   open     the rest of the batch.
 *
 * Feedback holds the gate too. A page a person sent back ("changes
 * requested") stops every NEW draft in the batch until its note is filed —
 * to the project (client rules, the client wiki) or the workspace wiki
 * (craft) — so the lesson reaches the pages not yet written. Once filed, the
 * page itself may be redrafted, and the stage does not advance until it is
 * approved like the rest.
 *
 * The sizes come from the project (`seoGate: {sample, tranche}` on the
 * project's metadata), never from a prompt. Pure: the records are read and
 * written by `services/seo/records.ts`; this file only decides.
 */

export type SeoGateConfig = { sample: number; tranche: number };

export const DEFAULT_SEO_GATE: SeoGateConfig = { sample: 3, tranche: 10 };

/** The bounds a project may set: at least one page, at most a hundred, per stage. */
const MIN_STAGE = 1;
const MAX_STAGE = 100;

export type SeoGateStage = 'sample' | 'tranche' | 'open';

/** What the gate reads off one page record. */
export type GatePage = {
  id: number;
  /** Position in the batch (1-based), set when the batch is planned. */
  order: number;
  status: string;
  /** A draft is attached (`draftArtifactId`). */
  written: boolean;
  /** A person signed off on the CURRENT draft (`signoff.decision === 'approve'` for this draft). */
  approved: boolean;
  /** A person asked for changes and the page has not been approved since. */
  changesRequested: boolean;
  /** Every feedback note on the page says where it was filed. */
  feedbackFiled: boolean;
};

export type GateState = {
  stage: SeoGateStage;
  /** How many pages (by order, live pages only) the gate releases now. */
  allowed: number;
  written: number;
  approved: number;
  changesRequested: number;
  /** Live pages: everything not discarded. */
  total: number;
  /** Page ids inside the released slots. */
  released: number[];
  /** Page ids that may be drafted (or redrafted) right now. */
  writable: number[];
  /** Pages sent back whose feedback is not filed yet; while any exist, nothing new is drafted. */
  feedbackToFile: number[];
  /** Released pages written and waiting on a person's sign-off. */
  waitingOnSignoff: number[];
  /** The one line a person reads: "3 of 40 written · waiting on your feedback on the first 3". */
  line: string;
};

/** Statuses that take a page out of the batch. */
const OUT = new Set(['rejected']);

/**
 * The gate sizes a project sets, defaulted and bounded. Anything that is not a
 * whole number in range falls back to the default for that stage, so a typo
 * in a project's metadata can never open the gate.
 * @param projectMeta - The project's metadata (`business_object.metadata`).
 */
export function gateConfigFrom(projectMeta: unknown): SeoGateConfig {
  const raw = projectMeta && typeof projectMeta === 'object' ? (projectMeta as { seoGate?: unknown }).seoGate : undefined;
  const cfg = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const size = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= MIN_STAGE && v <= MAX_STAGE ? v : fallback;
  return { sample: size(cfg.sample, DEFAULT_SEO_GATE.sample), tranche: size(cfg.tranche, DEFAULT_SEO_GATE.tranche) };
}

/**
 * Where a batch stands, and what may be written now.
 * @param pages - The batch's pages, any order.
 * @param config - The project's sizes.
 */
export function evaluateGate(pages: readonly GatePage[], config: SeoGateConfig = DEFAULT_SEO_GATE): GateState {
  const live = pages.filter(p => !OUT.has(p.status)).sort((a, b) => a.order - b.order || a.id - b.id);
  const total = live.length;
  const sampleEnd = Math.min(config.sample, total);
  const trancheEnd = Math.min(config.sample + config.tranche, total);
  const allApproved = (n: number) => live.slice(0, n).every(p => p.approved);

  let stage: SeoGateStage = 'sample';
  let allowed = sampleEnd;
  if (sampleEnd > 0 && allApproved(sampleEnd)) {
    stage = 'tranche';
    allowed = trancheEnd;
    if (trancheEnd > 0 && allApproved(trancheEnd) && trancheEnd < total) {
      stage = 'open';
      allowed = total;
    } else if (trancheEnd === total && allApproved(total)) {
      // A batch no bigger than sample + tranche is fully released once the
      // tranche is approved; call it open, there is nothing left to hold.
      stage = 'open';
    }
  }

  const released = live.slice(0, allowed);
  const feedbackToFile = live.filter(p => p.changesRequested && !p.feedbackFiled).map(p => p.id);
  const held = feedbackToFile.length > 0;
  const writable = held
    ? []
    : released.filter(p => p.changesRequested || (!p.written && !p.approved)).map(p => p.id);
  const waitingOnSignoff = released.filter(p => p.written && !p.approved && !p.changesRequested).map(p => p.id);

  const written = live.filter(p => p.written).length;
  const approved = live.filter(p => p.approved).length;
  const changesRequested = live.filter(p => p.changesRequested).length;

  return {
    stage,
    allowed,
    written,
    approved,
    changesRequested,
    total,
    released: released.map(p => p.id),
    writable,
    feedbackToFile,
    waitingOnSignoff,
    line: gateLine({ stage, allowed, written, approved, total, sampleEnd, feedbackToFile: feedbackToFile.length, waiting: waitingOnSignoff.length, writable: writable.length }),
  };
}

/**
 * The gate in one line, in the words a person reads on the batch page.
 * @param s - The counts.
 * @param s.stage - Where the batch is.
 * @param s.allowed - Pages released.
 * @param s.written - Pages with a draft.
 * @param s.approved - Pages signed off.
 * @param s.total - Live pages.
 * @param s.sampleEnd - The sample's size in this batch.
 * @param s.feedbackToFile - Pages whose feedback is not filed.
 * @param s.waiting - Released pages waiting on a sign-off.
 * @param s.writable - Pages that may be written now.
 */
function gateLine(s: { stage: SeoGateStage; allowed: number; written: number; approved: number; total: number; sampleEnd: number; feedbackToFile: number; waiting: number; writable: number }): string {
  const head = `${s.written} of ${s.total} written`;
  if (s.total === 0) {
    return 'No pages planned yet';
  }
  if (s.approved === s.total) {
    return `${head} · all ${s.total} approved`;
  }
  if (s.feedbackToFile > 0) {
    return `${head} · ${s.feedbackToFile === 1 ? '1 page has' : `${s.feedbackToFile} pages have`} feedback to file before more are written`;
  }
  const pages = (n: number) => (n === 1 ? '1 page' : `${n} pages`);
  if (s.writable === 0 && s.waiting > 0) {
    return s.stage === 'sample'
      ? `${head} · waiting on your feedback on the first ${s.sampleEnd}`
      : `${head} · waiting on your feedback on ${pages(s.waiting)}`;
  }
  if (s.stage === 'sample') {
    return `${head} · writing a sample of ${s.sampleEnd} for your feedback first`;
  }
  if (s.stage === 'tranche') {
    return `${head} · sample approved, ${s.allowed} released`;
  }
  return `${head} · open, the rest of the batch is released`;
}

/**
 * Why one page may not be written now, in a sentence — the refusal
 * `seo_save_draft` returns and the reason `seo_next_pages` gives per page.
 * Null when it may.
 * @param state - The batch's gate.
 * @param pageId - The page.
 */
export function whyNotWritable(state: GateState, pageId: number): string | null {
  if (state.writable.includes(pageId)) {
    return null;
  }
  if (state.feedbackToFile.length > 0) {
    return `feedback on ${state.feedbackToFile.map(id => `page #${id}`).join(', ')} has to be filed (to the project or the wiki) before any page is written or redrafted`;
  }
  if (!state.released.includes(pageId)) {
    return state.stage === 'sample'
      ? `it is past the sample: a person has to sign off on the first ${state.allowed} pages first`
      : `it is past the ${state.stage}: every released page (${state.allowed}) has to be approved first`;
  }
  if (state.waitingOnSignoff.includes(pageId)) {
    return 'its draft is waiting on a person\'s sign-off';
  }
  return 'it is already approved';
}

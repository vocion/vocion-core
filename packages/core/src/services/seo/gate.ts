/**
 * THE VOLUME GATE — how many pages of a client's project may be written now.
 *
 * The gate is the PROJECT's, not a batch's: every batch planned for one client
 * climbs one ladder, so a second batch cannot start writing while the first
 * one's sample still waits on a person. Decided here, in code, never by a
 * prompt:
 *
 *   sample   one page of EACH page type in the project's signed-off plans
 *            (a location page, a service page, a blog post…), filled up to
 *            `sample` pages (3 by default) in planned order. Nothing else is
 *            drafted, in any batch, until a person has signed off on every
 *            one. A page with no type yet counts as its own kind.
 *   tranche  the next `tranche` pages (10 by default) in planned order —
 *            batch by batch, page by page — released once the whole sample
 *            is approved. Nothing past them until every page so far is
 *            approved.
 *   open     the rest.
 *
 * Feedback holds the gate too. A page a person sent back ("changes
 * requested") stops every NEW draft in every batch of the project until its
 * note is filed — to the project (client rules, the client wiki) or the
 * `seo-feedback` learning step (craft) — so the lesson reaches the pages not
 * yet written. Once filed, the page itself may be redrafted, and the stage
 * does not advance until it is approved like the rest.
 *
 * Only pages of a batch whose keyword plan a person signed off reach the gate
 * at all (`records.ts`): a plan still in review releases nothing.
 *
 * The sizes come from the project (`seoGate: {sample, tranche}` on the
 * project's metadata, set by a person on the project page), never from a
 * prompt. Pure: the records are read and written by
 * `services/seo/records.ts`; this file only decides.
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
  /** The batch it was planned in; batches are written in the order they were planned. */
  batchId?: number;
  /** Position in the batch (1-based), set when the batch is planned. */
  order: number;
  /** What kind of page it is (`location`, `service`, `blog`, `landing`, `other`); the sample takes one of each. */
  pageType?: string | null;
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
  /** How many pages (live pages only) the gate releases now. */
  allowed: number;
  /** The sample's pages: one of each page type, filled up to the project's size. */
  sample: number[];
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
 * The order pages are written in: batch by batch as planned, then page by page.
 * @param a - One page.
 * @param b - Another.
 */
function plannedOrder(a: GatePage, b: GatePage): number {
  return (a.batchId ?? 0) - (b.batchId ?? 0) || a.order - b.order || a.id - b.id;
}

/**
 * The sample: the first page of every page type, in planned order, then the
 * next pages until it holds `size`. A project planning only blog posts samples
 * three of them; one planning locations, services and posts samples one of
 * each even when that is more than three.
 * @param live - The live pages, in planned order.
 * @param size - The project's sample size.
 */
export function samplePages(live: readonly GatePage[], size: number): GatePage[] {
  const seen = new Set<string>();
  const picked = new Set<number>();
  for (const p of live) {
    const kind = p.pageType?.trim() || '(untyped)';
    if (!seen.has(kind)) {
      seen.add(kind);
      picked.add(p.id);
    }
  }
  for (const p of live) {
    if (picked.size >= size) {
      break;
    }
    picked.add(p.id);
  }
  return live.filter(p => picked.has(p.id));
}

/**
 * Where a project stands, and what may be written now. Pass every live page
 * of the project's signed-off plans, across its batches.
 * @param pages - The pages, any order.
 * @param config - The project's sizes.
 */
export function evaluateGate(pages: readonly GatePage[], config: SeoGateConfig = DEFAULT_SEO_GATE): GateState {
  const live = pages.filter(p => !OUT.has(p.status)).sort(plannedOrder);
  const total = live.length;
  const sample = samplePages(live, config.sample);
  const sampleIds = new Set(sample.map(p => p.id));
  const after = live.filter(p => !sampleIds.has(p.id));
  const tranche = after.slice(0, config.tranche);
  const everyApproved = (list: readonly GatePage[]) => list.every(p => p.approved);

  let stage: SeoGateStage = 'sample';
  let released: GatePage[] = sample;
  if (sample.length > 0 && everyApproved(sample)) {
    stage = 'tranche';
    released = [...sample, ...tranche];
    if (everyApproved(released) && released.length < total) {
      stage = 'open';
      released = live;
    } else if (released.length === total && everyApproved(released)) {
      // Nothing left past the tranche, and all of it approved: call it open.
      stage = 'open';
    }
  }
  const allowed = released.length;

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
    sample: sample.map(p => p.id),
    written,
    approved,
    changesRequested,
    total,
    released: released.map(p => p.id),
    writable,
    feedbackToFile,
    waitingOnSignoff,
    line: gateLine({ stage, allowed, written, approved, total, sampleEnd: sample.length, feedbackToFile: feedbackToFile.length, waiting: waitingOnSignoff.length, writable: writable.length }),
  };
}

/**
 * The project's gate as one batch reads it: the batch's own counts, the
 * project's stage, and what holds it, in the one line the batch page shows.
 * @param state - The project's gate.
 * @param pages - The batch's pages.
 */
export function batchView(state: GateState, pages: readonly GatePage[]): GateState {
  const live = pages.filter(p => !OUT.has(p.status));
  const ids = new Set(live.map(p => p.id));
  const mine = (list: number[]) => list.filter(id => ids.has(id));
  const written = live.filter(p => p.written).length;
  const approved = live.filter(p => p.approved).length;
  const changesRequested = live.filter(p => p.changesRequested).length;
  const released = mine(state.released);
  const writable = mine(state.writable);
  const waitingOnSignoff = mine(state.waitingOnSignoff);
  return {
    ...state,
    allowed: released.length,
    written,
    approved,
    changesRequested,
    total: live.length,
    released,
    writable,
    waitingOnSignoff,
    // Feedback anywhere in the project holds this batch too.
    line: gateLine({ stage: state.stage, allowed: released.length, written, approved, total: live.length, sampleEnd: state.sample.length, feedbackToFile: state.feedbackToFile.length, waiting: waitingOnSignoff.length, writable: writable.length, elsewhere: state.waitingOnSignoff.length - waitingOnSignoff.length }),
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
 * @param s.sampleEnd - The project's sample size.
 * @param s.feedbackToFile - Pages whose feedback is not filed.
 * @param s.waiting - Released pages waiting on a sign-off.
 * @param s.writable - Pages that may be written now.
 * @param s.elsewhere - Pages in the project's other batches waiting on a sign-off.
 */
function gateLine(s: { stage: SeoGateStage; allowed: number; written: number; approved: number; total: number; sampleEnd: number; feedbackToFile: number; waiting: number; writable: number; elsewhere?: number }): string {
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
  if (s.writable === 0 && s.waiting === 0 && (s.elsewhere ?? 0) > 0) {
    return s.stage === 'sample'
      ? `${head} · waiting on your feedback on the project's sample`
      : `${head} · waiting on your feedback on ${pages(s.elsewhere!)} in this project`;
  }
  if (s.writable === 0 && s.waiting > 0) {
    return s.stage === 'sample'
      ? `${head} · waiting on your feedback on the sample of ${s.sampleEnd}`
      : `${head} · waiting on your feedback on ${pages(s.waiting)}`;
  }
  if (s.stage === 'sample' && s.allowed === 0) {
    return `${head} · nothing released until the project's sample is signed off`;
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
      ? `it is past the sample: a person has to sign off on the project's sample first (${state.sample.length} ${state.sample.length === 1 ? 'page' : 'pages'}, one of each page type: ${state.sample.map(id => `#${id}`).join(', ')})`
      : `it is past the ${state.stage}: every released page in the project (${state.allowed}) has to be approved first`;
  }
  if (state.waitingOnSignoff.includes(pageId)) {
    return 'its draft is waiting on a person\'s sign-off';
  }
  return 'it is already approved';
}

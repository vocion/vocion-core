import type { InboxItem, InboxKind, OpenQueue } from '@/services/InboxService';

/**
 * WHICH OPEN DECISIONS ON THE REVIEW QUEUE A REQUEST MEANS, read from the
 * queue itself (2026-10-23).
 *
 * On a workspace's Review queue a person wrote "can we kill all these old GTM
 * recommendations? anything older than 5 days?". The agent's only read of the
 * queue was `query_state`'s decision set, which (a) keeps only the person's own
 * rows, not the queue the page shows, and (b) takes dates as a facet filter it
 * wrote as `{"since": "-5d"}`: the past five days, the opposite of what was
 * asked. It found nothing and asked the person for ids.
 *
 * A selection here is typed: an age window in whole days on each side
 * (`olderThanDays`, `newerThanDays`), the kinds and agents the page's own
 * chips filter by, and its search. It reads the same rows the page renders
 * (`openQueue`, the open tab) and expands each into every decision it stands
 * for, so a count is the count of things a person would decide.
 *
 * WHAT A ROW STANDS FOR (2026-10-23, the second clear-out: "close work older
 * than 7 days" left rows of 30 to 51 days on the page). A row is more than
 * its own id:
 * - a decision sheet is the asks under one group key, or the proposals about
 *   one record, each aged by its own wait;
 * - an ask carries the later asks that only chased it (`reAskChain.ts`);
 * - the agenda folds related decisions into the oldest (`decisionTopic.ts`).
 * Declined alone, the row's id goes and the rest stays open, and the next read
 * stands one of them up as the row again, same title. A chase and a folded
 * decision go with their row.
 *
 * What a row's Decline cannot take is counted, by kind and why, never
 * dropped: a paused run is resumed or cancelled, a failure retried or
 * dismissed, an approved hand-off marked done, each on its own page.
 */

/** Kinds a person declines from the queue's rows: asks, proposed actions (a failed one too: Reject dismisses it) and suggested rules. */
export const DECLINABLE_KINDS: readonly InboxKind[] = ['proposal', 'ruling', 'approval', 'merge', 'input', 'credential', 'gate', 'recommendation', 'learning'];

/** Each kind's plural as the page's chips write it (`inboxMeta.ts`), for a card or a line written on the server. */
export const KIND_PLURAL: Record<InboxKind, string> = {
  proposal: 'Recommendations',
  ruling: 'Rulings',
  approval: 'Approvals',
  merge: 'Merges',
  input: 'Inputs',
  credential: 'Credentials',
  gate: 'Gates',
  recommendation: 'Choices',
  run: 'Runs',
  exception: 'Exceptions',
  learning: 'Suggested rules',
};

/** What a decline names: an ask, a proposed action, a suggested rule. */
export const QUEUE_REF = /^(?:ask|proposal|learning):\d+$/;

/** One decision a person would make, whether it shows as its own row, under a sheet, or folded into another. */
export type QueueTarget = {
  /** `ask:<id>` | `proposal:<id>` | `learning:<id>` — what a decline names. */
  ref: string;
  kind: InboxKind;
  title: string;
  /** When it started waiting. */
  at: Date;
  agentSlug: string | null;
  /** Where a person opens it. */
  href: string;
  /** True when it is folded into another row (a chase, a related decision) rather than a row or sheet of its own. */
  folded?: boolean;
};

/** Matching decisions a decline cannot take, by kind and why. */
export type LeftOpen = { kind: InboxKind; count: number; why: string };

/** A request's selection, as the tool takes it. */
export type QueueFilter = {
  /** Only what has waited at least this many whole days. */
  olderThanDays?: number;
  /** Only what has waited less than this many whole days. */
  newerThanDays?: number;
  kinds?: InboxKind[];
  agents?: string[];
  q?: string;
};

export type QueueSelection = {
  /** Matching decisions a decline takes, longest waiting first. */
  targets: QueueTarget[];
  /** The page's rows they come from. */
  rows: number;
  /** Every row on the open tab, before this selection: the page's Open count. */
  open: number;
  /** Of those, the failed runs to retry or dismiss; the rest are the decisions the badge counts. */
  failed: number;
  /** Matching decisions a decline cannot take, by kind and why. */
  leftOpen: LeftOpen[];
};

const DAY_MS = 86_400_000;

/** Why a row's kind is not declined from the queue. */
const WHY: Partial<Record<InboxKind, string>> = {
  run: 'a paused run is resumed or cancelled on its own page',
  exception: 'a failure is retried or dismissed on its own page',
};
const HANDED_OFF = 'approved and handed off: marked done or rejected on its own page';
const OWN_PAGE = 'decided on its own page';

/**
 * Whole days something has waited. Pure.
 * @param at - When it started waiting.
 * @param now - The clock.
 */
export function waitedDays(at: Date, now: Date): number {
  return Math.floor((now.getTime() - at.getTime()) / DAY_MS);
}

/**
 * Whether a wait falls in the window: at least `olderThanDays`, under
 * `newerThanDays`. Pure.
 * @param at - When it started waiting.
 * @param now - The clock.
 * @param f - The window.
 * @param f.olderThanDays - Lower bound, in whole days.
 * @param f.newerThanDays - Upper bound, in whole days.
 */
export function inAgeWindow(at: Date, now: Date, f: Pick<QueueFilter, 'olderThanDays' | 'newerThanDays'>): boolean {
  const days = (now.getTime() - at.getTime()) / DAY_MS;
  if (f.olderThanDays !== undefined && days < f.olderThanDays) {
    return false;
  }
  if (f.newerThanDays !== undefined && days >= f.newerThanDays) {
    return false;
  }
  return true;
}

/**
 * The selection in words, for a card or a line: "Recommendations waiting 5 days or more". Pure.
 * @param f - The filter.
 * @param kindPlural - A kind's plural as the page writes it.
 */
export function describeFilter(f: QueueFilter, kindPlural: (k: InboxKind) => string): string {
  const noun = f.kinds && f.kinds.length > 0 ? f.kinds.map(kindPlural).join(' and ') : 'Open decisions';
  const parts = [
    f.olderThanDays !== undefined ? `waiting ${f.olderThanDays} ${f.olderThanDays === 1 ? 'day' : 'days'} or more` : null,
    f.newerThanDays !== undefined ? `waiting under ${f.newerThanDays} ${f.newerThanDays === 1 ? 'day' : 'days'}` : null,
    f.agents && f.agents.length > 0 ? `from ${f.agents.join(', ')}` : null,
    f.q ? `matching "${f.q}"` : null,
  ].filter(Boolean);
  return [noun, ...parts].join(' ');
}

/**
 * What a single row's own decline names, or why it has none. Pure.
 * @param item - The row.
 */
function ownRef(item: InboxItem): { ref: string } | { why: string } {
  if (!DECLINABLE_KINDS.includes(item.kind)) {
    return { why: WHY[item.kind] ?? OWN_PAGE };
  }
  if (item.kind === 'proposal' && item.status === 'awaiting_execution') {
    return { why: HANDED_OFF };
  }
  const ref = item.askId !== undefined
    ? `ask:${item.askId}`
    : item.reviewId !== undefined
      ? `proposal:${item.reviewId}`
      : item.kind === 'learning' && item.ref?.kind === 'learning'
        ? `learning:${item.ref.id}`
        : null;
  return ref && QUEUE_REF.test(ref) ? { ref } : { why: OWN_PAGE };
}

/** A sheet member as the sheet's reader returns it. */
export type SheetMember = QueueTarget & { status?: string };

/**
 * The targets among the queue's rows: each row expanded into every decision
 * it stands for. Pure.
 * @param queue - The open tab's rows with what each folds in (`openQueue`).
 * @param members - A sheet's `key` → the decisions under it.
 * @param f - The age window.
 * @param now - The clock.
 */
export function pickTargets(queue: Pick<OpenQueue, 'items' | 'folded'>, members: ReadonlyMap<string, SheetMember[]>, f: QueueFilter, now: Date): Omit<QueueSelection, 'open' | 'failed'> {
  const targets: QueueTarget[] = [];
  const seen = new Set<string>();
  const left = new Map<string, LeftOpen>();
  const leave = (kind: InboxKind, why: string) => {
    const k = `${kind}|${why}`;
    left.set(k, { kind, why, count: (left.get(k)?.count ?? 0) + 1 });
  };
  const take = (t: QueueTarget) => {
    if (!seen.has(t.ref)) {
      seen.add(t.ref);
      targets.push(t);
    }
  };
  // One row's own decisions: a sheet's members, each by its own wait, or the row itself.
  const own = (item: InboxItem, folded: boolean, windowed: boolean): number => {
    if (item.shape === 'sheet') {
      let n = 0;
      for (const m of members.get(item.key) ?? []) {
        if (windowed && !inAgeWindow(m.at, now, f)) {
          continue;
        }
        if (m.status === 'awaiting_execution') {
          leave(item.kind, HANDED_OFF);
          continue;
        }
        take({ ...m, ...(folded ? { folded: true } : {}) });
        n += 1;
      }
      return n;
    }
    if (windowed && !inAgeWindow(item.at, now, f)) {
      return 0;
    }
    const r = ownRef(item);
    if ('why' in r) {
      leave(item.kind, r.why);
      return 0;
    }
    take({ ref: r.ref, kind: item.kind, title: item.title, at: item.at, agentSlug: item.agentSlug, href: item.href, ...(folded ? { folded: true } : {}) });
    return 1;
  };
  let rows = 0;
  for (const item of queue.items) {
    if (own(item, false, true) === 0) {
      continue;
    }
    rows += 1;
    // What goes with it: the asks that only chased it, and the related
    // decisions folded into it (with their own sheets and chases).
    for (const id of item.chases ?? []) {
      take({ ref: `ask:${id}`, kind: item.kind, title: `${item.title} (asked again)`, at: item.at, agentSlug: item.agentSlug, href: item.href, folded: true });
    }
    for (const member of queue.folded.get(item.key) ?? []) {
      own(member, true, false);
      for (const id of member.chases ?? []) {
        take({ ref: `ask:${id}`, kind: member.kind, title: `${member.title} (asked again)`, at: member.at, agentSlug: member.agentSlug, href: member.href, folded: true });
      }
    }
  }
  targets.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { targets, rows, leftOpen: [...left.values()].sort((a, b) => b.count - a.count) };
}

/**
 * Read the selection from the workspace's queue: the same rows the Review
 * queue page renders, each expanded into what it stands for.
 * @param orgId - The workspace.
 * @param f - The selection.
 * @param now - The clock.
 */
export async function selectQueue(orgId: string, f: QueueFilter, now = new Date()): Promise<QueueSelection> {
  const { openQueue } = await import('@/services/InboxService');
  const queue = await openQueue(orgId, { kinds: f.kinds ?? [], agents: f.agents ?? [], q: f.q ?? '' });
  const rows = [...queue.items, ...[...queue.folded.values()].flat()];
  const sheets = rows.filter(i => i.shape === 'sheet' && i.groupKey && DECLINABLE_KINDS.includes(i.kind));
  const members = new Map<string, SheetMember[]>();
  if (sheets.length > 0) {
    const [{ and, eq, inArray }, { db }, { askSchema }, { listReviewRows }, { recordKeyOf }, { inboxHref }] = await Promise.all([
      import('drizzle-orm'),
      import('@/libs/DB'),
      import('@/models/Schema'),
      import('@/services/inbox/reviewRows'),
      import('@/services/inbox/recordKey'),
      import('@/services/inbox/inboxRef'),
    ]);
    const askSheets = sheets.filter(s => s.kind !== 'proposal');
    if (askSheets.length > 0) {
      const asks = await db
        .select({ id: askSchema.id, title: askSchema.title, createdAt: askSchema.createdAt, agentSlug: askSchema.agentSlug, groupKey: askSchema.groupKey })
        .from(askSchema)
        .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), inArray(askSchema.groupKey, askSheets.map(s => s.groupKey!))));
      for (const sheet of askSheets) {
        members.set(sheet.key, asks.filter(a => a.groupKey === sheet.groupKey).map(a => ({ ref: `ask:${a.id}`, kind: sheet.kind, title: a.title, at: a.createdAt, agentSlug: a.agentSlug, href: inboxHref('ask', a.id) })));
      }
    }
    const proposalSheets = sheets.filter(s => s.kind === 'proposal');
    if (proposalSheets.length > 0) {
      // One read of the open proposals, grouped by record: a read per sheet
      // re-read the whole queue (and its decided history) once per record.
      const open = await listReviewRows(orgId, 'open');
      for (const sheet of proposalSheets) {
        members.set(sheet.key, open.filter(r => recordKeyOf(r) === sheet.groupKey).map(r => ({ ref: `proposal:${r.id}`, kind: 'proposal' as const, title: r.described.title, at: r.createdAt, agentSlug: r.described.agentSlug ?? null, href: inboxHref('proposal', r.id), status: r.status })));
      }
    }
  }
  return { ...pickTargets(queue, members, f, now), open: queue.open, failed: queue.failed };
}

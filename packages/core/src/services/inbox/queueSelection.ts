import type { InboxItem, InboxKind } from '@/services/InboxService';

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
 * (`listInbox`, open tab) and expands a decision sheet into the asks or
 * proposals under it, each aged by its own wait, so a count is the count of
 * things a person would decide.
 */

/** Kinds a person declines from the queue's rows: asks and recommended actions. Runs, exceptions and suggested rules have verbs of their own. */
export const DECLINABLE_KINDS: readonly InboxKind[] = ['proposal', 'ruling', 'approval', 'merge', 'input', 'credential', 'gate', 'recommendation'];

/** One decision a person would make, whether it shows as its own row or under a sheet. */
export type QueueTarget = {
  /** `ask:<id>` | `proposal:<id>` — what a decline names. */
  ref: string;
  kind: InboxKind;
  title: string;
  /** When it started waiting. */
  at: Date;
  agentSlug: string | null;
  /** Where a person opens it. */
  href: string;
};

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
  /** Matching decisions, longest waiting first. */
  targets: QueueTarget[];
  /** Every open decision on the queue, before this selection. */
  open: number;
  /** Matching rows left out because their kind is not declined from a row (`run`: 2). */
  notDeclinable: Partial<Record<InboxKind, number>>;
};

const DAY_MS = 86_400_000;

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
 * The targets among the queue's rows, a sheet expanded into its members. Pure.
 * @param items - The open tab's rows, the page's kind/agent/search filters applied.
 * @param members - A sheet's `key` → the decisions under it.
 * @param f - The age window.
 * @param now - The clock.
 */
export function pickTargets(items: readonly InboxItem[], members: ReadonlyMap<string, QueueTarget[]>, f: QueueFilter, now: Date): Omit<QueueSelection, 'open'> {
  const targets: QueueTarget[] = [];
  const notDeclinable: Partial<Record<InboxKind, number>> = {};
  for (const item of items) {
    const rows: QueueTarget[] = item.shape === 'sheet'
      ? members.get(item.key) ?? []
      : [{ ref: item.askId !== undefined ? `ask:${item.askId}` : item.reviewId !== undefined ? `proposal:${item.reviewId}` : item.key, kind: item.kind, title: item.title, at: item.at, agentSlug: item.agentSlug, href: item.href }];
    for (const row of rows.filter(r => inAgeWindow(r.at, now, f))) {
      if (!DECLINABLE_KINDS.includes(item.kind) || item.status === 'awaiting_execution' || !/^(?:ask|proposal):\d+$/.test(row.ref)) {
        notDeclinable[item.kind] = (notDeclinable[item.kind] ?? 0) + 1;
        continue;
      }
      targets.push(row);
    }
  }
  targets.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { targets, notDeclinable };
}

/**
 * Read the selection from the workspace's queue: the same rows the Review
 * queue page renders, sheets expanded.
 * @param orgId - The workspace.
 * @param f - The selection.
 * @param now - The clock.
 */
export async function selectQueue(orgId: string, f: QueueFilter, now = new Date()): Promise<QueueSelection> {
  const { listInbox } = await import('@/services/InboxService');
  const inbox = await listInbox(orgId, { tab: 'open', kinds: f.kinds ?? [], agents: f.agents ?? [], q: f.q ?? '' });
  const members = new Map<string, QueueTarget[]>();
  const sheets = inbox.items.filter(i => i.shape === 'sheet' && i.groupKey && DECLINABLE_KINDS.includes(i.kind));
  if (sheets.length > 0) {
    const [{ and, eq, inArray }, { db }, { askSchema }, { listReviewRowsForRecord }, { inboxHref }] = await Promise.all([
      import('drizzle-orm'),
      import('@/libs/DB'),
      import('@/models/Schema'),
      import('@/services/inbox/reviewRows'),
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
    for (const sheet of sheets.filter(s => s.kind === 'proposal')) {
      const { open } = await listReviewRowsForRecord(orgId, sheet.groupKey!);
      members.set(sheet.key, open.map(r => ({ ref: `proposal:${r.id}`, kind: 'proposal' as const, title: r.described.title, at: r.createdAt, agentSlug: r.described.agentSlug ?? null, href: inboxHref('proposal', r.id) })));
    }
  }
  return { ...pickTargets(inbox.items, members, f, now), open: inbox.tabs.open };
}

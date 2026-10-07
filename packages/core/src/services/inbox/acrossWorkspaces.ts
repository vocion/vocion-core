/**
 * NEEDS YOU, ACROSS YOUR WORKSPACES (Vocion 5.0, phase 2b).
 *
 * The review queue answers "what is waiting in this workspace". A person who
 * works in several (and now has one of their own) asks "what is waiting on
 * me", and the answer is the same rows, gathered: each reachable workspace's
 * open queue after its own admission bar (`needsYouItems`), tagged with the
 * workspace it lives in and a link that opens it there.
 *
 * - **Which workspaces**: the switcher's list (`listProjectsForUser`), so this
 *   reaches exactly what switching could reach: someone else's personal
 *   workspace never, and with `VOCION_ENFORCE_WORKSPACE_ACCESS` on only what
 *   the person holds a grant on.
 * - **Yours first**: a row is the person's when it sits in their own
 *   workspace, when a proposal is assigned to them
 *   (`review_assignment.assigned_to`), or when their own turn raised an ask
 *   (`ask.created_by`). Then oldest first, the queue's own order.
 * - **Bounded**: one read of the workspace list, then each workspace's open
 *   queue, a few at a time, at most {@link PER_WORKSPACE_CAP} rows kept from
 *   each. The counts are the whole queue, so a badge built from them tells the
 *   truth when the list is capped.
 * - **Nothing fails silently**: a workspace whose queue could not be read is
 *   listed under `unavailable` with its reason, not dropped.
 */

import type { InboxItem } from '@/services/InboxService';
import { workspaceUrl } from '@/libs/links';
import { needsYouItems } from '@/services/InboxService';
import { accountsForUser, listProjectsForUser } from '@/services/ProjectService';

/** What a row says about the workspace it is in. */
export type InboxWorkspace = NonNullable<InboxItem['workspace']>;

/** Why a row is the person's own. Null: it is waiting in a workspace they reach, but not on them by name. */
export type YoursBecause = 'personal' | 'assigned' | 'raised' | null;

export type CrossWorkspaceItem = InboxItem & {
  workspace: InboxWorkspace;
  /** The row's own detail page, absolute when the app has a public address: `/w/<slug>/dashboard/inbox/…?account=…`. */
  link: string;
  yours: boolean;
  yoursBecause: YoursBecause;
};

export type WorkspaceQueue = InboxWorkspace & {
  accountId: string;
  accountSlug: string;
  /** Every open decision in the workspace, before the cap. */
  count: number;
  /** How many of them are the person's own. */
  yours: number;
  /** True when fewer rows were kept than `count`. */
  capped: boolean;
};

export type CrossWorkspaceInbox = {
  /** Yours first, then oldest first. Narrowed to one workspace when asked. */
  items: CrossWorkspaceItem[];
  /** Open decisions across every workspace read, before the cap. */
  total: number;
  /** Of those, the person's own. */
  yours: number;
  /** Every workspace read, with its counts — the workspace filter's chips. */
  workspaces: WorkspaceQueue[];
  /** Workspaces whose queue could not be read, with the reason. */
  unavailable: Array<{ workspace: InboxWorkspace; reason: string }>;
};

/** Rows kept per workspace. The person's own rows are kept first. */
export const PER_WORKSPACE_CAP = 50;

/** Workspaces read at once. Each read is a handful of queries; a pool is not a firehose. */
export const FAN_OUT = 4;

/**
 * Run `work` over `items`, at most `limit` at a time, results in input order.
 * @param items - The inputs.
 * @param limit - How many run at once.
 * @param work - The work.
 */
async function pooled<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * Why a row is the person's, or null.
 * @param item - The row.
 * @param workspace - Where it is.
 * @param userId - The person.
 */
export function yoursBecause(item: Pick<InboxItem, 'assignedTo' | 'raisedBy'>, workspace: Pick<InboxWorkspace, 'kind'>, userId: string): YoursBecause {
  if (workspace.kind === 'personal') {
    return 'personal';
  }
  if (item.assignedTo && item.assignedTo === userId) {
    return 'assigned';
  }
  if (item.raisedBy && item.raisedBy === userId) {
    return 'raised';
  }
  return null;
}

/**
 * Yours first, then the longest-waiting first. Ties by key so the order is stable.
 * @param a - A row.
 * @param b - Another row.
 */
export function byYoursThenAge(a: Pick<CrossWorkspaceItem, 'yours' | 'at' | 'key'>, b: Pick<CrossWorkspaceItem, 'yours' | 'at' | 'key'>): number {
  if (a.yours !== b.yours) {
    return a.yours ? -1 : 1;
  }
  const age = a.at.getTime() - b.at.getTime();
  return age !== 0 ? age : a.key.localeCompare(b.key);
}

/**
 * Everything waiting on a person across the workspaces they reach.
 * @param userId - The person.
 * @param opts - Narrowing and seams.
 * @param opts.accountId - Only this account's workspaces. Omit for every account they belong to.
 * @param opts.workspaceId - Keep only this workspace's rows; the counts still cover them all.
 * @param opts.cap - Rows kept per workspace.
 * @param opts.read - One workspace's open rows. Defaults to `needsYouItems`.
 */
export async function listInboxForUser(
  userId: string,
  opts: { accountId?: string; workspaceId?: string; cap?: number; read?: (orgId: string) => Promise<InboxItem[]> } = {},
): Promise<CrossWorkspaceInbox> {
  const cap = opts.cap ?? PER_WORKSPACE_CAP;
  const read = opts.read ?? needsYouItems;
  const [projects, accounts] = await Promise.all([listProjectsForUser(userId), accountsForUser(userId)]);
  const accountSlug = new Map(accounts.map(a => [a.id, a.slug]));
  const reachable = projects
    .filter(p => !opts.accountId || p.accountId === opts.accountId)
    // The person's own first, then by name: the order the filter chips read in.
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'personal' ? -1 : 1));

  const results = await pooled(reachable, FAN_OUT, async (p) => {
    const workspace: InboxWorkspace = { id: p.id, slug: p.slug, name: p.name, kind: p.kind };
    try {
      return { p, workspace, rows: await read(p.id), error: null };
    } catch (error) {
      return { p, workspace, rows: [] as InboxItem[], error: error instanceof Error ? error.message : String(error) };
    }
  });

  const items: CrossWorkspaceItem[] = [];
  const workspaces: WorkspaceQueue[] = [];
  const unavailable: CrossWorkspaceInbox['unavailable'] = [];
  for (const { p, workspace, rows, error } of results) {
    if (error !== null) {
      unavailable.push({ workspace, reason: error });
      continue;
    }
    const account = accountSlug.get(p.accountId) ?? '';
    const tagged = rows.map((row): CrossWorkspaceItem => {
      const because = yoursBecause(row, workspace, userId);
      const named = account ? { accountSlug: account } : {};
      return {
        ...row,
        key: `${p.id}:${row.key}`,
        // In-app links stay relative so the app's own `Link` keeps them as written;
        // `link` is the same page made absolute, for anything that leaves the app.
        href: workspaceUrl(p.slug, row.href, named),
        link: workspaceUrl(p.slug, row.href, { ...named, absolute: true }),
        workspace,
        yours: because !== null,
        yoursBecause: because,
      };
    }).sort(byYoursThenAge);
    const yours = tagged.filter(t => t.yours).length;
    workspaces.push({ ...workspace, accountId: p.accountId, accountSlug: account, count: tagged.length, yours, capped: tagged.length > cap });
    if (!opts.workspaceId || opts.workspaceId === p.id) {
      items.push(...tagged.slice(0, cap));
    }
  }

  items.sort(byYoursThenAge);
  return {
    items,
    total: workspaces.reduce((n, w) => n + w.count, 0),
    yours: workspaces.reduce((n, w) => n + w.yours, 0),
    workspaces,
    unavailable,
  };
}

/** The badge across workspaces: how many decisions wait, how many are the person's own, and where. */
export type CrossWorkspaceCount = {
  total: number;
  yours: number;
  workspaces: Array<Pick<WorkspaceQueue, 'id' | 'slug' | 'name' | 'kind' | 'count' | 'yours'>>;
  /** Workspaces that could not be counted; a badge that left them out says so. */
  unavailable: number;
};

/**
 * The cross-workspace badge, counted exactly as the list counts — one
 * definition of "needs you", the admission bar's.
 * @param userId - The person.
 * @param opts - As {@link listInboxForUser}.
 * @param opts.accountId - Only this account's workspaces.
 */
export async function needsYouCountForUser(userId: string, opts: { accountId?: string } = {}): Promise<CrossWorkspaceCount> {
  const inbox = await listInboxForUser(userId, { ...opts, cap: 0 });
  return {
    total: inbox.total,
    yours: inbox.yours,
    workspaces: inbox.workspaces.map(({ id, slug, name, kind, count, yours }) => ({ id, slug, name, kind, count, yours })),
    unavailable: inbox.unavailable.length,
  };
}

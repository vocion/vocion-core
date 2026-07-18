/**
 * AdoptionService — the read side of user accountability & adoption
 * analytics. SQL aggregations over the `user_activity_event` stream
 * (GROUP BY user / agent / day), plus membership joins so members with
 * zero events still appear (they're the "never adopted" story).
 *
 * Multi-tenant rule: every query takes `orgId` from `guardAuth()` at the
 * router — never from client input. Sessions are derived, not tracked:
 * activity clusters split at 30 minutes of idle (the GA/Amplitude
 * convention), computed with a lag() window over the event stream.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/libs/DB';

export const SESSION_GAP_MINUTES = 30;

/** Selectable analysis window, in days. */
export type AdoptionWindow = 7 | 30 | 90;

export type AdoptionStatus = 'power' | 'active' | 'dormant' | 'never';

/* ------------------------------------------------------------------ */
/* Pure logic (unit-tested)                                            */
/* ------------------------------------------------------------------ */

/**
 * Count derived sessions in a sorted-ascending list of event timestamps:
 * a new session starts on the first event and whenever the gap since the
 * previous event exceeds the idle timeout. Mirrors the SQL lag() window
 * used by the aggregate queries — keep the two in sync.
 * @param timestamps
 * @param gapMinutes
 */
export function countSessions(timestamps: Date[], gapMinutes: number = SESSION_GAP_MINUTES): number {
  const gapMs = gapMinutes * 60_000;
  let sessions = 0;
  let prev: number | null = null;
  for (const t of timestamps) {
    const ms = t.getTime();
    if (prev === null || ms - prev > gapMs) {
      sessions += 1;
    }
    prev = ms;
  }
  return sessions;
}

/**
 * Adoption status for one member over the selected window.
 *
 * - `never`   — no recorded activity, ever
 * - `dormant` — has history, but nothing inside the window
 * - `power`   — active on ≥40% of window days (min 3) with ≥10 interactions
 * - `active`  — everything in between
 * @param opts
 * @param opts.windowDays
 * @param opts.activeDays
 * @param opts.interactions
 * @param opts.hasEverBeenActive
 */
export function classifyStatus(opts: {
  windowDays: number;
  activeDays: number;
  interactions: number;
  hasEverBeenActive: boolean;
}): AdoptionStatus {
  if (!opts.hasEverBeenActive) {
    return 'never';
  }
  if (opts.activeDays === 0) {
    return 'dormant';
  }
  const powerDays = Math.max(3, Math.ceil(opts.windowDays * 0.4));
  if (opts.activeDays >= powerDays && opts.interactions >= 10) {
    return 'power';
  }
  return 'active';
}

/* ------------------------------------------------------------------ */
/* Shared SQL fragments                                                */
/* ------------------------------------------------------------------ */

/**
 * Interactions = deliberate product actions. Heartbeats and logins feed
 * sessions/DAU but aren't "things the user did with the platform".
 * Category-prefix match, so new `chat.*` / `review.*` / `learning.*`
 * events are counted automatically.
 */
const INTERACTION_PREDICATE = sql`(event_type LIKE 'chat.%' OR event_type LIKE 'review.%' OR event_type LIKE 'learning.%')`;

const windowStart = (days: number): Date => new Date(Date.now() - days * 86_400_000);

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const date = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  const res: any = await db.execute(query);
  return (res.rows ?? res) as Row[];
}

/* ------------------------------------------------------------------ */
/* Org overview                                                        */
/* ------------------------------------------------------------------ */

export type AdoptionOverview = {
  windowDays: number;
  activeUsers: number;
  totalMembers: number;
  /** activeUsers ÷ totalMembers, 0..1. */
  adoptionRate: number;
  sessions: number;
  chatMessages: number;
  /** Approvals + feedback + learnings. */
  accountabilityActions: number;
  interactions: number;
  /** Same metrics over the preceding window of equal length. */
  previous: {
    activeUsers: number;
    sessions: number;
    chatMessages: number;
    accountabilityActions: number;
    interactions: number;
  };
};

/**
 * Headline numbers for the org over the window, each with the previous
 * period for delta rendering.
 * @param orgId
 * @param accountId
 * @param days
 */
export async function getOverview(orgId: string, accountId: string | null, days: AdoptionWindow): Promise<AdoptionOverview> {
  const since = windowStart(days);
  const prevSince = windowStart(days * 2);

  const period = async (from: Date, to: Date | null) => {
    const upper = to ? sql` AND created_at < ${to}` : sql``;
    const [agg] = await rows(sql`
      SELECT
        count(DISTINCT user_id)                                    AS active_users,
        count(*) FILTER (WHERE event_type = 'chat.message_sent')   AS chat_messages,
        count(*) FILTER (WHERE event_type = 'review.decided'
                            OR event_type = 'review.feedback'
                            OR event_type = 'learning.added')      AS accountability,
        count(*) FILTER (WHERE ${INTERACTION_PREDICATE})           AS interactions
      FROM user_activity_event
      WHERE org_id = ${orgId} AND created_at >= ${from}${upper}
    `);
    const [sess] = await rows(sql`
      SELECT count(*) AS sessions FROM (
        SELECT created_at - lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS gap
        FROM user_activity_event
        WHERE org_id = ${orgId} AND created_at >= ${from}${upper}
      ) g
      WHERE gap IS NULL OR gap > make_interval(mins => ${SESSION_GAP_MINUTES})
    `);
    return {
      activeUsers: num(agg?.active_users),
      chatMessages: num(agg?.chat_messages),
      accountabilityActions: num(agg?.accountability),
      interactions: num(agg?.interactions),
      sessions: num(sess?.sessions),
    };
  };

  const [current, previous, members] = await Promise.all([
    period(since, null),
    period(prevSince, since),
    countMembers(accountId),
  ]);

  return {
    windowDays: days,
    ...current,
    totalMembers: members,
    adoptionRate: members > 0 ? current.activeUsers / members : 0,
    previous,
  };
}

async function countMembers(accountId: string | null): Promise<number> {
  if (!accountId) {
    return 0;
  }
  const [row] = await rows(sql`SELECT count(*) AS n FROM account_membership WHERE account_id = ${accountId}`);
  return num(row?.n);
}

/**
 * Name/email for one member of the CALLER'S account — the membership
 * join is the tenant boundary. Returns null for any userId outside the
 * account, so drill-down pages can't be used to probe other tenants'
 * users.
 * @param accountId
 * @param userId
 */
export async function getMemberProfile(accountId: string | null, userId: string): Promise<{ name: string | null; email: string | null } | null> {
  if (!accountId) {
    return null;
  }
  const [row] = await rows(sql`
    SELECT u.name, u.email
    FROM account_membership m
    JOIN "user" u ON u.id = m.user_id
    WHERE m.account_id = ${accountId} AND m.user_id = ${userId}
    LIMIT 1
  `);
  if (!row) {
    return null;
  }
  return { name: (row.name as string | null) ?? null, email: (row.email as string | null) ?? null };
}

/* ------------------------------------------------------------------ */
/* Per-user table — the accountability core                            */
/* ------------------------------------------------------------------ */

export type AdoptionUserRow = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  logins: number;
  sessions: number;
  conversations: number;
  messages: number;
  decisions: number;
  learnings: number;
  feedback: number;
  distinctAgents: number;
  activeDays: number;
  interactions: number;
  status: AdoptionStatus;
};

/**
 * One row per account member — including members with zero events, whose
 * status reads `never`. Event aggregates are window-scoped; last login /
 * last active come from the membership columns (lifetime).
 * @param orgId
 * @param accountId
 * @param days
 */
export async function getUserRows(orgId: string, accountId: string | null, days: AdoptionWindow): Promise<AdoptionUserRow[]> {
  if (!accountId) {
    return [];
  }
  const since = windowStart(days);

  const [members, aggregates, sessions, lifetime] = await Promise.all([
    rows(sql`
      SELECT m.user_id, m.role, m.last_login_at, m.last_active_at, u.name, u.email
      FROM account_membership m
      JOIN "user" u ON u.id = m.user_id
      WHERE m.account_id = ${accountId}
      ORDER BY u.name NULLS LAST
    `),
    rows(sql`
      SELECT user_id,
        count(*) FILTER (WHERE event_type = 'auth.login')                AS logins,
        count(*) FILTER (WHERE event_type = 'chat.conversation_created') AS conversations,
        count(*) FILTER (WHERE event_type = 'chat.message_sent')         AS messages,
        count(*) FILTER (WHERE event_type = 'review.decided')            AS decisions,
        count(*) FILTER (WHERE event_type = 'learning.added')            AS learnings,
        count(*) FILTER (WHERE event_type = 'review.feedback')           AS feedback,
        count(DISTINCT agent_slug)                                       AS distinct_agents,
        count(DISTINCT date_trunc('day', created_at))                    AS active_days,
        count(*) FILTER (WHERE ${INTERACTION_PREDICATE})                 AS interactions
      FROM user_activity_event
      WHERE org_id = ${orgId} AND created_at >= ${since}
      GROUP BY user_id
    `),
    rows(sql`
      SELECT user_id, count(*) AS sessions FROM (
        SELECT user_id,
               created_at - lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS gap
        FROM user_activity_event
        WHERE org_id = ${orgId} AND created_at >= ${since}
      ) g
      WHERE gap IS NULL OR gap > make_interval(mins => ${SESSION_GAP_MINUTES})
      GROUP BY user_id
    `),
    rows(sql`
      SELECT user_id, max(created_at) AS last_event_at
      FROM user_activity_event
      WHERE org_id = ${orgId}
      GROUP BY user_id
    `),
  ]);

  const byUser = new Map(aggregates.map(a => [String(a.user_id), a]));
  const sessionsByUser = new Map(sessions.map(s => [String(s.user_id), num(s.sessions)]));
  const lastEventByUser = new Map(lifetime.map(l => [String(l.user_id), date(l.last_event_at)]));

  return members.map((m) => {
    const userId = String(m.user_id);
    const a = byUser.get(userId);
    const lastActiveAt = date(m.last_active_at) ?? lastEventByUser.get(userId) ?? null;
    const interactions = num(a?.interactions);
    const activeDays = num(a?.active_days);
    return {
      userId,
      name: (m.name as string | null) ?? null,
      email: (m.email as string | null) ?? null,
      role: String(m.role),
      lastLoginAt: date(m.last_login_at),
      lastActiveAt,
      logins: num(a?.logins),
      sessions: sessionsByUser.get(userId) ?? 0,
      conversations: num(a?.conversations),
      messages: num(a?.messages),
      decisions: num(a?.decisions),
      learnings: num(a?.learnings),
      feedback: num(a?.feedback),
      distinctAgents: num(a?.distinct_agents),
      activeDays,
      interactions,
      status: classifyStatus({
        windowDays: days,
        activeDays,
        interactions,
        hasEverBeenActive: lastActiveAt !== null,
      }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Per-agent table                                                     */
/* ------------------------------------------------------------------ */

export type AdoptionAgentRow = {
  agentSlug: string;
  /** Distinct users who interacted with this agent in the window. */
  reach: number;
  conversations: number;
  messages: number;
  approvals: number;
  rejections: number;
  /** approvals ÷ (approvals + rejections); null when no decisions. */
  approvalRate: number | null;
  feedbackUp: number;
  feedbackDown: number;
  learnings: number;
};

/**
 * Which agents are actually landing — reach, volume, and trust signals
 * per agent slug over the window.
 * @param orgId
 * @param days
 */
export async function getAgentRows(orgId: string, days: AdoptionWindow): Promise<AdoptionAgentRow[]> {
  const since = windowStart(days);
  const result = await rows(sql`
    SELECT agent_slug,
      count(DISTINCT user_id)                                            AS reach,
      count(*) FILTER (WHERE event_type = 'chat.conversation_created')   AS conversations,
      count(*) FILTER (WHERE event_type = 'chat.message_sent')           AS messages,
      count(*) FILTER (WHERE event_type = 'review.decided' AND metadata ->> 'decision' = 'approved') AS approvals,
      count(*) FILTER (WHERE event_type = 'review.decided' AND metadata ->> 'decision' = 'rejected') AS rejections,
      count(*) FILTER (WHERE event_type = 'review.feedback' AND metadata ->> 'rating' = 'up')   AS feedback_up,
      count(*) FILTER (WHERE event_type = 'review.feedback' AND metadata ->> 'rating' = 'down') AS feedback_down,
      count(*) FILTER (WHERE event_type = 'learning.added')              AS learnings
    FROM user_activity_event
    WHERE org_id = ${orgId} AND created_at >= ${since} AND agent_slug IS NOT NULL
    GROUP BY agent_slug
    ORDER BY reach DESC, messages DESC
  `);
  return result.map((r) => {
    const approvals = num(r.approvals);
    const rejections = num(r.rejections);
    return {
      agentSlug: String(r.agent_slug),
      reach: num(r.reach),
      conversations: num(r.conversations),
      messages: num(r.messages),
      approvals,
      rejections,
      approvalRate: approvals + rejections > 0 ? approvals / (approvals + rejections) : null,
      feedbackUp: num(r.feedback_up),
      feedbackDown: num(r.feedback_down),
      learnings: num(r.learnings),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Daily trend                                                         */
/* ------------------------------------------------------------------ */

export type AdoptionTrendPoint = {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  activeUsers: number;
  interactions: number;
};

/**
 * Daily active users + interactions across the window, zero-filled so
 * charts don't skip quiet days.
 * @param orgId
 * @param days
 */
export async function getTrend(orgId: string, days: AdoptionWindow): Promise<AdoptionTrendPoint[]> {
  const since = windowStart(days);
  const result = await rows(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
      count(DISTINCT user_id)                          AS active_users,
      count(*) FILTER (WHERE ${INTERACTION_PREDICATE}) AS interactions
    FROM user_activity_event
    WHERE org_id = ${orgId} AND created_at >= ${since}
    GROUP BY 1
    ORDER BY 1
  `);
  const byDay = new Map(result.map(r => [String(r.day), r]));
  const out: AdoptionTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    out.push({ day: key, activeUsers: num(row?.active_users), interactions: num(row?.interactions) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Drill-downs                                                         */
/* ------------------------------------------------------------------ */

export type AdoptionEventRecord = {
  id: number;
  eventType: string;
  agentSlug: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type AdoptionUserDetail = {
  user: AdoptionUserRow | null;
  /** Median ms between a run entering review and this user's decision. */
  medianDecisionLatencyMs: number | null;
  perAgent: Array<{ agentSlug: string; conversations: number; messages: number; decisions: number }>;
  trend: AdoptionTrendPoint[];
  recentEvents: AdoptionEventRecord[];
};

/**
 * One person's story: window aggregates, per-agent breakdown, personal
 * daily trend, and a recent-events timeline for drill-down links.
 * @param orgId
 * @param accountId
 * @param userId
 * @param days
 */
export async function getUserDetail(orgId: string, accountId: string | null, userId: string, days: AdoptionWindow): Promise<AdoptionUserDetail> {
  const since = windowStart(days);
  const [allRows, perAgent, latency, daily, recent] = await Promise.all([
    getUserRows(orgId, accountId, days),
    rows(sql`
      SELECT agent_slug,
        count(*) FILTER (WHERE event_type = 'chat.conversation_created') AS conversations,
        count(*) FILTER (WHERE event_type = 'chat.message_sent')         AS messages,
        count(*) FILTER (WHERE event_type = 'review.decided')            AS decisions
      FROM user_activity_event
      WHERE org_id = ${orgId} AND user_id = ${userId} AND created_at >= ${since} AND agent_slug IS NOT NULL
      GROUP BY agent_slug
      ORDER BY messages DESC
    `),
    rows(sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (metadata ->> 'latencyMs')::numeric) AS median_ms
      FROM user_activity_event
      WHERE org_id = ${orgId} AND user_id = ${userId} AND created_at >= ${since}
        AND event_type = 'review.decided' AND metadata ->> 'latencyMs' IS NOT NULL
    `),
    rows(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE ${INTERACTION_PREDICATE}) AS interactions
      FROM user_activity_event
      WHERE org_id = ${orgId} AND user_id = ${userId} AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1
    `),
    rows(sql`
      SELECT id, event_type, agent_slug, resource_type, resource_id, metadata, created_at
      FROM user_activity_event
      WHERE org_id = ${orgId} AND user_id = ${userId} AND event_type <> 'activity.heartbeat'
      ORDER BY created_at DESC
      LIMIT 100
    `),
  ]);

  const byDay = new Map(daily.map(r => [String(r.day), r]));
  const trend: AdoptionTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(key);
    trend.push({ day: key, activeUsers: row ? 1 : 0, interactions: num(row?.interactions) });
  }

  return {
    user: allRows.find(r => r.userId === userId) ?? null,
    medianDecisionLatencyMs: latency[0]?.median_ms == null ? null : Number(latency[0].median_ms),
    perAgent: perAgent.map(r => ({
      agentSlug: String(r.agent_slug),
      conversations: num(r.conversations),
      messages: num(r.messages),
      decisions: num(r.decisions),
    })),
    trend,
    recentEvents: recent.map(r => ({
      id: num(r.id),
      eventType: String(r.event_type),
      agentSlug: (r.agent_slug as string | null) ?? null,
      resourceType: (r.resource_type as string | null) ?? null,
      resourceId: (r.resource_id as string | null) ?? null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: date(r.created_at)!,
    })),
  };
}

export type AdoptionAgentDetail = {
  agent: AdoptionAgentRow | null;
  /** Daily distinct users reaching this agent. */
  reachTrend: Array<{ day: string; reach: number; messages: number }>;
  topUsers: Array<{ userId: string; name: string | null; email: string | null; messages: number; decisions: number }>;
};

/**
 * One agent's adoption curve — reach over time, top users, trust signals.
 * Top-user names/emails resolve only through the caller's account
 * membership; users who acted in the org but are no longer members fall
 * back to their id.
 * @param orgId
 * @param accountId
 * @param slug
 * @param days
 */
export async function getAgentDetail(orgId: string, accountId: string | null, slug: string, days: AdoptionWindow): Promise<AdoptionAgentDetail> {
  const since = windowStart(days);
  const [agents, daily, topUsers] = await Promise.all([
    getAgentRows(orgId, days),
    rows(sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        count(DISTINCT user_id) AS reach,
        count(*) FILTER (WHERE event_type = 'chat.message_sent') AS messages
      FROM user_activity_event
      WHERE org_id = ${orgId} AND agent_slug = ${slug} AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1
    `),
    rows(sql`
      SELECT e.user_id, u.name, u.email,
        count(*) FILTER (WHERE e.event_type = 'chat.message_sent') AS messages,
        count(*) FILTER (WHERE e.event_type = 'review.decided')    AS decisions
      FROM user_activity_event e
      LEFT JOIN account_membership am ON am.user_id = e.user_id AND am.account_id = ${accountId}
      LEFT JOIN "user" u ON u.id = am.user_id
      WHERE e.org_id = ${orgId} AND e.agent_slug = ${slug} AND e.created_at >= ${since}
      GROUP BY e.user_id, u.name, u.email
      ORDER BY messages DESC
      LIMIT 10
    `),
  ]);

  const byDay = new Map(daily.map(r => [String(r.day), r]));
  const reachTrend: AdoptionAgentDetail['reachTrend'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(key);
    reachTrend.push({ day: key, reach: num(row?.reach), messages: num(row?.messages) });
  }

  return {
    agent: agents.find(a => a.agentSlug === slug) ?? null,
    reachTrend,
    topUsers: topUsers.map(r => ({
      userId: String(r.user_id),
      name: (r.name as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      messages: num(r.messages),
      decisions: num(r.decisions),
    })),
  };
}

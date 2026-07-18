'use client';

import type { AdoptionAgentRow, AdoptionOverview, AdoptionTrendPoint, AdoptionUserRow, AdoptionWindow } from '@/services/adoption/AdoptionService';
import { ArrowUpDown, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { AdoptionStatusPill } from './AdoptionStatusPill';
import { formatAgo, formatCount, formatPercent } from './format';
import { StatCard } from './StatCard';
import { TrendChart } from './TrendChart';

/**
 * Adoption overview — org headline stats, the daily trend, the per-member
 * accountability table, and the per-agent breakdown. Client component:
 * the period picker refetches through `router.adoption.*` without a page
 * reload. Admin-gated at both the page and the router.
 */

export const WINDOW_OPTIONS: AdoptionWindow[] = [7, 30, 90];

export function PeriodPicker(props: { value: AdoptionWindow; onChange: (v: AdoptionWindow) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
      {WINDOW_OPTIONS.map(days => (
        <button
          key={days}
          type="button"
          onClick={() => props.onChange(days)}
          className={cn(
            'px-3 py-1.5 font-medium transition-colors',
            props.value === days ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted/50',
          )}
        >
          {days}
          d
        </button>
      ))}
    </div>
  );
}

type SortKey = keyof Pick<AdoptionUserRow, 'name' | 'lastActiveAt' | 'logins' | 'sessions' | 'messages' | 'decisions' | 'learnings' | 'feedback' | 'distinctAgents' | 'status'>;

const USER_COLUMNS: Array<{ key: SortKey; label: string; title?: string }> = [
  { key: 'name', label: 'Member' },
  { key: 'lastActiveAt', label: 'Last active' },
  { key: 'logins', label: 'Logins', title: 'auth.login events in the window' },
  { key: 'sessions', label: 'Sessions', title: 'Activity clusters split at 30 minutes of idle' },
  { key: 'messages', label: 'Messages', title: 'Chat messages sent' },
  { key: 'decisions', label: 'Approvals', title: 'Review decisions (approve + reject)' },
  { key: 'learnings', label: 'Learnings' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'distinctAgents', label: 'Agents', title: 'Distinct agents interacted with' },
  { key: 'status', label: 'Status', title: 'Power ≥40% of days active with ≥10 interactions · Dormant = no activity in window · Never = no activity ever' },
];

const STATUS_ORDER = { power: 0, active: 1, dormant: 2, never: 3 } as const;

function exportUsersCsv(rows: AdoptionUserRow[], days: number) {
  const header = ['name', 'email', 'role', 'status', 'last_login_at', 'last_active_at', 'logins', 'sessions', 'conversations', 'messages', 'decisions', 'learnings', 'feedback', 'distinct_agents', 'active_days'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v instanceof Date ? v.toISOString() : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')].concat(rows.map(r =>
    [r.name, r.email, r.role, r.status, r.lastLoginAt, r.lastActiveAt, r.logins, r.sessions, r.conversations, r.messages, r.decisions, r.learnings, r.feedback, r.distinctAgents, r.activeDays].map(esc).join(','),
  ));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `adoption-users-${days}d.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function AdoptionDashboard() {
  const [days, setDays] = useState<AdoptionWindow>(30);
  const [overview, setOverview] = useState<AdoptionOverview | null>(null);
  const [users, setUsers] = useState<AdoptionUserRow[] | null>(null);
  const [agents, setAgents] = useState<AdoptionAgentRow[] | null>(null);
  const [trend, setTrend] = useState<AdoptionTrendPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lastActiveAt', dir: -1 });

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      client.adoption.overview({ days }),
      client.adoption.users({ days }),
      client.adoption.agents({ days }),
      client.adoption.trend({ days }),
    ]).then(([o, u, a, t]) => {
      if (!cancelled) {
        setOverview(o);
        setUsers(u);
        setAgents(a);
        setTrend(t);
      }
    }).catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : 'Failed to load adoption data');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const sortedUsers = useMemo(() => {
    if (!users) {
      return null;
    }
    const val = (r: AdoptionUserRow) => {
      if (sort.key === 'status') {
        return STATUS_ORDER[r.status];
      }
      if (sort.key === 'name') {
        return (r.name ?? r.email ?? '').toLowerCase();
      }
      if (sort.key === 'lastActiveAt') {
        return r.lastActiveAt ? new Date(r.lastActiveAt).getTime() : 0;
      }
      return r[sort.key];
    };
    return [...users].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [users, sort]);

  const toggleSort = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));

  if (error) {
    return <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PeriodPicker value={days} onChange={setDays} />
        {overview && (
          <div className="text-[11px] text-muted-foreground">
            vs previous
            {' '}
            {days}
            {' '}
            days
          </div>
        )}
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Active users"
          value={overview ? formatCount(overview.activeUsers) : '…'}
          hint={overview ? `${formatPercent(overview.adoptionRate)} of ${overview.totalMembers} members` : undefined}
          delta={overview ? { current: overview.activeUsers, previous: overview.previous.activeUsers } : undefined}
          definition="Distinct members with at least one activity event in the window"
        />
        <StatCard
          label="Sessions"
          value={overview ? formatCount(overview.sessions) : '…'}
          delta={overview ? { current: overview.sessions, previous: overview.previous.sessions } : undefined}
          definition="Derived visits — activity clusters split at 30 minutes of idle"
        />
        <StatCard
          label="Chat messages"
          value={overview ? formatCount(overview.chatMessages) : '…'}
          delta={overview ? { current: overview.chatMessages, previous: overview.previous.chatMessages } : undefined}
          definition="User messages sent to agents"
        />
        <StatCard
          label="Accountability actions"
          value={overview ? formatCount(overview.accountabilityActions) : '…'}
          delta={overview ? { current: overview.accountabilityActions, previous: overview.previous.accountabilityActions } : undefined}
          definition="Review decisions + feedback given + learnings added"
        />
      </div>

      {/* Daily trend */}
      <div className="rounded-md border border-border p-4">
        <div className="mb-1 text-sm font-semibold">Activity trend</div>
        {trend
          ? <TrendChart data={trend} areaKey="interactions" areaLabel="Interactions" lineKey="activeUsers" lineLabel="Active users" />
          : <div className="h-40 animate-pulse rounded bg-muted/30" />}
      </div>

      {/* Per-member accountability table */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Members</div>
            <div className="text-[11px] text-muted-foreground">Who is actually using the platform — one row per member, window-scoped counts</div>
          </div>
          <button
            type="button"
            onClick={() => sortedUsers && exportUsersCsv(sortedUsers, days)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
          >
            <Download className="size-3.5" />
            CSV
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[11px] text-muted-foreground">
              <tr>
                {USER_COLUMNS.map(col => (
                  <th key={col.key} className="px-3 py-2 text-left font-medium whitespace-nowrap" title={col.title}>
                    <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                      {col.label}
                      <ArrowUpDown className={cn('size-3', sort.key === col.key ? 'opacity-90' : 'opacity-30')} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!sortedUsers && (
                <tr><td colSpan={USER_COLUMNS.length} className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</td></tr>
              )}
              {sortedUsers?.length === 0 && (
                <tr><td colSpan={USER_COLUMNS.length} className="px-3 py-6 text-center text-xs text-muted-foreground">No members found</td></tr>
              )}
              {sortedUsers?.map(r => (
                <tr key={r.userId} className="border-t border-border/50 text-xs">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/adoption/users/${r.userId}`} className="font-medium hover:underline">
                      {r.name ?? r.email ?? r.userId}
                    </Link>
                    {r.role === 'admin' && <span className="ml-1.5 text-[10px] text-muted-foreground/70">admin</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatAgo(r.lastActiveAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.logins}</td>
                  <td className="px-3 py-2 tabular-nums">{r.sessions}</td>
                  <td className="px-3 py-2 tabular-nums">{r.messages}</td>
                  <td className="px-3 py-2 tabular-nums">{r.decisions}</td>
                  <td className="px-3 py-2 tabular-nums">{r.learnings}</td>
                  <td className="px-3 py-2 tabular-nums">{r.feedback}</td>
                  <td className="px-3 py-2 tabular-nums">{r.distinctAgents}</td>
                  <td className="px-3 py-2"><AdoptionStatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-agent breakdown */}
      <div>
        <div className="mb-2">
          <div className="text-sm font-semibold">Agents</div>
          <div className="text-[11px] text-muted-foreground">Which agents are landing — reach, volume, and trust signals</div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Agent</th>
                <th className="px-3 py-2 text-left font-medium" title="Distinct users who interacted with this agent">Reach</th>
                <th className="px-3 py-2 text-left font-medium">Conversations</th>
                <th className="px-3 py-2 text-left font-medium">Messages</th>
                <th className="px-3 py-2 text-left font-medium" title="Approved ÷ all review decisions on this agent's runs">Approval rate</th>
                <th className="px-3 py-2 text-left font-medium" title="Thumbs up / thumbs down on runs">Feedback</th>
                <th className="px-3 py-2 text-left font-medium">Learnings</th>
              </tr>
            </thead>
            <tbody>
              {!agents && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</td></tr>
              )}
              {agents?.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">No agent-attributed activity in this window</td></tr>
              )}
              {agents?.map(a => (
                <tr key={a.agentSlug} className="border-t border-border/50 text-xs">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/adoption/agents/${a.agentSlug}`} className="font-mono font-medium hover:underline">
                      {a.agentSlug}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{a.reach}</td>
                  <td className="px-3 py-2 tabular-nums">{a.conversations}</td>
                  <td className="px-3 py-2 tabular-nums">{a.messages}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPercent(a.approvalRate)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    <span title="thumbs up">
                      ↑
                      {a.feedbackUp}
                    </span>
                    <span className="ml-2 text-muted-foreground" title="thumbs down">
                      ↓
                      {a.feedbackDown}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{a.learnings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

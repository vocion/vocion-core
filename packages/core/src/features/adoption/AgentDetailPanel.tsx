'use client';

import type { AdoptionAgentDetail, AdoptionWindow } from '@/services/adoption/AdoptionService';
import { useEffect, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { PeriodPicker } from './AdoptionDashboard';
import { formatPercent } from './format';
import { StatCard } from './StatCard';
import { TrendChart } from './TrendChart';

/**
 * One agent's adoption curve — reach over time, top users, trust signals.
 */
export function AgentDetailPanel(props: { agentSlug: string }) {
  const [days, setDays] = useState<AdoptionWindow>(30);
  const [detail, setDetail] = useState<AdoptionAgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.adoption.agentDetail({ agentSlug: props.agentSlug, days })
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [props.agentSlug, days]);

  if (error) {
    return <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">{error}</div>;
  }
  if (!detail) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/30" />;
  }

  const a = detail.agent;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <PeriodPicker value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Reach" value={a?.reach ?? 0} definition="Distinct users who interacted with this agent in the window" />
        <StatCard label="Conversations" value={a?.conversations ?? 0} />
        <StatCard label="Messages" value={a?.messages ?? 0} />
        <StatCard label="Approval rate" value={formatPercent(a?.approvalRate ?? null)} hint={a ? `${a.approvals}✓ ${a.rejections}✗` : undefined} definition="Approved ÷ all review decisions on this agent's runs" />
        <StatCard label="Feedback" value={a ? `↑${a.feedbackUp} ↓${a.feedbackDown}` : '—'} />
      </div>

      <div className="rounded-md border border-border p-4">
        <div className="mb-1 text-sm font-semibold">Adoption curve</div>
        <TrendChart data={detail.reachTrend} areaKey="messages" areaLabel="Messages" lineKey="reach" lineLabel="Reach (users)" />
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold">Top users</div>
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Member</th>
                <th className="px-3 py-2 text-left font-medium">Messages</th>
                <th className="px-3 py-2 text-left font-medium">Decisions</th>
              </tr>
            </thead>
            <tbody>
              {detail.topUsers.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-xs text-muted-foreground">No users in this window</td></tr>
              )}
              {detail.topUsers.map(u => (
                <tr key={u.userId} className="border-t border-border/50 text-xs">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/adoption/users/${u.userId}`} className="font-medium hover:underline">
                      {u.name ?? u.email ?? u.userId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{u.messages}</td>
                  <td className="px-3 py-2 tabular-nums">{u.decisions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

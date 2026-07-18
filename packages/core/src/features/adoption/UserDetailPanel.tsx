'use client';

import type { AdoptionUserDetail, AdoptionWindow } from '@/services/adoption/AdoptionService';
import { useEffect, useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { AdoptionStatusPill } from './AdoptionStatusPill';
import { PeriodPicker } from './AdoptionDashboard';
import { formatAgo, formatDuration } from './format';
import { StatCard } from './StatCard';
import { TrendChart } from './TrendChart';

const EVENT_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'activity.heartbeat': 'Active',
  'chat.conversation_created': 'Started a conversation',
  'chat.message_sent': 'Sent a message',
  'review.decided': 'Decided a review',
  'review.feedback': 'Gave feedback',
  'learning.added': 'Added a learning',
};

/** Deep links for resource-anchored events, where a detail page exists. */
function resourceHref(resourceType: string | null, resourceId: string | null): string | null {
  if (!resourceType || !resourceId) {
    return null;
  }
  if (resourceType === 'mission_run') {
    return `/dashboard/missions/runs/${resourceId}`;
  }
  return null;
}

/**
 * One person's adoption story — window aggregates, per-agent breakdown,
 * personal activity trend, and a recent-events timeline.
 */
export function UserDetailPanel(props: { userId: string }) {
  const [days, setDays] = useState<AdoptionWindow>(30);
  const [detail, setDetail] = useState<AdoptionUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    client.adoption.userDetail({ userId: props.userId, days })
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
        }
      })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [props.userId, days]);

  if (error) {
    return <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">{error}</div>;
  }
  if (!detail) {
    return <div className="h-64 animate-pulse rounded-md bg-muted/30" />;
  }

  const u = detail.user;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {u && <AdoptionStatusPill status={u.status} />}
          <span className="text-xs text-muted-foreground">
            Last active
            {' '}
            {formatAgo(u?.lastActiveAt ?? null)}
            {' · '}
            Last login
            {' '}
            {formatAgo(u?.lastLoginAt ?? null)}
          </span>
        </div>
        <PeriodPicker value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Sessions" value={u?.sessions ?? 0} definition="Activity clusters split at 30 minutes of idle" />
        <StatCard label="Messages" value={u?.messages ?? 0} hint={`${u?.conversations ?? 0} conversations`} />
        <StatCard label="Decisions" value={u?.decisions ?? 0} hint={`median ${formatDuration(detail.medianDecisionLatencyMs)}`} definition="Review approvals + rejections; median time from run creation to decision" />
        <StatCard label="Learnings" value={u?.learnings ?? 0} />
        <StatCard label="Feedback" value={u?.feedback ?? 0} />
      </div>

      <div className="rounded-md border border-border p-4">
        <div className="mb-1 text-sm font-semibold">Personal activity</div>
        <TrendChart data={detail.trend} areaKey="interactions" areaLabel="Interactions" lineKey="activeUsers" lineLabel="Active" height={120} />
      </div>

      {detail.perAgent.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold">By agent</div>
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Agent</th>
                  <th className="px-3 py-2 text-left font-medium">Conversations</th>
                  <th className="px-3 py-2 text-left font-medium">Messages</th>
                  <th className="px-3 py-2 text-left font-medium">Decisions</th>
                </tr>
              </thead>
              <tbody>
                {detail.perAgent.map(a => (
                  <tr key={a.agentSlug} className="border-t border-border/50 text-xs">
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/adoption/agents/${a.agentSlug}`} className="font-mono hover:underline">{a.agentSlug}</Link>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{a.conversations}</td>
                    <td className="px-3 py-2 tabular-nums">{a.messages}</td>
                    <td className="px-3 py-2 tabular-nums">{a.decisions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-sm font-semibold">Recent activity</div>
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {detail.recentEvents.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">No recorded activity</div>
          )}
          <ul className="divide-y divide-border/50">
            {detail.recentEvents.map((e) => {
              const href = resourceHref(e.resourceType, e.resourceId);
              const meta = e.metadata as { kind?: string; decision?: string; rating?: string } | null;
              return (
                <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="w-32 shrink-0 text-muted-foreground tabular-nums" title={new Date(e.createdAt).toLocaleString()}>
                    {formatAgo(e.createdAt)}
                  </span>
                  <span className="font-medium">{EVENT_LABELS[e.eventType] ?? e.eventType}</span>
                  {meta?.kind && <span className="text-muted-foreground">{meta.kind}</span>}
                  {meta?.decision && <span className={meta.decision === 'approved' ? 'text-[var(--brand-pass)]' : 'text-[var(--brand-fail)]'}>{meta.decision}</span>}
                  {meta?.rating && <span className="text-muted-foreground">{meta.rating === 'up' ? '↑' : '↓'}</span>}
                  {e.agentSlug && <span className="font-mono text-muted-foreground">{e.agentSlug}</span>}
                  {e.resourceType && (
                    <span className="ml-auto text-muted-foreground/70">
                      {href
                        ? (
                            <Link href={href} className="hover:underline">
                              {e.resourceType}
                              {' '}
                              #
                              {e.resourceId}
                            </Link>
                          )
                        : `${e.resourceType} #${e.resourceId}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

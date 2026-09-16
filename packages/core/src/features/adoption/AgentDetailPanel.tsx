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
 * @param props
 * @param props.agentSlug
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-8">
        <StatCard label="Reach" value={a?.reach ?? 0} definition="Distinct users who interacted with this agent in the window" />
        <StatCard label="Conversations" value={a?.conversations ?? 0} />
        <StatCard label="Messages" value={a?.messages ?? 0} />
        <StatCard label="Approval rate" value={formatPercent(a?.approvalRate ?? null)} hint={a ? `${a.approvals}✓ ${a.rejections}✗ ${a.revisions}✎` : undefined} definition="Approved as-is ÷ every judged decision on this agent's runs. An edited or rewritten draft counts against the rate — the reviewer kept the action but not the wording." />
        <StatCard label="Agreement" value={formatPercent(a?.agreement.agreementRate ?? null)} hint={a && a.agreement.decided > 0 ? `${a.agreement.agreed} of ${a.agreement.decided}` : undefined} definition="How often the reviewer decided the same way this agent recommended. Counts only items it gave a recommendation on, and a snooze it asked for counts as agreement. A different question from the approval rate, which asks whether its output survived untouched." />
        {/*
          Next to Agreement because it answers the neighbouring question: that
          one is about the call, this one about a judgement inside the payload.
          The wording, the placement and whether it belongs on this page at all
          are Drew's to settle (open as of 2026-09-15); the number underneath
          it is what this change makes available.
        */}
        <StatCard label="Label agreement" value={formatPercent(a?.labelAgreement.keptRate ?? null)} hint={a && a.labelAgreement.judged > 0 ? `${a.labelAgreement.kept} of ${a.labelAgreement.judged}` : undefined} definition="Of the fields this agent labelled itself, a series or a group, how many the reviewer left exactly as written. Counts only labelled fields on decided items, so an agent that labels nothing has no score." />
        <StatCard label="Snoozes" value={a?.snoozes ?? 0} definition="Items deferred instead of decided — a snooze leaves the item pending, so it never moves the approval rate" />
        <StatCard label="Feedback" value={a ? `↑${a.feedbackUp} ↓${a.feedbackDown}` : '—'} />
      </div>

      <div className="rounded-md border border-border p-4">
        <div className="mb-1 text-sm font-semibold">Adoption curve</div>
        <TrendChart data={detail.reachTrend} areaKey="messages" areaLabel="Messages" lineKey="reach" lineLabel="Reach (users)" />
      </div>

      <div className="rounded-md border border-border p-4">
        <div className="mb-1 text-sm font-semibold">Approval rate over time</div>
        <p className="mb-2 text-xs text-muted-foreground">
          Cumulative approval rate over the window, over daily judged decisions. Same definition as the stat card: approved as-is ÷ judged; an edited or rewritten draft counts against. Diamonds mark days a rule was adopted — cause next to effect, adjacency not causality.
        </p>
        <TrendChart
          data={detail.approvalTrend}
          areaKey="decisions"
          areaLabel="Decisions"
          lineKey="ratePct"
          lineLabel="Approval % (cumulative)"
          markers={detail.approvalTrend.filter(p => p.adoptions > 0).map(p => ({ day: p.day, label: p.adoptions === 1 ? 'rule adopted' : `${p.adoptions} rules adopted` }))}
        />
      </div>

      <div className="rounded-md border border-border p-4">
        <div className="mb-1 text-sm font-semibold">Confidence alignment</div>
        <p className="mb-2 text-xs text-muted-foreground">
          The agent's stated confidence per proposal against what reviewers decided. An aligned agent knows what it doesn't know; the misalignment row is where the next learning candidate is hiding.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {detail.confidenceAlignment.buckets.map(bucket => (
              <tr key={bucket.label} className="border-t border-border/50 text-xs">
                <td className="py-2 pr-3">{bucket.label}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {bucket.proposals}
                  {' '}
                  proposal
                  {bucket.proposals === 1 ? '' : 's'}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {bucket.approvedPct === null ? '—' : `${bucket.approvedPct}% approved`}
                </td>
              </tr>
            ))}
            {detail.confidenceAlignment.confidentRejectedLast7 > 0 && (
              <tr className="border-t border-border/50 text-xs text-amber-700 dark:text-amber-400">
                <td className="py-2 pr-3" colSpan={2}>
                  ⚠
                  {' '}
                  {detail.confidenceAlignment.confidentRejectedLast7}
                  {' '}
                  confident proposal
                  {detail.confidenceAlignment.confidentRejectedLast7 === 1 ? '' : 's'}
                  {' '}
                  rejected this week
                </td>
                <td className="py-2 text-right">
                  <Link href="/dashboard/inbox" className="hover:underline">review the notes</Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

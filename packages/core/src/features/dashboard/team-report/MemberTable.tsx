import type { MemberReport } from '@/services/TeamReportService';
import { createElement } from 'react';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { Link } from '@/libs/I18nNavigation';
import { AutonomyReadings } from './AutonomyReadings';
import { ago, compact, pct, usd } from './format';
import { KindMix } from './RunKindBadge';

/**
 * The per-member table — dense, one line per agent, inside Evidence. The
 * member's share of the org's operating cost, then control — the rung each
 * action kind stands on and how often the person agreed with it — then the
 * activity: runs by kind, cost, tokens, model, last activity. No per-member
 * "outcome share": a team's outcome is not split across agents (spec §3).
 * Rows link to the member's runs.
 * @param props
 * @param props.members - Rows, in the order to show them.
 * @param props.window - Report window, for the link.
 */
export function MemberTable({ members, window }: { members: MemberReport[]; window: string }) {
  if (members.length === 0) {
    return <p className="py-3 text-sm text-muted-foreground">No agents on this team.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            <th className="py-2 pr-3 font-medium">Member</th>
            <th className="py-2 pr-3 font-medium">Cost share</th>
            <th className="py-2 pr-3 font-medium">Control</th>
            <th className="py-2 pr-3 font-medium">Runs</th>
            <th className="py-2 pr-3 text-right font-medium">Cost</th>
            <th className="py-2 pr-3 text-right font-medium">Tokens</th>
            <th className="py-2 pr-3 font-medium">Model</th>
            <th className="py-2 text-right font-medium">Last active</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const a = agentAccent(m.accent);
            return (
              <tr key={m.slug} className="group border-b border-border/60 last:border-0 hover:bg-muted/40">
                <td className="py-2 pr-3">
                  <Link href={`/dashboard/team-report/${encodeURIComponent(m.slug)}?window=${window}`} className="inline-flex min-w-0 items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ background: a.tint, color: a.ink }}>
                      {createElement(agentIcon(m.icon, { primary: m.isLead }), { 'className': 'size-3.5', 'aria-hidden': true })}
                    </span>
                    <span className="truncate font-medium group-hover:text-primary">{m.name}</span>
                    {m.isLead && <span className="shrink-0 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">lead</span>}
                    {m.active > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                        {m.active}
                        {' '}
                        running
                      </span>
                    )}
                    {m.failed > 0 && <span className="shrink-0 text-[11px] text-rose-700 dark:text-rose-400">{`${m.failed} failed`}</span>}
                  </Link>
                </td>
                <td className="py-2 pr-3"><ShareCell share={m.shareOfCents} tone="primary" /></td>
                <td className="py-2 pr-3"><AutonomyReadings readings={m.contract.autonomy} compact /></td>
                <td className="py-2 pr-3"><KindMix byKind={m.byKind} /></td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums">{usd(m.cents)}</td>
                <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums">{compact(m.tokens)}</td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">
                  {m.models[0] ?? '—'}
                  {m.models.length > 1 ? ` +${m.models.length - 1}` : ''}
                </td>
                <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">{ago(m.lastActivity)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A share as a hairline bar plus the number — the same cell shape for
 * outcome and spend so the eye compares them directly.
 * @param root0
 * @param root0.share
 * @param root0.tone
 */
function ShareCell({ share, tone }: { share: number; tone: 'emerald' | 'primary' }) {
  const fill = tone === 'emerald' ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-primary';
  const track = tone === 'emerald' ? 'bg-emerald-600/15' : 'bg-primary/15';
  return (
    <div className="flex items-center gap-2">
      <span className={`h-1 w-16 rounded-full ${track}`} aria-hidden>
        <span className={`block h-full rounded-full ${fill}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{pct(share)}</span>
    </div>
  );
}

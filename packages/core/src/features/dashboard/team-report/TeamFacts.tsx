import type { TeamReportTeam } from '@/services/TeamReportService';
import { ArrowUpRight } from 'lucide-react';
import { createElement } from 'react';
import { ownerDisplayName } from '@/features/dashboard/teams/helpers';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { Link } from '@/libs/I18nNavigation';
import { RUNG_LABEL } from '@/services/autonomy/rungs';
import { age } from './format';

/**
 * Roster (spec §9): "4 agents · Founder GTM Lead, Event Debrief, …" with the
 * AI team lead distinguished from the accountable owner.
 * @param props
 * @param props.team
 */
export function Roster({ team }: { team: TeamReportTeam }) {
  const owner = team.contract.owner;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Roster</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        <span className="font-medium tabular-nums">
          {team.members.length}
          {team.members.length === 1 ? ' agent' : ' agents'}
        </span>
        {team.members.length > 0 && <span className="text-muted-foreground/60">·</span>}
        {team.members.map((m, i) => {
          const a = agentAccent(m.accent);
          return (
            <span key={m.slug} className="inline-flex items-center gap-1">
              <Link href={`/dashboard/team-report/${encodeURIComponent(m.slug)}`} className="inline-flex items-center gap-1 hover:text-primary">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-sm" style={{ background: a.tint, color: a.ink }}>
                  {createElement(agentIcon(m.icon, { primary: m.isLead }), { 'className': 'size-2.5', 'aria-hidden': true })}
                </span>
                <span className={m.isLead ? 'font-medium' : 'text-foreground/85'}>{m.name}</span>
              </Link>
              {m.isLead && <span className="rounded-sm bg-surface-soft px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">AI lead</span>}
              {i < team.members.length - 1 && <span className="text-muted-foreground/60">,</span>}
            </span>
          );
        })}
        {team.members.length === 0 && <span className="text-muted-foreground">No agents on this team yet</span>}
      </dd>
      <dd className="mt-1 text-xs text-muted-foreground">
        Accountable owner:
        {' '}
        {owner
          ? (
              <span className="text-foreground/85">
                {ownerDisplayName(owner)}
                {owner.source === 'workspace' ? ' (workspace default)' : ''}
              </span>
            )
          : <span className="text-amber-700 dark:text-amber-400">no owner named</span>}
      </dd>
    </div>
  );
}

/**
 * Control (spec §7): autonomy and permissions collapsed into one line —
 * "Human approval required · 5 action types · 0 auto-execute" — linking to
 * the ladder for the detail.
 * @param props
 * @param props.team
 */
export function ControlLine({ team }: { team: TeamReportTeam }) {
  const c = team.control;
  const headline = c.actionTypes === 0
    ? 'Human approval required'
    : c.autoExecute === 0
      ? 'Human approval required'
      : c.autoExecute === c.actionTypes
        ? 'Runs within policy'
        : 'Approval required for most actions';
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Control</dt>
      <dd className="mt-1 text-sm">
        <span className="font-medium">{headline}</span>
        <span className="text-muted-foreground tabular-nums">
          {' · '}
          {c.actionTypes}
          {c.actionTypes === 1 ? ' action type' : ' action types'}
          {' · '}
          {c.autoExecute}
          {' auto-execute'}
          {c.topRung && c.autoExecute > 0 ? ` · up to ${RUNG_LABEL[c.topRung].toLowerCase()}` : ''}
        </span>
        <Link href="/dashboard/autonomy" className="ml-2 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
          Policy
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </dd>
      <dd className="mt-1 text-xs text-muted-foreground">
        {c.actionTypes === 0 ? 'Nothing proposed or permitted yet — every outward action starts at Execute with approval.' : 'What may run without a person is decided per action kind on the autonomy ladder.'}
      </dd>
    </div>
  );
}

/**
 * Needs you (spec §8): a real count and the oldest age, orange only when
 * something is actually waiting. Links to the inbox filtered to the team.
 * @param props
 * @param props.team
 * @param props.now
 */
export function NeedsYou({ team, now = new Date() }: { team: TeamReportTeam; now?: Date }) {
  const n = team.needsYou;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Needs you</dt>
      <dd className="mt-1 text-sm">
        {n.count > 0
          ? (
              <Link href={n.href} className="inline-flex items-center gap-1.5 font-medium text-amber-700 hover:underline dark:text-amber-400">
                <span className="size-2 rounded-full bg-amber-500" aria-hidden />
                {n.count}
                {n.count === 1 ? ' item pending' : ' items pending'}
                {n.oldestAt ? ` · oldest ${age(n.oldestAt, now)}` : ''}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            )
          : (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-full bg-emerald-500/70" aria-hidden />
                No pending escalations
                <Link href={n.href} className="ml-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
                  Inbox
                  <ArrowUpRight className="size-3" aria-hidden />
                </Link>
              </span>
            )}
      </dd>
      <dd className="mt-1 text-xs text-muted-foreground tabular-nums">
        {team.humanLoad.escalationRate === null ? 'Escalation rate appears with the first work items.' : `${Math.round(team.humanLoad.escalationRate * 100)}% escalation rate · ${team.humanLoad.open.blockedMs > 0 ? `${age(new Date(now.getTime() - team.humanLoad.open.blockedMs), now)} blocked waiting for people` : 'nothing blocked'}`}
      </dd>
    </div>
  );
}

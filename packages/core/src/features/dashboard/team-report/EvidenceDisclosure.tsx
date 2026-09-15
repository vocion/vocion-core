import type { OutcomeChain } from '@/services/team-report';
import type { ReportWindow, TeamReportTeam } from '@/services/TeamReportService';
import { ChevronRight } from 'lucide-react';
import { ago, compact, usd } from './format';
import { MemberTable } from './MemberTable';
import { KindMix } from './RunKindBadge';

/**
 * Evidence (spec §13), collapsed: work items · completed · cost on the
 * summary line; inside, one chain per completed outcome —
 * `artifact/action · human decision · resulting external event · cost` —
 * then the per-member activity table. Tokens live here, not on the report.
 * @param props
 * @param props.team
 * @param props.window
 * @param props.now
 */
export function EvidenceDisclosure({ team, window, now = new Date() }: { team: TeamReportTeam; window: ReportWindow; now?: Date }) {
  return (
    <details className="group mt-5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-medium marker:content-none">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        Evidence
        <span className="font-normal text-muted-foreground tabular-nums">
          {' · '}
          {team.evidence.workItems}
          {' work items · '}
          {team.evidence.completed}
          {' completed · '}
          {usd(team.cents)}
        </span>
        <span className="ml-1"><KindMix byKind={team.byKind} /></span>
      </summary>
      <div className="mt-3 space-y-5">
        {team.evidence.chains.length > 0
          ? (
              <div>
                <div className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Completed outcomes</div>
                <ol className="divide-y divide-border/60 border-y border-border/60">
                  {team.evidence.chains.map(c => <ChainLine key={c.actionRunId} chain={c} now={now} />)}
                </ol>
              </div>
            )
          : (
              <p className="text-xs text-muted-foreground">
                No executed actions from this team in the window, so there is no outcome chain to show yet. Runs and spend are below.
              </p>
            )}
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Activity by member</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {team.runs}
              {' runs · '}
              {compact(team.tokens)}
              {' tokens · last '}
              {ago(team.lastActivity, now)}
              {team.judgementCents > 0 ? ` · ${usd(team.judgementCents)} judgement (board, red team)` : ''}
            </div>
          </div>
          <MemberTable members={team.members} window={window} />
        </div>
      </div>
    </details>
  );
}

function ChainLine({ chain, now }: { chain: OutcomeChain; now: Date }) {
  const decision = chain.decision.kind === 'auto-executed'
    ? 'Auto-executed within policy'
    : `${chain.decision.kind === 'edited' ? 'Approved with edits' : chain.decision.kind === 'approved' ? 'Approved' : 'Rejected'}${chain.decision.by ? ` by ${chain.decision.by}` : ''}`;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-xs">
      <span className="font-medium text-foreground">{chain.title}</span>
      <span className="text-muted-foreground">{chain.actionKind}</span>
      <span className="text-muted-foreground/60">·</span>
      <span className="text-foreground/85">{decision}</span>
      <span className="text-muted-foreground/60">·</span>
      {chain.externalEvent
        ? (
            <span className="text-emerald-700 dark:text-emerald-400" title={chain.externalEvent.asOf ? `HubSpot mirror synced ${ago(chain.externalEvent.asOf, now)}` : undefined}>
              {chain.externalEvent.summary}
            </span>
          )
        : <span className="text-muted-foreground">no external record linked</span>}
      <span className="text-muted-foreground/60">·</span>
      <span className="text-muted-foreground">{chain.costCents === null ? 'cost not attributed per action' : usd(chain.costCents)}</span>
      <span className="ml-auto text-muted-foreground tabular-nums">{ago(chain.executedAt, now)}</span>
    </li>
  );
}

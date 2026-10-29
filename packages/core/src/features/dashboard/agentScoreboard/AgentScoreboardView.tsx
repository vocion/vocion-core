import type { ScoreboardQuery } from './scoreboard';
import type { AgentScore, FlaggedTurn } from '@/services/evals/live/signals';
import { StatusPill } from '@/components/ui/status-pill';
import { EnginesControls } from '@/features/dashboard/engines/EnginesControls';
import { Link } from '@/libs/I18nNavigation';
import { agentsOf, BOARD_COLUMNS, FLAG_LABELS, judgedFlags, LEVEL_LABELS, scoreboardHref, turnHref, WINDOWS } from './scoreboard';

function Board({ scores }: { scores: AgentScore[] }) {
  if (scores.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground" data-testid="scoreboard-empty">No agent turns in this window yet. Every finished turn is scored as it ends.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm" data-testid="scoreboard">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-2 pr-4 text-xs font-medium text-muted-foreground">Agent</th>
            <th className="px-3 py-2 text-xs font-medium text-muted-foreground">Level</th>
            {BOARD_COLUMNS.map(c => <th key={c.key} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground" title={c.hint}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {scores.map((s, i) => {
            const first = i === 0 || scores[i - 1]!.agentSlug !== s.agentSlug;
            return (
              <tr key={`${s.agentSlug}/${s.level}`} className={first && i > 0 ? 'border-t border-border' : 'border-b border-border/50'}>
                <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap">{first ? s.agentSlug : ''}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{LEVEL_LABELS[s.level] ?? s.level}</td>
                {BOARD_COLUMNS.map(c => (
                  <td key={c.key} className={`px-3 py-1.5 text-right font-mono tabular-nums ${c.warn(s) ? 'font-semibold text-warn' : ''}`}>{c.value(s)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Turns({ turns, timezone }: { turns: FlaggedTurn[]; timezone: string }) {
  const stamp = (d: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(d);
  if (turns.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground" data-testid="scoreboard-no-flags">No flagged or judged-wrong turns in this window.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Agent</th>
            <th className="px-3 py-2 font-medium">Level</th>
            <th className="px-3 py-2 font-medium">Signals</th>
            <th className="px-3 py-2 text-right font-medium">Calls</th>
            <th className="px-3 py-2 text-right font-medium">Failed</th>
            <th className="px-3 py-2 font-medium">Tool loading</th>
            <th className="px-3 py-2 font-medium">Links</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((t) => {
            const href = turnHref(t);
            return (
              <tr key={t.id} className="border-b border-border/50 align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">{stamp(t.createdAt)}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{t.agentSlug}</td>
                <td className="px-3 py-1.5">{LEVEL_LABELS[t.level ?? 'unknown'] ?? t.level}</td>
                <td className="px-3 py-1.5">
                  <span className="flex flex-wrap gap-1">{[...t.flags, ...judgedFlags(t.judge)].map(f => <StatusPill key={f} status="pending" label={FLAG_LABELS[f] ?? f} size="sm" />)}</span>
                  {typeof t.judge?.note === 'string' && <div className="mt-0.5 max-w-xs text-[12px] text-muted-foreground">{t.judge.note}</div>}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{t.toolCalls}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{t.toolErrors}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{t.toolLoading ?? '—'}</td>
                <td className="px-3 py-1.5 text-[13px] whitespace-nowrap">
                  {href ? <Link href={href} className="underline-offset-2 hover:underline">Conversation</Link> : <span className="text-muted-foreground">—</span>}
                  {t.traceId && <span className="ml-3 font-mono text-[11px] text-muted-foreground" title="Trace id">{t.traceId.slice(0, 8)}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The agent scoreboard (ADR 0010): every agent at every level on the live
 * signals, side by side, then the flagged turns behind them, newest first.
 * The Engines page's frame: window pills, a board, the rows under it.
 * @param props - The page.
 * @param props.query - The window and agent filter in force.
 * @param props.scores - The board (`loadAgentScoreboard`).
 * @param props.turns - Flagged turns (`listFlaggedTurns`), newest first.
 * @param props.since - Where the window starts.
 * @param props.timezone - The workspace's zone, for the turn times.
 * @param props.online - The line on AgentCore online evaluation (`onlineLine`).
 */
export function AgentScoreboardView({ query, scores, turns, since, timezone, online }: { query: ScoreboardQuery; scores: AgentScore[]; turns: FlaggedTurn[]; since: Date; timezone: string; online: string }) {
  const groups = [
    { label: 'Window', choices: WINDOWS.map(d => ({ key: String(d), label: `${d} days`, href: scoreboardHref(query, { days: d }), chosen: query.days === d })) },
  ];
  const note = `Live turns since ${since.toISOString().slice(0, 10)}, scored as each one ended.`;
  const filters = [{ key: 'all', label: 'All agents', agent: null as string | null }, ...agentsOf(scores).map(a => ({ key: a, label: a, agent: a }))];
  return (
    <EnginesControls groups={groups} note={note}>
      <p className="mb-4 text-[13px] text-muted-foreground" data-testid="scoreboard-online">{online}</p>
      <h2 className="mb-2 text-base font-semibold">By agent and level</h2>
      <Board scores={scores} />
      <div className="mt-10 mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Turns worth reading</h2>
        <nav className="flex flex-wrap gap-1 text-xs" aria-label="Agent">
          {filters.map(f => (
            <Link
              key={f.key}
              href={scoreboardHref(query, { agent: f.agent })}
              scroll={false}
              aria-current={query.agent === f.agent ? 'page' : undefined}
              className={query.agent === f.agent
                ? 'rounded-full border border-foreground px-2 py-0.5 font-medium'
                : 'rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground'}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>
      <Turns turns={turns} timezone={timezone} />
    </EnginesControls>
  );
}

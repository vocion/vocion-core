import type { DotTone } from '@/components/patterns';
import type { CheckOutcome, CheckTarget } from '@/libs/automations/checkResult';
import type { PageBlock } from '@/libs/workspace/pageFields';
import type { CheckLogRow, MonitorRow } from '@/services/workspace/monitors';
import { LedgerEntry, LedgerGroup, ListRow, ListRows, StatusDot, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AutomationPauseControl } from '@/features/dashboard/AutomationPauseControl';
import { andList, OUTCOME_LABEL } from '@/libs/automations/checkResult';
import { Link } from '@/libs/I18nNavigation';
import { dayKey, formatDate, formatDateTime, formatTime } from '@/libs/time/zone';
import { timeAgo } from '@/libs/timeAgo';

/**
 * A page's `monitors` and `checkLog` blocks (`libs/workspace/pageFields.ts`):
 * what is watched, each with how often, whether it is on and its last check;
 * and every recent check, newest first, as what it checked and what it saw,
 * with the detail one tap away. Drawn from `services/workspace/monitors.ts`,
 * in the List and Ledger patterns, so a second page that watches something is
 * a block in its YAML.
 */

const TONE: Record<CheckOutcome, DotTone> = { quiet: 'pass', opened: 'fail', updated: 'amber', unchecked: 'amber' };

/**
 * The outcome as a dot and a word.
 * @param props - Props.
 * @param props.outcome - The check's outcome, or null when the run recorded none.
 */
export function OutcomeDot({ outcome }: { outcome: CheckOutcome | null }) {
  return outcome
    ? <StatusDot tone={TONE[outcome]} label={OUTCOME_LABEL[outcome]} />
    : <StatusDot tone="neutral" label="Not recorded" />;
}

function When({ at, now, timeZone }: { at: Date; now: number; timeZone: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={at.toISOString()} className="tabular-nums underline decoration-dotted underline-offset-2">{timeAgo(at, now)}</time>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(at, timeZone)}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Each monitor: what it watches, how often, whether it is on (Pause / Resume),
 * and its last check.
 * @param props - Props.
 * @param props.title - The block's heading.
 * @param props.monitors - The monitors.
 * @param props.now - The clock.
 * @param props.timeZone - The workspace's zone.
 */
export function MonitorsBlock({ title, monitors, now, timeZone }: { title: string; monitors: MonitorRow[]; now: number; timeZone: string }) {
  return (
    <section className="mb-8" data-testid="monitors-block" aria-label={title}>
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {monitors.length === 0
        ? <p className="py-2 text-sm text-muted-foreground">Nothing is watched: this workspace has none of the monitors this page names.</p>
        : (
            <ListRows>
              {monitors.map(m => (
                <ListRow
                  key={m.slug}
                  data-testid={`monitor-${m.slug}`}
                  href={`/dashboard/automation/${m.slug}`}
                  chevron={false}
                  title={m.name}
                  subline={(
                    <span className="flex flex-col gap-0.5">
                      <Subline
                        separator="·"
                        segments={[
                          m.targets.length > 0 ? `${m.kind ? `${m.kind}: ` : ''}${andList(m.targets)}` : 'Not checked yet',
                          m.every,
                          `${m.day.checks} ${m.day.checks === 1 ? 'check' : 'checks'} in 24 h${m.day.opened > 0 ? `, ${m.day.opened} opened an incident` : ''}`,
                        ]}
                      />
                      {m.lastCheck && (
                        <span className="text-[12px] text-muted-foreground">
                          {'Last check '}
                          <When at={m.lastCheck.at} now={now} timeZone={timeZone} />
                          {`: ${m.lastCheck.line}`}
                        </span>
                      )}
                      {m.pause && (
                        <span className="text-[12px] text-amber-600">{`Paused by ${m.pause.byName} since ${m.pause.when}${m.pause.note ? `: ${m.pause.note}` : ''}`}</span>
                      )}
                    </span>
                  )}
                  chip={m.state === 'paused'
                    ? <StatusPill status="paused" label="Paused" size="sm" />
                    : m.state === 'off'
                      ? <StatusPill status="inactive" label="Off" size="sm" />
                      : <OutcomeDot outcome={m.lastCheck?.outcome ?? null} />}
                  actions={m.state === 'off' ? undefined : <AutomationPauseControl slug={m.slug} paused={m.pause} compact />}
                  actionsAlways
                />
              ))}
            </ListRows>
          )}
    </section>
  );
}

/**
 * One target's observation, as facts: every typed field the check stored.
 * @param props - Props.
 * @param props.target - The target.
 */
function TargetDetail({ target }: { target: CheckTarget }) {
  const facts = Object.entries(target.observed).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <div className="space-y-0.5" data-testid="check-target">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">{target.label}</span>
        <OutcomeDot outcome={target.outcome} />
        {target.url && <a href={target.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">open</a>}
        {target.recordId ? <Link href={`/dashboard/objects/${target.recordId}`} className="underline underline-offset-2 hover:text-foreground">record</Link> : null}
      </div>
      <div>{target.outcome === 'unchecked' && target.why ? `Could not check: ${target.why}` : target.summary}</div>
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 font-mono text-[11px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground/70">{k}</dt>
              <dd className="min-w-0 break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The recent checks, newest first under day headings: time, monitor, what it
 * checked and what it saw; the detail is each target's observation, the
 * threshold and the run.
 * @param props - Props.
 * @param props.title - The block's heading.
 * @param props.rows - The runs.
 * @param props.now - The clock.
 * @param props.timeZone - The workspace's zone.
 */
export function CheckLogBlock({ title, rows, now, timeZone }: { title: string; rows: CheckLogRow[]; now: number; timeZone: string }) {
  const days: Array<{ key: string; label: string; rows: CheckLogRow[] }> = [];
  const today = dayKey(new Date(now), timeZone);
  for (const r of rows) {
    const key = dayKey(r.at, timeZone);
    const day = days.find(d => d.key === key);
    if (day) {
      day.rows.push(r);
    } else {
      days.push({ key, label: key === today ? 'Today' : formatDate(r.at, timeZone), rows: [r] });
    }
  }
  return (
    <section className="mt-10" data-testid="check-log" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">No check has run yet.</p>}
      {days.map(d => (
        <LedgerGroup key={d.key} label={d.label} count={d.rows.length}>
          {d.rows.map(r => (
            <LedgerEntry
              key={r.id}
              data-testid="check-log-row"
              className="py-2.5"
              title={<span className="tabular-nums">{formatTime(r.at, timeZone)}</span>}
              when={r.monitor}
              verdict={<OutcomeDot outcome={r.outcome} />}
              summary={r.line}
              detailsLabel="Detail"
              details={(
                <>
                  {r.check?.targets.map(t => <TargetDetail key={t.label} target={t} />)}
                  {r.check?.threshold && <div>{`Threshold: ${r.check.threshold}`}</div>}
                  {r.check?.why && <div>{`Could not check: ${r.check.why}`}</div>}
                  {r.error && <div className="break-words">{r.error}</div>}
                  <div className="font-mono text-[11px] text-muted-foreground/80">
                    {`run #${r.id} · ${r.check?.kind ?? r.slug}${r.finishedAt ? ` · took ${Math.max(0, Math.round((r.finishedAt.getTime() - r.at.getTime()) / 100) / 10)} s` : ''}`}
                  </div>
                </>
              )}
            />
          ))}
        </LedgerGroup>
      ))}
    </section>
  );
}

/** The heading a block carries when the page names none. */
export const BLOCK_TITLE: Record<PageBlock['kind'], string> = { monitors: 'What is watched', checkLog: 'Checks' };

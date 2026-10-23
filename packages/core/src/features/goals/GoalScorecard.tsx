'use client';

import type { GoalScorecard as Scorecard, ScorecardCell } from './types';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * A SPRINT'S SCORECARD — rows are the weekly targets ("Discovery calls ·
 * 3/wk"), columns the latest weeks up to this one, each cell the number
 * logged for that week: met in the pass tone, missed in amber, a dash where
 * nobody logged it yet (a gap reads as a gap, never as a miss). The owner
 * writes a number by clicking its cell; their number holds against every
 * agent from then on, and an empty entry clears it. Hairlines, not boxes;
 * the table scrolls sideways inside itself on a phone, never the page.
 * @param props - The scorecard.
 * @param props.scorecard - Built on the server (`goalPages.scorecardOf`).
 * @param props.editable - The person looking owns the goal.
 * @param props.pending - A write is in flight.
 * @param props.onSet - Write one cell: its week, its target, the number (null clears).
 */
export function GoalScorecard(props: { scorecard: Scorecard; editable: boolean; pending: boolean; onSet: (week: string, key: string, value: number | null) => void }) {
  const { scorecard } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const notes = scorecard.columns.filter(c => c.note);
  // On a phone the latest weeks are what matter: open the scroller at this week.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [scorecard.columns.length]);

  return (
    <div data-testid="goal-scorecard">
      <div ref={scroller} className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="sticky left-0 bg-background py-1.5 pr-3 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Weekly target</th>
              {scorecard.columns.map(c => (
                <th key={c.week} scope="col" className={cn('px-2 py-1.5 text-right text-[12px] font-medium whitespace-nowrap tabular-nums', c.current ? 'text-foreground' : 'text-muted-foreground')} aria-label={`Week of ${c.label}${c.current ? ', this week' : ''}`}>
                  {c.label}
                  {c.current && <span className="block text-[10px] font-normal tracking-[0.04em] text-muted-foreground uppercase">This week</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {scorecard.rows.map(r => (
              <tr key={r.key} data-testid="goal-scorecard-row">
                <th scope="row" className="sticky left-0 max-w-[14rem] bg-background py-1.5 pr-3 text-left font-normal max-md:max-w-[10rem]">
                  <span className="block truncate text-foreground">{r.label}</span>
                  <span className="block text-[12px] text-muted-foreground tabular-nums">
                    {r.perWeek}
                    {r.unit ? ` ${r.unit}` : ''}
                    {' '}
                    a week
                  </span>
                </th>
                {r.cells.map((cell, i) => {
                  const column = scorecard.columns[i]!;
                  const id = `${column.week}|${r.key}`;
                  return (
                    <td key={column.week} className="px-1 py-1 text-right">
                      {editing === id
                        ? (
                            <CellInput
                              initial={cell.value}
                              label={`${r.label}, week of ${column.label}`}
                              onDone={(value) => {
                                setEditing(null);
                                if (value !== undefined && value !== cell.value) {
                                  props.onSet(column.week, r.key, value);
                                }
                              }}
                            />
                          )
                        : (
                            <Cell
                              cell={cell}
                              perWeek={r.perWeek}
                              label={`${r.label}, week of ${column.label}`}
                              disabled={!props.editable || props.pending}
                              onEdit={() => setEditing(id)}
                            />
                          )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-[13px] text-muted-foreground" data-testid="goal-scorecard-notes">
          {notes.map(c => (
            <li key={c.week}>
              <span className="tabular-nums">{c.label}</span>
              {' · '}
              {c.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One number: met, missed, or not logged.
 * @param props - The cell.
 * @param props.cell - What was logged.
 * @param props.perWeek - Its target.
 * @param props.label - What it is, for a screen reader.
 * @param props.disabled - Not the owner, or a write in flight.
 * @param props.onEdit - Start writing it.
 */
function Cell(props: { cell: ScorecardCell; perWeek: number; label: string; disabled: boolean; onEdit: () => void }) {
  const { cell } = props;
  const said = cell.value === null
    ? 'not logged'
    : `${cell.value} of ${props.perWeek}, ${cell.met ? 'met' : 'missed'}${cell.by === 'person' ? ', written by you' : cell.evidence ? `, counted from ${cell.evidence}` : ', logged by the assistant'}`;
  return (
    <button
      type="button"
      onClick={props.onEdit}
      disabled={props.disabled}
      aria-label={`${props.label}: ${said}${props.disabled ? '' : '. Edit'}`}
      title={cell.value === null ? undefined : cell.by === 'person' ? 'Written by you' : cell.evidence ? `Counted from ${cell.evidence}` : 'Logged by the assistant'}
      data-testid="goal-scorecard-cell"
      data-met={cell.met === null ? undefined : String(cell.met)}
      className={cn(
        'inline-flex min-w-10 items-center justify-end rounded px-2 py-1 tabular-nums transition-colors max-md:min-h-11 disabled:cursor-default',
        cell.met === true && 'bg-[var(--brand-pass)]/12 font-medium text-[var(--brand-pass)] dark:bg-[var(--brand-pass)]/30 dark:text-foreground',
        cell.met === false && 'bg-[var(--brand-amber)]/12 font-medium text-[var(--brand-amber-deep)]',
        cell.met === null && 'text-muted-foreground',
        !props.disabled && 'hover:ring-1 hover:ring-border',
      )}
    >
      {cell.value ?? '–'}
      {cell.by === 'person' && <span aria-hidden className="ml-0.5 align-super text-[10px] opacity-70">•</span>}
    </button>
  );
}

/**
 * Writing one number. Enter or leaving the field saves; Escape keeps what
 * was there; an empty field clears it.
 * @param props - The field.
 * @param props.initial - What is there now.
 * @param props.label - What it is.
 * @param props.onDone - The number, null to clear, or undefined to keep.
 */
function CellInput(props: { initial: number | null; label: string; onDone: (value: number | null | undefined) => void }) {
  const [text, setText] = useState(props.initial === null ? '' : String(props.initial));
  const read = (): number | null | undefined => {
    if (!text.trim()) {
      return null;
    }
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- the person just clicked this cell to write it
      autoFocus
      type="number"
      inputMode="decimal"
      min={0}
      value={text}
      aria-label={props.label}
      onChange={e => setText(e.target.value)}
      onBlur={() => props.onDone(read())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          props.onDone(read());
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          props.onDone(undefined);
        }
      }}
      className="w-16 rounded border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
    />
  );
}

'use client';

import type { GoalRow } from './types';
import { Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListToolbar, Subline } from '@/components/patterns';
import { GoalProgressBar } from './GoalProgressBar';

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
] as const;

/**
 * A Goals list, through the shared list pieces (#1313): status tabs, one row
 * per goal — its title, where it stands, its horizon, whose it is, and in
 * Personal where it lives — and in a shared workspace a Mine / Everyone
 * chip. Progress here is the last reading; the goal's page counts it live.
 * @param props - The list.
 * @param props.rows - The goals.
 * @param props.across - Rows span workspaces (Personal): each names its place.
 * @param props.withheld - Orgs that keep their items out of Personal: a count and a link each.
 * @param props.emptyHint - What to say when there are none.
 */
export function GoalsList({ rows, across = false, withheld = [], emptyHint }: { rows: GoalRow[]; across?: boolean; withheld?: Array<{ accountName: string; workspace: string; count: number; link: string }>; emptyHint: string }) {
  const [tab, setTab] = useState<string>('active');
  const [who, setWho] = useState<string[]>(across ? [] : ['mine']);
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, t.key === 'all' ? rows.length : rows.filter(r => r.status === t.key).length])), [rows]);
  const shown = rows.filter(r => (tab === 'all' || r.status === tab || (tab === 'done' && r.status === 'dropped')) && (who.length === 0 || (who.includes('mine') && r.mine) || (who.includes('others') && !r.mine)));

  if (rows.length === 0 && withheld.length === 0) {
    return <ListEmpty icon={Target} title="No goals yet" description={emptyHint} />;
  }
  return (
    <div data-testid="goals-list">
      <ListToolbar
        tabs={{ items: TABS.map(t => ({ key: t.key, label: t.label, count: counts[t.key] })), value: tab, onChange: setTab, label: 'Status' }}
        {...(across ? {} : { chips: { items: [{ key: 'mine', label: 'Mine', count: rows.filter(r => r.mine).length }, { key: 'others', label: 'Others', count: rows.filter(r => !r.mine).length }], active: who, onChange: setWho, allLabel: 'Everyone' } })}
      />
      {shown.length === 0
        ? <ListEmpty variant="inline" title="No goals here" />
        : (
            <ListRows>
              {shown.map(r => (
                <ListRow
                  key={r.id}
                  href={r.href}
                  icon={Target}
                  data-testid="goal-row"
                  title={r.title}
                  subline={<Subline separator="·" segments={[r.horizon, across ? r.place : r.mine ? null : r.owner, r.stalledDays ? `quiet ${r.stalledDays} days` : null, r.status === 'active' ? null : r.status]} />}
                  columns={(
                    <Column kind="contents" align="left" always>
                      <GoalProgressBar ratio={r.ratio} label={r.progress} />
                    </Column>
                  )}
                />
              ))}
            </ListRows>
          )}
      {withheld.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 text-[13px] text-muted-foreground" data-testid="goals-withheld">
          {withheld.map(w => (
            <li key={`${w.accountName}|${w.workspace}`}>
              {`${w.count} ${w.count === 1 ? 'goal' : 'goals'} in ${w.workspace} · ${w.accountName}, which keeps its items out of Personal — `}
              <a href={w.link} className="underline underline-offset-2">open there</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

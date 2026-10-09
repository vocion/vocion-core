'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListRow, ListRows, Subline } from '@/components/patterns';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { client } from '@/libs/Orpc';

type Rhythm = Awaited<ReturnType<typeof client.personal.rhythm>>;
type OrgBriefs = Awaited<ReturnType<typeof client.personal.orgBriefs>>;

/**
 * When the next one arrives, in the person's zone: "Fri, Oct 10, 7:30 AM".
 * @param at - The instant.
 * @param tz - The zone.
 */
function nextLabel(at: Date | string | null, tz: string): string | null {
  if (!at) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
}

/**
 * Your day with your assistant (docs/guides/morning-brief.md): the morning
 * brief and the evening wrap, each one switch and one time, in your zone.
 * The page's zone becomes yours the first time it opens, so 07:30 is your
 * 07:30 without a setting. Every change saves as it is made.
 */
export function RhythmSettings() {
  const [rhythm, setRhythm] = useState<Rhythm | null>(null);
  const [org, setOrg] = useState<OrgBriefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([client.personal.rhythm({ browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }), client.personal.orgBriefs()]);
      setRhythm(r);
      setOrg(o);
    } catch {
      setError('Your brief times could not be read just now.');
    }
  }, []);

  useEffect(() => {
    // Every setState in load() runs after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async (change: Parameters<typeof client.personal.setRhythm>[0]) => {
    try {
      setRhythm(await client.personal.setRhythm(change));
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'That could not be saved.');
    }
  };

  const saveOrg = async (change: Parameters<typeof client.personal.setOrgBriefs>[0]) => {
    try {
      setOrg(await client.personal.setOrgBriefs(change));
      setError(null);
    } catch {
      setError('The Org setting could not be saved.');
    }
  };

  if (!rhythm) {
    return error ? <p className="text-sm text-muted-foreground">{error}</p> : null;
  }

  const rows = [
    { key: 'brief', title: 'Morning brief', what: 'Your meetings, what waits on you in order, what the team did, and what to do first.', on: rhythm.briefOn, at: rhythm.briefAt, next: rhythm.nextBriefAt },
    { key: 'wrap', title: 'Evening wrap', what: 'What got done, what is still open, and what is first tomorrow.', on: rhythm.wrapOn, at: rhythm.wrapAt, next: rhythm.nextWrapAt },
  ] as const;

  return (
    <DashboardSection title="Your day" description={`Your assistant writes these in your Personal workspace, at your times (${rhythm.timeZone}).`}>
      {org && !org.dailyBriefs && (
        <p className="mb-3 text-sm text-muted-foreground" data-testid="org-briefs-off">Your Org has turned daily briefs off, so none arrive whatever is set below.</p>
      )}
      <ListRows>
        {rows.map(r => (
          <ListRow
            key={r.key}
            data-testid={`rhythm-${r.key}`}
            title={r.title}
            subline={<Subline separator="·" segments={[r.on ? `Next ${nextLabel(r.next, rhythm.timeZone)}` : 'Off', r.what]} />}
            actionsAlways
            actions={(
              <span className="flex items-center gap-3">
                <Input
                  type="time"
                  aria-label={`${r.title} time`}
                  className="h-8 w-[6.5rem]"
                  value={r.at}
                  disabled={!r.on}
                  onChange={e => e.target.value && void save(r.key === 'brief' ? { briefAt: e.target.value } : { wrapAt: e.target.value })}
                />
                <Switch on={r.on} label={r.title} onChange={on => void save(r.key === 'brief' ? { briefOn: on } : { wrapOn: on })} />
              </span>
            )}
          />
        ))}
      </ListRows>
      {org?.canChange && (
        <div className="mt-4 flex items-start justify-between gap-4 border-t border-border/60 pt-4" data-testid="org-briefs">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Daily briefs for your Org</p>
            <p className="text-xs text-muted-foreground">
              Everyone who was here this week. Briefs stop for the day once they spend
              {' '}
              <Input
                type="number"
                min={0}
                step={1}
                aria-label="Daily brief budget in dollars"
                className="inline-flex h-7 w-20 px-2 align-middle"
                defaultValue={org.briefDailyCents !== null ? (org.briefDailyCents / 100).toString() : org.defaultCents !== null ? (org.defaultCents / 100).toString() : ''}
                placeholder="no cap"
                onBlur={(e) => {
                  const dollars = e.target.value.trim();
                  void saveOrg({ briefDailyCents: dollars === '' ? null : Math.round(Number(dollars) * 100) });
                }}
              />
              {' '}
              USD a day.
            </p>
          </div>
          <Switch on={org.dailyBriefs} label="Daily briefs for your Org" onChange={on => void saveOrg({ dailyBriefs: on })} />
        </div>
      )}
      {error && <p role="status" className="mt-3 text-sm text-brand-fail">{error}</p>}
    </DashboardSection>
  );
}

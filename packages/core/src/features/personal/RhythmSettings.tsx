'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListRow, ListRows, Subline } from '@/components/patterns';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { client } from '@/libs/Orpc';

type Rhythm = Awaited<ReturnType<typeof client.personal.rhythm>>;
type OrgBriefs = Awaited<ReturnType<typeof client.personal.orgBriefs>>;
type Voices = Awaited<ReturnType<typeof client.personal.voices>>;

/** The speeds a brief starts at. */
const SPEEDS = [1, 1.5, 2] as const;

/** The channels a push can take beyond the app, in the order they are offered. */
const PUSH = [
  { id: 'slack', label: 'Slack DM' },
  { id: 'sms', label: 'Text message' },
  { id: 'email', label: 'Email' },
] as const;

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
  const [voices, setVoices] = useState<Voices | null>(null);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);

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

  const voiceConnected = Boolean(rhythm?.listen.voice);
  useEffect(() => {
    if (!voiceConnected) {
      return;
    }
    let alive = true;
    client.personal.voices().then(v => alive && setVoices(v)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [voiceConnected]);

  const makeFeed = async () => {
    try {
      const made = await client.personal.createFeed();
      setFeedUrl(made.url);
      setRhythm(r => (r ? { ...r, listen: { ...r.listen, feed: { createdAt: made.createdAt, lastFetchedAt: null } } } : r));
    } catch {
      setError('The podcast link could not be made.');
    }
  };

  const stopFeed = async () => {
    try {
      await client.personal.revokeFeed();
      setFeedUrl(null);
      setRhythm(r => (r ? { ...r, listen: { ...r.listen, feed: null } } : r));
    } catch {
      setError('The podcast link could not be stopped.');
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

      <div className="mt-8" data-testid="push-to-you">
        <h3 className="text-sm font-medium">Push to you</h3>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Beyond the app, with a link straight to the item and a one-tap stop in every message. Urgent: an approval holding up a run, or one of your connections breaking.</p>
        <ListRows>
          {PUSH.map((p) => {
            const on = rhythm.pushChannels.includes(p.id);
            const why = rhythm.available[p.id];
            return (
              <ListRow
                key={p.id}
                data-testid={`push-${p.id}`}
                title={p.label}
                subline={<Subline separator="·" segments={[why ?? (on ? 'On' : 'Off')]} />}
                actionsAlways
                actions={<Switch on={on} label={p.label} disabled={Boolean(why) && !on} onChange={next => void save({ pushChannels: next ? [...rhythm.pushChannels, p.id] : rhythm.pushChannels.filter(c => c !== p.id) })} />}
              />
            );
          })}
          <ListRow
            data-testid="push-mode"
            title="Brief and urgent"
            subline={<Subline separator="·" segments={[rhythm.pushMode === 'urgent' ? 'Off: only urgent items push' : 'Your morning brief pushes too']} />}
            actionsAlways
            actions={<Switch on={rhythm.pushMode === 'brief_and_urgent'} label="Push the morning brief too" onChange={on => void save({ pushMode: on ? 'brief_and_urgent' : 'urgent' })} />}
          />
          <ListRow
            data-testid="push-quiet"
            title="Quiet hours"
            subline={<Subline separator="·" segments={[rhythm.quietStart && rhythm.quietEnd ? `Nothing pushes ${rhythm.quietStart}–${rhythm.quietEnd}; urgent items wait until then` : 'None']} />}
            actionsAlways
            actions={(
              <span className="flex items-center gap-1.5">
                <Input type="time" aria-label="Quiet hours start" className="h-8 w-[6.5rem]" value={rhythm.quietStart ?? ''} onChange={e => void save({ quietStart: e.target.value || null })} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="time" aria-label="Quiet hours end" className="h-8 w-[6.5rem]" value={rhythm.quietEnd ?? ''} onChange={e => void save({ quietEnd: e.target.value || null })} />
              </span>
            )}
          />
        </ListRows>
      </div>

      <div className="mt-8" data-testid="listen">
        <h3 className="text-sm font-medium">Listen to my briefs</h3>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Each brief and wrap, told to you out loud in a minute or two: in the app, in Slack, as a text you can play, and in your podcast app.</p>
        <ListRows>
          <ListRow
            data-testid="listen-on"
            title="Read my briefs aloud"
            subline={<Subline separator="·" segments={[rhythm.listen.voice ? ((rhythm.listenOn ?? true) ? `On · ${rhythm.listen.voice.label}` : 'Off') : 'No voice is connected for your Org yet: an admin adds ElevenLabs under Team connectors.']} />}
            actionsAlways
            actions={<Switch on={Boolean(rhythm.listen.voice) && (rhythm.listenOn ?? true)} label="Read my briefs aloud" disabled={!rhythm.listen.voice} onChange={on => void save({ listenOn: on })} />}
          />
          {rhythm.listen.voice && (rhythm.listenOn ?? true) && (
            <>
              <ListRow
                data-testid="listen-voice"
                title="Voice"
                subline={<Subline separator="·" segments={[rhythm.voiceId ? 'Your choice' : org?.briefVoiceId ? 'Your Org\'s voice' : `${rhythm.listen.voice.defaultVoice.name}, the default`]} />}
                actionsAlways
                actions={(
                  <select
                    aria-label="Voice"
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={rhythm.voiceId ?? ''}
                    onChange={e => void save({ voiceId: e.target.value || null })}
                  >
                    <option value="">{org?.briefVoiceId ? 'The Org\'s voice' : `${rhythm.listen.voice.defaultVoice.name} (default)`}</option>
                    {(voices?.voices ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                )}
              />
              <ListRow
                data-testid="listen-speed"
                title="Start at"
                subline={<Subline separator="·" segments={['The player\'s speed when a brief opens; change it any time while listening']} />}
                actionsAlways
                actions={(
                  <select aria-label="Listening speed" className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={String(rhythm.listenSpeed)} onChange={e => void save({ listenSpeed: Number(e.target.value) as 1 | 1.5 | 2 })}>
                    {SPEEDS.map(x => <option key={x} value={String(x)}>{`${x}×`}</option>)}
                  </select>
                )}
              />
              <ListRow
                data-testid="listen-podcast"
                title="Private podcast"
                subline={<Subline separator="·" segments={[feedUrl ? 'Copy this link into Apple Podcasts (Library → Follow a Show by URL) or Overcast. It is shown once; keep it to yourself.' : rhythm.listen.feed ? `On since ${new Date(rhythm.listen.feed.createdAt).toLocaleDateString()}` : 'Your briefs in your podcast app, for the car']} />}
                actionsAlways
                actions={(
                  <span className="flex items-center gap-2">
                    {feedUrl && <Input readOnly aria-label="Podcast link" className="h-8 w-56" value={feedUrl} onFocus={e => e.currentTarget.select()} />}
                    <button type="button" className="text-xs font-medium underline-offset-2 hover:underline" onClick={() => void makeFeed()}>{rhythm.listen.feed ? 'New link' : 'Make a link'}</button>
                    {rhythm.listen.feed && <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => void stopFeed()}>Stop</button>}
                  </span>
                )}
              />
            </>
          )}
        </ListRows>
      </div>

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

      {org?.canChange && rhythm.listen.voice && (
        <div className="mt-4 flex items-start justify-between gap-4 border-t border-border/60 pt-4" data-testid="org-brief-audio">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Workspace briefs read aloud</p>
            <p className="text-xs text-muted-foreground">
              Team briefs get a player too, in the Org's voice
              {' '}
              <select
                aria-label="The Org's voice"
                className="ml-1 h-7 rounded-md border border-input bg-background px-1 text-xs"
                value={org.briefVoiceId ?? ''}
                onChange={e => void saveOrg({ briefVoiceId: e.target.value || null })}
              >
                <option value="">{`${rhythm.listen.voice.defaultVoice.name} (default)`}</option>
                {(voices?.voices ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              . The daily brief budget above covers the audio.
            </p>
          </div>
          <Switch on={org.briefAudio} label="Workspace briefs read aloud" onChange={on => void saveOrg({ briefAudio: on })} />
        </div>
      )}
      {error && <p role="status" className="mt-3 text-sm text-brand-fail">{error}</p>}
    </DashboardSection>
  );
}

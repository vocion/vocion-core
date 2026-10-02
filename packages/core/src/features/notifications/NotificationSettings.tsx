'use client';

import type { DevicePushState } from './webPushClient';
import { Monitor, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListSkeleton } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ageLabel } from '@/libs/timeAgo';
import { cn } from '@/utils/Helpers';
import { devicePushState, turnOffDevicePush, turnOnDevicePush } from './webPushClient';

type Channel = { id: string; label: string; default: boolean; configured: boolean };
type Kind = { kind: string; label: string; description: string | null; source: string; status: string; lastFiredAt: string | null; lastNote: string | null };
type Prefs = { channels: Record<string, Record<string, boolean>>; quietHours: { start: string; end: string; timeZone: string } | null; slackTarget: 'dm' | 'channel' };
type View = { preferences: Prefs; kinds: Kind[]; channels: Channel[] };
type Device = { id: number; platform: 'web' | 'ios'; label: string | null; environment: string | null; createdAt: string; lastSeenAt: string; lastError: string | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Notification settings (backlog 048): each declared kind × each channel,
 * quiet hours, where Slack goes, and this person's devices. Every change is
 * saved as it is made — one toggle, one PUT — and said in one toast.
 */
export function NotificationSettings() {
  const [view, setView] = useState<View | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thisDevice, setThisDevice] = useState<DevicePushState | null>(null);

  const reload = useCallback(async () => {
    try {
      const [v, d] = await Promise.all([api<View>('/api/v1/notifications/preferences'), api<{ devices: Device[] }>('/api/v1/push/devices')]);
      setView(v);
      setDevices(d.devices);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
    devicePushState().then(setThisDevice).catch(() => setThisDevice('unsupported'));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async (change: Partial<Prefs>) => {
    try {
      setView(await api<View>('/api/v1/notifications/preferences', { method: 'PUT', body: JSON.stringify(change) }));
    } catch (err) {
      toast.error('Could not save', { description: (err as Error).message });
    }
  };

  const removeDevice = async (id: number) => {
    try {
      await api(`/api/v1/push/devices/${id}`, { method: 'DELETE' });
      setDevices(list => list?.filter(d => d.id !== id) ?? list);
      toast.success('Device removed');
      devicePushState().then(setThisDevice).catch(() => {});
    } catch (err) {
      toast.error('Could not remove the device', { description: (err as Error).message });
    }
  };

  const toggleThisDevice = async () => {
    if (thisDevice === 'on') {
      setThisDevice(await turnOffDevicePush());
      void reload();
      return;
    }
    const out = await turnOnDevicePush().catch((err: Error) => ({ state: 'off' as const, reason: err.message }));
    setThisDevice(out.state);
    if (out.state === 'on') {
      toast.success('This device will be notified');
      void reload();
    } else if (out.reason) {
      toast.error('Notifications are not on for this device', { description: out.reason });
    }
  };

  if (error) {
    return <ListEmpty variant="inline" title="Could not load your notification settings" description={error} />;
  }
  if (!view || !devices) {
    return <ListSkeleton />;
  }
  const prefs = view.preferences;
  const isOn = (kind: string, channel: Channel) => channel.id === 'in_app' || (prefs.channels[kind]?.[channel.id] ?? channel.default);
  const active = view.kinds.filter(k => k.status === 'active');
  const zone = prefs.quietHours?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = Date.now();

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="kinds-heading">
        <h2 id="kinds-heading" className="text-sm font-semibold">What notifies you, and where</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Only these moments notify. iPhone and Chrome reach the devices you turned on below.</p>
        {active.length === 0
          ? <ListEmpty variant="inline" title="This workspace declares no notifications yet." description="A plugin or workspace.yaml names them under notifications:." />
          : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-[13px]">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-normal">Kind</th>
                      {view.channels.map(c => (
                        <th key={c.id} className="px-2 py-2 text-center font-normal">
                          {c.configured
                            ? c.label
                            : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help underline decoration-dotted underline-offset-4">{c.label}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>Not set up on this server yet — your choice is kept for when it is.</TooltipContent>
                                </Tooltip>
                              )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {active.map(k => (
                      <tr key={k.kind} data-testid={`kind-${k.kind}`}>
                        <td className="py-3 pr-4 align-top">
                          <span className="block font-medium">{k.label}</span>
                          {k.description && <span className="block text-muted-foreground">{k.description}</span>}
                          <span className="block text-[12px] text-muted-foreground/80">
                            {[k.source.startsWith('plugin:') ? `From the ${k.source.slice('plugin:'.length)} plugin` : 'From this workspace', k.lastFiredAt ? `fired ${ageLabel(new Date(k.lastFiredAt), now)}${k.lastNote ? `: ${k.lastNote}` : ''}` : 'has not fired yet'].join(' · ')}
                          </span>
                        </td>
                        {view.channels.map(c => (
                          <td key={c.id} className="px-2 py-3 text-center align-top">
                            {c.id === 'in_app'
                              ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex"><Switch on disabled label={`${k.label}: ${c.label}`} onChange={() => {}} /></span>
                                    </TooltipTrigger>
                                    <TooltipContent>Always on — the bell keeps every notification.</TooltipContent>
                                  </Tooltip>
                                )
                              : <Switch on={isOn(k.kind, c)} label={`${k.label}: ${c.label}`} onChange={on => void save({ channels: { [k.kind]: { [c.id]: on } } })} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </section>

      <section aria-labelledby="quiet-heading">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="quiet-heading" className="text-sm font-semibold">Quiet hours</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Push, email and Slack wait until they end. The bell never waits.</p>
          </div>
          <Switch on={prefs.quietHours !== null} label="Quiet hours" onChange={on => void save({ quietHours: on ? { start: '22:00', end: '07:00', timeZone: zone } : null })} />
        </div>
        {prefs.quietHours && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span>From</span>
            <Input type="time" aria-label="Quiet hours start" className="h-8 w-28" value={prefs.quietHours.start} onChange={e => e.target.value && void save({ quietHours: { ...prefs.quietHours!, start: e.target.value } })} />
            <span>to</span>
            <Input type="time" aria-label="Quiet hours end" className="h-8 w-28" value={prefs.quietHours.end} onChange={e => e.target.value && void save({ quietHours: { ...prefs.quietHours!, end: e.target.value } })} />
            <span className="text-muted-foreground">{prefs.quietHours.timeZone}</span>
          </div>
        )}
      </section>

      <section aria-labelledby="slack-heading">
        <h2 id="slack-heading" className="text-sm font-semibold">Slack</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Where a Slack notification goes when Slack is on for a kind.</p>
        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Slack target">
          {(['dm', 'channel'] as const).map(t => (
            <button key={t} type="button" role="radio" aria-checked={prefs.slackTarget === t} onClick={() => void save({ slackTarget: t })} className={cn('rounded-lg border px-3 py-1.5 text-[13px]', prefs.slackTarget === t ? 'border-foreground bg-surface-soft font-medium' : 'border-border/70 text-muted-foreground hover:text-foreground')}>
              {t === 'dm' ? 'A direct message to me' : 'The workspace\'s Slack channel'}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="devices-heading">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="devices-heading" className="text-sm font-semibold">Your devices</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">An iPhone joins when the Vocion app asks after you sign in; a browser joins from here or the bell.</p>
          </div>
          {thisDevice && thisDevice !== 'unsupported' && thisDevice !== 'not-configured' && (
            <Button variant="outline" size="sm" onClick={() => void toggleThisDevice()} disabled={thisDevice === 'denied'} data-testid="this-device-toggle">
              {thisDevice === 'on' ? 'Stop notifying this browser' : thisDevice === 'denied' ? 'Blocked in this browser' : 'Get notified on this device'}
            </Button>
          )}
        </div>
        {devices.length === 0
          ? <ListEmpty variant="inline" title="No devices yet." />
          : (
              <ListRows className="mt-3">
                {devices.map(d => (
                  <ListRow
                    key={d.id}
                    icon={d.platform === 'ios' ? Smartphone : Monitor}
                    title={d.label ?? (d.platform === 'ios' ? 'iPhone' : 'Browser')}
                    subline={<span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{[d.platform === 'ios' ? `iPhone${d.environment === 'sandbox' ? ' (development build)' : ''}` : 'Chrome notifications', d.lastError ? `last error: ${d.lastError}` : null].filter(Boolean).join(' · ')}</span>}
                    columns={<Column kind="date">{ageLabel(new Date(d.lastSeenAt), now)}</Column>}
                    actions={<Button variant="ghost" size="sm" onClick={() => void removeDevice(d.id)}>Remove</Button>}
                    actionsAlways
                  />
                ))}
              </ListRows>
            )}
      </section>
    </div>
  );
}

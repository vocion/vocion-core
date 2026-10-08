'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';

/**
 * An app feature's On/Off switch — the one switch for turning a feature (a
 * plugin) on or off. One flip writes the project's plugin list and applies it
 * (`plugins.set`), then the page reloads its data so the switch, the rail and
 * the rest of the shell agree. A failure stays beside the switch, in words.
 *
 * Admin-only server-side: a member, or an admin on a host whose workspace is
 * read-only, sees the state in words and, on hover, why it cannot change here.
 * @param props
 * @param props.slug - The feature's plugin slug.
 * @param props.name - The feature's name, for the switch's label.
 * @param props.on - Whether it is on.
 * @param props.canToggle - Whether this viewer may switch it.
 * @param props.dependents - Names of the features that need it (switching it off switches them off).
 * @param props.blocker - Why it cannot be switched on this host, when it cannot.
 * @param props.note - What switching it changes on this host, when it is more than this workspace (a repo file to update).
 */
export function FeatureSwitch(props: { slug: string; name: string; on: boolean; canToggle: boolean; dependents?: string[]; blocker?: string | null; note?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.canToggle || props.blocker) {
    const state = <span className="text-[13px] text-muted-foreground" data-testid={`feature-switch-${props.slug}`}>{props.on ? 'On' : 'Off'}</span>;
    return props.blocker
      ? (
          <Tooltip>
            <TooltipTrigger asChild>{state}</TooltipTrigger>
            <TooltipContent>{props.blocker}</TooltipContent>
          </Tooltip>
        )
      : state;
  }

  const flip = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await client.plugins.set({ slug: props.slug, enabled: next });
      if (res.applied && res.applied.errors > 0) {
        setError(`Switched ${next ? 'on' : 'off'}, with ${res.applied.errors} problem${res.applied.errors === 1 ? '' : 's'} to fix in Context.`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not switch ${props.name} ${next ? 'on' : 'off'}.`);
    } finally {
      setBusy(false);
    }
  };

  const hint = props.on && (props.dependents?.length ?? 0) > 0
    ? `Switching it off also switches off ${props.dependents!.join(', ')}, which needs it.`
    : props.note ?? (props.on ? 'Switching it off keeps everything it made.' : 'Switching it on starts its agents, pages and automations.');

  return (
    <span className="flex items-center gap-2">
      {error && <span role="alert" className="max-w-64 text-xs text-destructive">{error}</span>}
      {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
      <span className="w-6 text-right text-[13px] text-muted-foreground" aria-hidden>{props.on ? 'On' : 'Off'}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span data-testid={`feature-switch-${props.slug}`}>
            <Switch on={props.on} label={`${props.name}: ${props.on ? 'on' : 'off'}`} disabled={busy} onChange={next => void flip(next)} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </span>
  );
}

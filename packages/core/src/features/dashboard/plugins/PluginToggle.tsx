'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';

/**
 * The switch on a plugin row: Turn on / Turn off. One click edits the
 * project's workspace.yaml and applies it (`plugins.set`), then the page
 * reloads its data so the row, the nav and the rest of the shell agree. The
 * receipt is the sha the apply produced; an error stays on the row in words.
 * Admin-only server-side — a member sees the state, not the switch.
 * @param props
 * @param props.slug
 * @param props.enabled
 * @param props.canToggle
 * @param props.dependents - Plugins that depend on this one (turning it off turns them off too).
 * @param props.blocker
 */
export function PluginToggle(props: { slug: string; enabled: boolean; canToggle: boolean; dependents?: string[]; blocker?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.canToggle || props.blocker) {
    // A member sees the state; an admin on a read-only (deploy-managed) host
    // sees the state and, on hover, the door that does work.
    const state = (
      <span className="text-xs text-muted-foreground">
        {props.enabled ? 'On' : 'Off'}
        {props.blocker ? ' · edit in the repo' : ''}
      </span>
    );
    return props.blocker
      ? (
          <Tooltip>
            <TooltipTrigger asChild><span data-testid={`plugin-toggle-${props.slug}`}>{state}</span></TooltipTrigger>
            <TooltipContent>{props.blocker}</TooltipContent>
          </Tooltip>
        )
      : state;
  }

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await client.plugins.set({ slug: props.slug, enabled: !props.enabled });
      if (res.applied.errors > 0) {
        setError(`applied with ${res.applied.errors} error${res.applied.errors === 1 ? '' : 's'} — see Context`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not change the plugin');
    } finally {
      setBusy(false);
    }
  };

  const offWarning = props.enabled && (props.dependents?.length ?? 0) > 0
    ? `Also turns off ${props.dependents!.join(', ')}, which depends on it.`
    : null;

  return (
    <span className="flex items-center gap-2">
      {error && <span className="max-w-64 truncate text-xs text-destructive">{error}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant={props.enabled ? 'outline' : 'default'} onClick={toggle} disabled={busy} data-testid={`plugin-toggle-${props.slug}`}>
            {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
            {busy ? 'Applying…' : props.enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {offWarning ?? (props.enabled ? 'Removes it from workspace.yaml and applies. Nothing it wrote is deleted.' : 'Adds it to workspace.yaml and applies. Its pages, agents and automations start working.')}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

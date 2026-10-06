'use client';

import { ArrowUpRight, Check, Globe, Link2, UserRound } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useCallback, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';

type State = { shared: boolean; path: string | null; hideAsker: boolean; showOpenLink: boolean };

/**
 * SHARE A FEATURE (Chris, 2026-10-03): a public, read-only page — the ask and
 * who asked, what it built, how long and what it cost, the mockups, the
 * walkthrough and the timeline — for anyone holding the link.
 *
 * The same control as an artifact's Share (`artifacts/SharePicker.tsx`): a
 * link icon on the title row, a popover under it. Nothing is public until
 * the switch is turned on; turning it off revokes every copy of the link.
 * "Show who asked" and "Show the Open button" (the page's one link back to
 * the feature in the workspace) are on by default and change every copy at once.
 * @param props
 * @param props.requestId - The feature.
 * @param props.title - For the accessible name.
 */
export function FeatureShare({ requestId, title }: { requestId: number; title: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await client.artifacts.featureShare({ requestId }));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [requestId]);

  const save = useCallback(async (next: { shared: boolean; hideAsker?: boolean; showOpenLink?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      setState(await client.artifacts.setFeatureShare({ requestId, ...next }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [requestId]);

  const link = state?.path ? `${typeof window === 'undefined' ? '' : window.location.origin}${state.path}` : null;
  const copy = () => {
    if (!link) {
      return;
    }
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && state === null) {
          void load();
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverPrimitive.Trigger
            aria-label={`Share “${title}”`}
            data-testid="feature-share"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
          >
            <Link2 className="size-4" aria-hidden />
          </PopoverPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" collisionPadding={8}>Share</TooltipContent>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="end" side="bottom" sideOffset={6} collisionPadding={8} className="z-50 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-border bg-background p-1 shadow-(--shadow-pop) outline-none" data-testid="feature-share-panel">
          <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm">
            <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">Anyone with the link</span>
              <span className="block text-[12px] text-muted-foreground">A read-only page: the ask, what it built, time and cost, mockups, walkthrough and timeline. Turn off to revoke.</span>
            </span>
            <Switch on={state?.shared ?? false} label="Share a public page" disabled={busy || state === null} onChange={on => void save({ shared: on })} />
          </div>
          <div className={cn('flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm', !state?.shared && 'opacity-60')}>
            <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">Show who asked</span>
              <span className="block text-[12px] text-muted-foreground">Their name only, never their email.</span>
            </span>
            <Switch on={!(state?.hideAsker ?? false)} label="Show who asked" disabled={busy || !state?.shared} onChange={show => void save({ shared: true, hideAsker: !show })} />
          </div>
          <div className={cn('flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm', !state?.shared && 'opacity-60')}>
            <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">Show the Open button</span>
              <span className="block text-[12px] text-muted-foreground">Opens this feature in the workspace; only members get in.</span>
            </span>
            <Switch on={state?.showOpenLink ?? true} label="Show the Open button" disabled={busy || !state?.shared} onChange={show => void save({ shared: true, showOpenLink: show })} />
          </div>
          {link && (
            <div className="mt-1 flex items-center gap-2 border-t border-border/60 px-2.5 pt-2 pb-1">
              <a href={link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground hover:text-foreground" data-testid="feature-share-link">{link.replace(/^https?:\/\//, '')}</a>
              <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted" data-testid="feature-share-copy">
                {copied ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          )}
          {error && <p className="px-2.5 pt-1 pb-1.5 text-[12px] text-brand-fail" role="alert">{`Could not change sharing: ${error}`}</p>}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

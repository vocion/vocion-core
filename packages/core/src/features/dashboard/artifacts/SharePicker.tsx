'use client';

import type { ShareAudience } from '@/libs/share/audience';
import { Check, Globe, Link2, Lock, Users } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useCallback, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/libs/Orpc';
import { SHARE_AUDIENCE_COPY, SHARE_AUDIENCES } from '@/libs/share/audience';
import { cn } from '@/utils/Helpers';

const ICON: Record<ShareAudience, typeof Lock> = { me: Lock, workspace: Users, anyone: Globe };

/**
 * Share — the one picker for who an artifact opens for, on the artifact page
 * and in the preview pane alike (Chris, 2026-09-18: "choose whether I need
 * to be me, in the Revenue Team workspace, or anyone that can see it").
 *
 * Three audiences (`libs/share/audience.ts`), one link: the dashboard URL
 * for `me` and `workspace`, the signed public path for `anyone`. Choosing
 * an audience saves it; Copy link copies whichever link that audience needs.
 * Narrowing the audience revokes every public copy — the route re-checks.
 * @param props
 * @param props.artifactId
 * @param props.title - For the accessible name.
 * @param props.dashboardHref - The signed-in link (`/dashboard/artifacts/<id>`, workspace-prefixed when known).
 * @param props.workspaceName - Named in the workspace row's hint.
 * @param props.className
 */
export function SharePicker({ artifactId, title, dashboardHref, workspaceName, className }: { artifactId: number; title: string; dashboardHref: string; workspaceName?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<ShareAudience | null>(null);
  const [publicPath, setPublicPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await client.artifacts.share({ id: artifactId });
      setAudience(s.audience);
      setPublicPath(s.publicPath);
    } catch {
      setAudience('workspace');
    }
  }, [artifactId]);

  const choose = useCallback(async (next: ShareAudience) => {
    setBusy(true);
    try {
      const s = await client.artifacts.setShare({ id: artifactId, audience: next });
      setAudience(s.audience);
      setPublicPath(s.publicPath);
    } catch {
      /* the picker keeps showing what the server last said */
    } finally {
      setBusy(false);
    }
  }, [artifactId]);

  const link = (() => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return audience === 'anyone' && publicPath ? `${origin}${publicPath}` : `${origin}${dashboardHref}`;
  })();

  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const Current = ICON[audience ?? 'workspace'];

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && audience === null) {
          void load();
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverPrimitive.Trigger
            aria-label={`Share “${title}”`}
            data-testid="share-picker"
            className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground', className)}
          >
            <Link2 className="size-4" aria-hidden />
          </PopoverPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" collisionPadding={8}>Share</TooltipContent>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="end" side="bottom" sideOffset={6} collisionPadding={8} className="z-50 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-border bg-background p-1 shadow-(--shadow-pop) outline-none">
          <div role="radiogroup" aria-label="Who can open this">
            {SHARE_AUDIENCES.map((a) => {
              const Icon = ICON[a];
              const selected = a === audience;
              return (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy || audience === null}
                  onClick={() => void choose(a)}
                  className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-60', selected && 'bg-muted')}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{SHARE_AUDIENCE_COPY[a].label}</span>
                    <span className="block text-[12px] text-muted-foreground">{SHARE_AUDIENCE_COPY[a].hint(workspaceName ?? 'this workspace')}</span>
                  </span>
                  {selected && <Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex items-center gap-2 border-t border-border/60 px-2.5 pt-2 pb-1">
            <Current className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={link}>{link.replace(/^https?:\/\//, '')}</span>
            <button type="button" onClick={copy} disabled={audience === null} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-60" data-testid="share-copy">
              {copied ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

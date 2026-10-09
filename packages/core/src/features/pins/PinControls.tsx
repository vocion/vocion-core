'use client';

import type { LucideIcon } from 'lucide-react';
import type { PinKind, PinTarget } from '@/libs/pins/pinTarget';
import { BookOpen, Eye, FileText, FolderLock, IdCard, MessageSquare, PanelsTopLeft, Pin, PinOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { pinTarget, unpinKey, usePin } from '@/features/dashboard/nav/useNavPrefs';
import { usePathname } from '@/libs/I18nNavigation';
import { pinTargetFromPath } from '@/libs/pins/pinTarget';
import { cn } from '@/utils/Helpers';

/**
 * "Pin to sidebar" / "Unpin", the same two words everywhere a thing can be
 * opened: a header's quiet icon (`PinButton`), an item in any ⋯ menu
 * (`PinMenuItem`), ⌘K's "Pin this" and ⌘⇧P (`useCurrentPinTarget`). They all
 * write the one store the sidebar reads (`useNavPrefs`), so a pin shows in
 * the sidebar the moment it is made.
 */

/** The icon a pinned row leads with, by what it is. */
export const PIN_KIND_ICON: Record<PinKind, LucideIcon> = {
  conversation: MessageSquare,
  artifact: FileText,
  wiki: BookOpen,
  room: FolderLock,
  view: Eye,
  record: IdCard,
  page: PanelsTopLeft,
};

/** What a caller already knows about the thing, so the sidebar can show it before the server answers. */
export type PinKnown = { title: string; href: string };

/**
 * Pinned or not, and the one verb that flips it.
 * @param target - The thing, or null for nothing pinnable.
 * @param known - Its title and link, when known.
 */
export function usePinToggle(target: PinTarget | null, known?: PinKnown) {
  const { pinned, key } = usePin(target);
  const toggle = async () => {
    if (!target || !key) {
      return;
    }
    if (pinned) {
      await unpinKey(key);
    } else {
      await pinTarget(target, known);
    }
  };
  return { pinned, toggle };
}

/**
 * The header's control: one quiet icon, its words in the tooltip and the
 * accessible name. Never a filled button — a page has one primary action and
 * this is not it.
 * @param props - The thing.
 * @param props.target - What it pins.
 * @param props.title - Its name, for the sidebar row.
 * @param props.href - Where the row opens.
 * @param props.className - Size to the strip it sits in.
 */
export function PinButton(props: { target: PinTarget; title: string; href: string; className?: string }) {
  const t = useTranslations('DashboardLayout');
  const { pinned, toggle } = usePinToggle(props.target, { title: props.title, href: props.href });
  const label = pinned ? t('unpin') : t('pin_to_sidebar');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={label}
          aria-pressed={pinned}
          data-testid="pin-toggle"
          className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none [&>svg]:size-4', props.className)}
        >
          {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" collisionPadding={8}>{`${label} · ⌘⇧P`}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The same verb as an item in a ⋯ menu.
 * @param props - The thing.
 * @param props.target - What it pins.
 * @param props.title - Its name.
 * @param props.href - Where it opens.
 */
export function PinMenuItem(props: { target: PinTarget; title: string; href: string }) {
  const t = useTranslations('DashboardLayout');
  const { pinned, toggle } = usePinToggle(props.target, { title: props.title, href: props.href });
  return (
    <DropdownMenuItem onSelect={() => void toggle()} data-testid="pin-menu-item">
      {pinned ? <PinOff className="mr-2 size-4 text-muted-foreground" aria-hidden /> : <Pin className="mr-2 size-4 text-muted-foreground" aria-hidden />}
      {pinned ? t('unpin') : t('pin_to_sidebar')}
    </DropdownMenuItem>
  );
}

/* ------------------------------------------------------------------ */
/* What "this" is, for ⌘⇧P and the palette's "Pin this"                */
/* ------------------------------------------------------------------ */

type Declared = { target: PinTarget; known?: PinKnown } | null;
let declared: Declared = null;
const declaredListeners = new Set<() => void>();
const setDeclared = (next: Declared) => {
  declared = next;
  declaredListeners.forEach(l => l());
};

/**
 * A surface whose address does not say what it shows — the chat page, where
 * a thread opens in place — declares it while mounted, so ⌘⇧P pins the
 * thread on screen. Every other page is read from its path.
 * @param target - The thing on screen, or null.
 * @param known - Its title and link.
 */
export function useDeclarePinTarget(target: PinTarget | null, known?: PinKnown): void {
  const id = target ? `${target.kind}:${target.id}|${known?.title ?? ''}|${known?.href ?? ''}` : '';
  useEffect(() => {
    if (!target) {
      return;
    }
    setDeclared({ target, known });
    return () => setDeclared(null);
    // `id` holds every field that matters; the objects' identity does not.
  }, [id]);
}

/** The thing this page is about, when it is one a person can pin: declared, else read from the path. */
export function useCurrentPinTarget(): { target: PinTarget; known?: PinKnown } | null {
  const pathname = usePathname();
  const current = useSyncExternalStore(
    (l) => {
      declaredListeners.add(l);
      return () => declaredListeners.delete(l);
    },
    () => declared,
    () => null,
  );
  const fromPath = useMemo(() => {
    const target = pinTargetFromPath(pathname);
    return target ? { target } : null;
  }, [pathname]);
  return current ?? fromPath;
}

'use client';

import { Check, ChevronRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { SETUP_CHANGED_EVENT } from '@/features/dashboard/chat/cards/SetupCard';
import { connectSystemsHref } from '@/libs/connect/systemsLink';
import { Link, usePathname } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * GETTING STARTED · N OF 5 — the sidebar's small checklist for a new shared
 * workspace, in the place the "Invite team members" box sat.
 *
 * Every tick is read from the workspace (`services/workspace/gettingStarted.ts`
 * via `nav.gettingStarted`): a system connected, an app or template added, an
 * agent hired, someone invited, and the Org wearing its own logo and colours
 * ("Make it yours", which opens the chat for the lead's brand preview). Nothing here is ticked by hand, so it never
 * says a step is done that is not. It re-reads when a setup card in chat runs
 * or is undone (`SETUP_CHANGED_EVENT`), when the page changes and when the
 * window comes back into focus.
 *
 * A step not done yet opens the chat with the ask for the workspace lead
 * already written (`?prompt=`) — except connecting, which opens "Connect your
 * systems" docked above the composer (`connectSystemsHref`) — because setting up happens in the
 * conversation; a step done opens the place it lives. Dismissible, remembered
 * per person per workspace (nav prefs), and gone by itself once every step is
 * done.
 *
 * Only on a NEW workspace (`fresh`: created in the last two weeks, or no
 * conversation yet), and as one slim row, "Getting started · 2 of 5 ›", whose
 * steps open beneath it on request — never a card on an established
 * workspace's drawer (founder, 2026-10-08).
 */

export type GettingStartedState = {
  steps: Array<{ id: 'connect' | 'app' | 'hire' | 'invite' | 'brand'; done: boolean }>;
  done: number;
  total: number;
  /** A new workspace; false hides the row. Absent reads as new (older servers). */
  fresh?: boolean;
};

/** Where a done step lives. */
const DONE_HREF: Record<GettingStartedState['steps'][number]['id'], string> = {
  connect: '/dashboard/connectors',
  app: '/dashboard/apps',
  hire: '/dashboard/agents',
  invite: '/dashboard/members',
  brand: '/dashboard/brand',
};

/**
 * Whether the checklist has anything to show: a shared workspace with a step
 * left to take.
 * @param state - The workspace's state, or null for a personal one.
 */
export function checklistApplies(state: GettingStartedState | null | undefined): state is GettingStartedState {
  return Boolean(state && state.done < state.total && state.fresh !== false);
}

export type GettingStartedChecklistProps = {
  /** The state the server rendered with; re-read on the client after. */
  initial: GettingStartedState;
  onDismiss: () => void;
  /** Off in Storybook and tests: the state is the props, no reads. */
  live?: boolean;
};

/**
 * The checklist.
 * @param props - See {@link GettingStartedChecklistProps}.
 * @param props.initial
 * @param props.onDismiss
 * @param props.live
 */
export function GettingStartedChecklist({ initial, onDismiss, live = true }: GettingStartedChecklistProps) {
  const t = useTranslations('Onboarding');
  const [state, setState] = useState<GettingStartedState | null>(initial);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const refresh = useCallback(() => {
    void client.nav.gettingStarted()
      .then(next => setState(next as GettingStartedState | null))
      .catch(() => { /* keep what is shown; the next change reads again */ });
  }, []);

  useEffect(() => {
    if (!live) {
      return;
    }
    window.addEventListener(SETUP_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(SETUP_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [live, refresh]);

  // A step is usually finished on another page (a login, the catalog).
  useEffect(() => {
    if (live) {
      refresh();
    }
  }, [live, pathname, refresh]);

  if (!checklistApplies(state)) {
    return null;
  }
  const pct = Math.round((state.done / state.total) * 100);

  return (
    <div data-testid="getting-started" className="mx-2 mb-1 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls="getting-started-steps"
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
        >
          <span className="relative h-1 w-4 shrink-0 overflow-hidden rounded-full bg-surface-soft" aria-hidden>
            <span className="absolute inset-y-0 left-0 rounded-full bg-action" style={{ width: `${pct}%` }} />
          </span>
          <span className="truncate" data-testid="getting-started-count">{t('checklist_title', { done: state.done, total: state.total })}</span>
          <ChevronRight className={`ml-auto size-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('checklist_dismiss')}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          data-testid="getting-started-dismiss"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {open && (
        <ul id="getting-started-steps" className="mt-0.5 mb-1 space-y-0.5 pl-2">
          {state.steps.map(step => (
            <li key={step.id}>
              <Link
                href={step.done ? DONE_HREF[step.id] : step.id === 'connect' ? connectSystemsHref() : `/dashboard/chat?prompt=${encodeURIComponent(t(`step_${step.id}_prompt`))}`}
                className="-mx-1 flex h-7 items-center gap-2 rounded-md px-1 text-[12px] transition-colors hover:bg-surface-hover"
                data-testid={`getting-started-${step.id}`}
                data-done={step.done ? 'true' : 'false'}
              >
                {step.done
                  ? (
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        <Check className="size-3" aria-hidden />
                      </span>
                    )
                  : <span className="size-4 shrink-0 rounded-full border border-border" aria-hidden />}
                <span className={step.done ? 'text-muted-foreground' : 'text-foreground'}>{t(`step_${step.id}`)}</span>
                <span className="sr-only">{step.done ? t('step_state_done') : t('step_state_todo')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

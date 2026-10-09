'use client';

import type { AgentOption } from './types';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NO_AGENTS_HREF } from '@/libs/chat/redact';
import { Link } from '@/libs/I18nNavigation';
import { onlyTheSeededLead } from '@/libs/workspace/workspaceLead';
import { EmptyState } from './EmptyState';
import { SEARCH_ONLY_SLUG } from './routing';

/**
 * A NEW WORKSPACE OPENS ON ITS LEAD, AS LIGHTLY AS ANY EMPTY CHAT.
 *
 * Every shared workspace starts with a workspace lead
 * (`services/workspace/workspaceLead.ts`), and while it is the only agent
 * there the chat opens on it. The same light layout as every empty
 * conversation (`EmptyState`): the mark, and the lead's one-line hello ("Hi
 * Sam, I'm the workspace lead. Whenever you're ready, I can help set this
 * up."), with ONE soft chip by the composer, "Set up this workspace →",
 * which sends the lead the ask and starts the setup interview. The three
 * starters it had went (founder, 2026-10-08: "a soft nudge or chip. If
 * that."); connecting a system and templates are steps of that setup.
 */

/**
 * Whether this chat should open on the lead's hello: the workspace's only
 * agent is the lead core seeded into it.
 * @param agents - The surface's agents, virtual entries included.
 */
export function wantsLeadIntro(agents: readonly AgentOption[]): boolean {
  return onlyTheSeededLead(agents.filter(a => a.slug !== SEARCH_ONLY_SLUG).map(a => a.slug));
}

export type LeadIntroProps = {
  /** The person's first name, for the hello. */
  firstName?: string | null;
  /** Sends the setup ask to the lead — the same path a suggestion chip takes. */
  onPick: (prompt: string) => void;
  /** Holds the chip while the session is still hydrating. */
  disabled?: boolean;
};

/**
 * The lead's hello and the one setup chip.
 * @param props - See {@link LeadIntroProps}.
 * @param props.firstName - The person's first name.
 * @param props.onPick - Sends the setup ask.
 * @param props.disabled - Holds the chip while hydrating.
 */
export function LeadIntro({ firstName, onPick, disabled = false }: LeadIntroProps) {
  const t = useTranslations('Onboarding');
  const line = firstName ? t('lead_hello_named', { name: firstName }) : t('lead_hello');
  return (
    <div data-testid="lead-intro" className="flex min-h-0 flex-1 flex-col">
      <EmptyState
        line={line}
        nudge={(
          <button
            type="button"
            onClick={() => onPick(t('starter_setup_prompt'))}
            disabled={disabled}
            data-testid="lead-intro-setup"
            className="inline-flex animate-in items-center gap-1.5 rounded-full border border-border/70 bg-background py-1.5 pr-2.5 pl-3 text-[12.5px] text-muted-foreground transition-colors fade-in hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-brand-amber" aria-hidden />
            {t('setup_chip')}
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
          </button>
        )}
      />
    </div>
  );
}

/**
 * What the chat says in a workspace with no agent at all — a workspace whose
 * lead could not be seeded, or whose every agent was retired. Said before a
 * turn runs, with the one next step, in words for the person rather than for
 * whoever deploys the product.
 */
export function NoAgentsYet() {
  const t = useTranslations('Onboarding');
  return (
    <div data-testid="no-agents-state" className="flex min-h-0 flex-1 flex-col justify-end px-4 pb-7 sm:px-6">
      <p className="mx-auto w-full max-w-md text-[15px] leading-relaxed text-foreground/80">
        {t('no_agents')}
        {' '}
        <Link href={NO_AGENTS_HREF} className="font-medium text-brand-amber-deep underline underline-offset-2">
          {t('no_agents_cta')}
        </Link>
      </p>
    </div>
  );
}

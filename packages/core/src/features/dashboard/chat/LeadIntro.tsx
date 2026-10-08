'use client';

import type { AgentOption } from './types';
import { useTranslations } from 'next-intl';
import { NO_AGENTS_HREF } from '@/libs/chat/redact';
import { Link } from '@/libs/I18nNavigation';
import { onlyTheSeededLead } from '@/libs/workspace/workspaceLead';
import { AgentMark } from './AgentMark';
import { SEARCH_ONLY_SLUG } from './routing';

/**
 * A NEW WORKSPACE OPENS ON ITS LEAD, NOT ON A BLANK PAGE.
 *
 * The founder's screenshot of a fresh workspace (2026-10-08): a white page,
 * then "This workspace has no agents yet. Apply a workspace or add one under
 * Manage → Teams & agents." above the composer — developer copy, and a door
 * out of the conversation. Every shared workspace now starts with a workspace
 * lead (`services/workspace/workspaceLead.ts`), and while it is the only agent
 * there the chat opens on it: who it is, one sentence on what it will do, and
 * three starters that send the lead the ask. Everything after that happens in
 * the conversation — a short interview and a plan of one-click cards.
 *
 * Its own component, beside `EmptyState` rather than inside it: the shape is
 * the same (bottom-aligned above the composer, quiet chips), the content is
 * not a workspace's suggestions but a first meeting.
 */

/** The three ways in, in the order a new workspace takes them. */
const STARTERS = ['setup', 'connect', 'template'] as const;

/**
 * Whether this chat should open on the lead's introduction: the workspace's
 * only agent is the lead core seeded into it.
 * @param agents - The surface's agents, virtual entries included.
 */
export function wantsLeadIntro(agents: readonly AgentOption[]): boolean {
  return onlyTheSeededLead(agents.filter(a => a.slug !== SEARCH_ONLY_SLUG).map(a => a.slug));
}

/**
 * One height for every starter, a hairline and a neutral hover — the empty
 * state's chip, so the two read as one family.
 */
const starterClass = 'flex h-9 max-w-full shrink-0 items-center truncate rounded-full border border-border bg-background px-3.5 text-[13px] text-muted-foreground transition-colors pointer-coarse:h-10 hover:bg-surface-hover hover:text-foreground animate-in fade-in fill-mode-both duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-muted-foreground';

export type LeadIntroProps = {
  /** The lead's name, as its row says ("Workspace lead"). */
  leadName: string;
  /** The workspace's name, for the sentence. */
  workspace: string;
  /** Sends a starter's prompt to the lead — the same path a suggestion chip takes. */
  onPick: (prompt: string) => void;
  /** Holds the starters while the session is still hydrating. */
  disabled?: boolean;
};

/**
 * The lead introduces itself in one sentence, with three starters.
 * @param props - See {@link LeadIntroProps}.
 * @param props.leadName - The lead's name.
 * @param props.workspace - The workspace's name.
 * @param props.onPick - Sends a starter's prompt.
 * @param props.disabled - Holds the starters while hydrating.
 */
export function LeadIntro({ leadName, workspace, onPick, disabled = false }: LeadIntroProps) {
  const t = useTranslations('Onboarding');
  return (
    <div data-testid="lead-intro" className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-4 pb-7 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground [@media(max-height:560px)]:hidden">
          <AgentMark name={leadName} decorative />
          <span>{leadName}</span>
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-foreground/90 [@media(max-height:560px)]:hidden" data-testid="lead-intro-sentence">
          {t('intro', { workspace })}
        </p>
        <div className="mt-4 flex w-full flex-wrap items-start gap-2">
          {STARTERS.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick(t(`starter_${id}_prompt`))}
              disabled={disabled}
              style={{ animationDelay: `${i * 40}ms` }}
              className={starterClass}
              data-testid={`lead-intro-${id}`}
            >
              {t(`starter_${id}`)}
            </button>
          ))}
        </div>
      </div>
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

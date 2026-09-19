import { Sparkles } from 'lucide-react';
import { agoLabel } from '@/features/dashboard/inbox/inboxMeta';

/**
 * Why you are seeing this — the agent's reason, in full, as the first thing
 * on the sheet. It used to sit under "Show details" while an unhelpful
 * "_Candidate 2 … is approved (route confirm, reviewStatus done)._" led the
 * page (Chris, 2026-09-18). The reason is the argument for the decision;
 * the run number and how long it has waited are the facts a reviewer needs
 * to weigh it.
 * @param props
 * @param props.reason - The proposal's rationale.
 * @param props.runId - The action run.
 * @param props.since - When it started waiting (ISO).
 * @param props.agentSlug - Who proposed it.
 */
export function ReviewReason({ reason, runId, since, agentSlug }: { reason: string; runId: number; since: string | null; agentSlug: string | null }) {
  return (
    <section data-testid="review-reason" className="py-5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-brand-amber-deep" aria-hidden />
        Why you're seeing this
      </div>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed break-words text-foreground/90">{reason}</p>
      <p className="mt-2 text-[12px] text-muted-foreground tabular-nums">
        {[
          agentSlug ? `recommended by ${agentSlug}` : null,
          since ? `waiting ${agoLabel(new Date(since)).replace(/ ago$/, '')}` : null,
          `run #${runId}`,
        ].filter(Boolean).join(' · ')}
      </p>
    </section>
  );
}

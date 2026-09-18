'use client';

import type { useGuidedReview } from './GuidedReview';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';

/**
 * What the rail says about a sequence it is NOT rendering.
 *
 * The lead page already owns the record in full — the recommendation, the
 * facts, every send expandable, and the decision in a sticky bar. The rail
 * used to render the same four sends again, in a second shape, with an orange
 * button in the middle of the transcript. Chris, on a lead page with the rail
 * open (2026-09-16): *"review cards isn't a card. I don't really understand
 * what to do with it… if anything? and it's mixed with chat. above or
 * below?"* — which is the right question to ask of an object that is neither a
 * message nor a card and has no owner.
 *
 * So the rail keeps the conversation and gives up the copy. What is left is a
 * POINTER: one line, in the transcript's own voice, naming what is under
 * discussion, with a link that scrolls the page to it. Deliberately:
 *
 * - **not a card** — no border, no ground, no eyebrow. A sentence.
 * - **no action** — the verbs on this record are Enroll / Snooze / Decline and
 *   they live on the page's sticky bar, where the record's other verbs are.
 *   A decision about the record never floats in a transcript.
 * - **at the top** — it opens the conversation, so "above or below" has an
 *   answer: above, as the first thing said, the way a person opens by saying
 *   what they are looking at.
 *
 * When a rewrite lands it says so — that IS the agent's own output, and the
 * new copy goes to the page (`draftRevision.ts`), which shows it marked
 * edited. Naming the change is the agent reporting its work; reprinting the
 * send would be the second copy again.
 */

/** The page region this points at — the record's own sends (`LeadDetail`). */
export const SENDS_REGION_SELECTOR = '[data-testid="outreach-sends"]';

/**
 * Scroll the page beside the rail to a region and leave the reader looking at
 * it. No focus stealing and no history entry: the person asked to see
 * something on the page they are already on.
 * @param selector - The region to bring into view.
 */
function scrollPageTo(selector: string): void {
  document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export type SequencePointerProps = {
  run: ReviewCardRun;
  guided: ReturnType<typeof useGuidedReview>;
};

/**
 * One line in the transcript naming the sequence the page is showing.
 * @param props - Pointer props.
 * @param props.run - The pending decision, for its headline.
 * @param props.guided - The guided flow, for the rewrites it has applied.
 */
export function SequencePointer({ run, guided }: SequencePointerProps) {
  const { sends, state, revisions } = guided;
  // Nothing to point at before the card has sends, and nothing to say once the
  // decision is taken — the page states the outcome itself.
  if (sends.length === 0 || state.decided) {
    return null;
  }

  const headline = run.card.recommendation?.headline ?? run.card.title;
  const latest = revisions.length > 0 ? revisions[revisions.length - 1]! : null;
  const revised = latest ? sends.find(s => s.id === latest.contentId) ?? null : null;

  return (
    <div className="px-4 text-[13px] leading-relaxed text-muted-foreground" data-testid="sequence-pointer">
      {revised && latest
        ? (
            <p>
              {`I rewrote ${revised.label} on “${latest.ask}”. The new copy is on the page beside this, marked edited — your decision there is what sends it.`}
            </p>
          )
        : (
            <p>
              {`We are talking about the sequence on this page — ${headline}. Tell me what to change and tag `}
              <span className="font-medium text-foreground/85">@change</span>
              ; the decision stays on the page.
            </p>
          )}
      <button
        type="button"
        onClick={() => scrollPageTo(SENDS_REGION_SELECTOR)}
        className="mt-1 rounded-sm underline underline-offset-2 transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-amber"
      >
        {revised ? `Show me ${revised.label} on the page` : 'Show me the sends on the page'}
      </button>
    </div>
  );
}

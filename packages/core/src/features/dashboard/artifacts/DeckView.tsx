/**
 * A deck, shown from its receipt — the slide screenshots the render-verify
 * loop already took (`spec.verification.slides[].image`). No second
 * renderer: the pictures are what was verified and what prints.
 *
 * `DeckSummary` is the chat surface (title, slide count, verify and buyer
 * state, the first slide); `DeckThumbnails` the artifact surface (every slide,
 * numbered, and the PDF the verify printed). Inline editing and present mode
 * belong to the deliverable pane (`docs/decks.md`, "The pane").
 */

import type { DeckVerification, DocumentRedTeam } from '@/libs/cards/specs';
import { deckVerificationChip } from '@/libs/decks/audit';
import { redTeamChip } from '@/libs/documents/audit';
import { artifactHref } from '@/libs/tools/artifacts/url';
import { cn } from '@/utils/Helpers';

type DeckViewProps = { title: string; slideCount?: number; verification?: DeckVerification; redTeam?: DocumentRedTeam; className?: string };

export function DeckSummary(props: DeckViewProps) {
  const first = props.verification?.slides.find(s => s.image);
  return (
    <div className={cn('flex min-w-0 items-start gap-3', props.className)} data-deck-summary>
      {first?.image && (
        <img src={artifactHref(first.image)} alt="" className="aspect-video h-20 w-auto shrink-0 rounded border border-border bg-white object-cover" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{props.title}</p>
        <p className={cn('text-[11px] text-muted-foreground', props.verification && !props.verification.ok && 'text-brand-amber')}>{deckVerificationChip(props.verification, props.slideCount)}</p>
        <p className={cn('text-[11px] text-muted-foreground', (props.redTeam?.blocks ?? 0) > 0 && 'text-brand-amber')}>{redTeamChip(props.redTeam)}</p>
      </div>
    </div>
  );
}

export function DeckThumbnails(props: DeckViewProps) {
  const slides = props.verification?.slides ?? [];
  const pdf = props.verification?.pdf;
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 p-3', props.className)} data-deck-thumbnails>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          {deckVerificationChip(props.verification, props.slideCount)}
          {' · '}
          {redTeamChip(props.redTeam)}
        </p>
        {pdf && (
          <a href={artifactHref(pdf)} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            PDF
          </a>
        )}
      </div>
      {slides.length === 0
        ? <p className="text-sm text-muted-foreground">No slide pictures yet — the deck has not been render-verified.</p>
        : (
            <ol className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {slides.map(s => (
                <li key={s.id} className="flex min-w-0 flex-col gap-1" data-slide-id={s.id}>
                  {s.image
                    ? <img src={artifactHref(s.image)} alt={s.label ?? `Slide ${s.n}`} className="aspect-video w-full rounded border border-border bg-white object-cover" />
                    : <div className="aspect-video w-full rounded border border-dashed border-border" />}
                  <span className="truncate text-[11px] text-muted-foreground">
                    {s.n}
                    {s.label ? ` · ${s.label}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
    </div>
  );
}

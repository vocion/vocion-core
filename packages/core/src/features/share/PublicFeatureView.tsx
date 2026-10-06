import type { ReactNode } from 'react';
import type { MediaSlide } from '@/features/dashboard/factory/MediaCarousel';
import type { PublicFeaturePage, PublicSlide } from '@/services/factory/featureShare';
import { ArrowUpRight } from 'lucide-react';
import { Section } from '@/components/patterns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LocalDate } from '@/features/dashboard/factory/LocalDate';
import { MediaCarousel } from '@/features/dashboard/factory/MediaCarousel';
import { glanceStats, headlineOf } from '@/libs/factory/featureGlance';
import { PublicTimeline } from './PublicTimeline';

/**
 * The page's carousel slides, in the page's order, for the feature page's own
 * carousel (`MediaCarousel`): one carousel, one zoom, one full-screen player
 * in the product.
 * @param media - The page's media.
 */
export function slidesOf(media: readonly PublicSlide[]): MediaSlide[] {
  return media.map((m, i) => (m.kind === 'image'
    ? { id: i + 1, src: m.src, label: m.label, title: m.alt, caption: m.caption }
    : { id: i + 1, src: m.src, label: m.label, title: m.caption, caption: m.caption, kind: m.kind, type: m.type, ...(m.posterAt !== undefined ? { posterAt: m.posterAt } : {}) }));
}

/**
 * THE HEADLINE NUMBERS, under the name (Chris, 2026-10-03: "the 'Built in 1h
 * 12m for $4.80' line as the page subhead … with the numbers emphasised").
 * The same words as the link's preview (`builtLine`), the numbers set in
 * weight; whichever number is missing is left out, and with neither there is
 * no subhead.
 * @param props
 * @param props.effort - The page's effort.
 */
function Subhead({ effort }: { effort: PublicFeaturePage['effort'] }) {
  const h = headlineOf(effort);
  if (!h) {
    return null;
  }
  const n = (v: string) => <strong className="font-semibold text-foreground tabular-nums">{v}</strong>;
  let words: ReactNode;
  if (h.soFar) {
    words = (
      <>
        Being built
        {h.took && (
          <>
            {' · '}
            {n(h.took)}
            {' so far'}
          </>
        )}
        {h.cost && (
          <>
            {' · '}
            {n(h.cost)}
          </>
        )}
      </>
    );
  } else {
    words = (
      <>
        Built
        {h.took && (
          <>
            {' in '}
            {n(h.took)}
          </>
        )}
        {h.cost && (
          <>
            {' for '}
            {n(h.cost)}
          </>
        )}
      </>
    );
  }
  return <p className="mt-2 text-[19px] leading-snug text-foreground/80 sm:text-[21px]" data-testid="public-subhead">{words}</p>;
}

/** One column per figure the page has. */
const COLUMNS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'] as const;

/**
 * A split, one tap away: its summary line, then the parts.
 * @param props
 * @param props.summary - What opening it shows ("Where the time went").
 * @param props.parts - The parts.
 * @param props.testId - Its test id.
 */
function Split({ summary, parts, testId }: { summary: string; parts: ReadonlyArray<{ label: string; amount: string }>; testId: string }) {
  return (
    <details className="group text-[13px]" data-testid={testId}>
      <summary className="w-fit cursor-pointer list-none text-muted-foreground underline-offset-2 hover:text-foreground hover:underline [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      <p className="mt-1.5 pl-3 break-words text-foreground tabular-nums">{parts.map(s => `${s.label} ${s.amount}`).join(' · ')}</p>
    </details>
  );
}

/**
 * HOW LONG, AT A GLANCE (Chris, 2026-10-03: "clean the How Long section,
 * make it easier at a glance"; "the subhead is just the callout; the glance
 * section is the detail"). Three figures in a row — how long, how many
 * attempts, what it cost — big numbers over small labels, read by the same
 * helper as the subhead and the link's preview (`glanceStats`). Where the
 * time went and where the money went are each one tap away. A figure the page
 * does not have is left out.
 * @param props
 * @param props.effort - The page's effort.
 */
function Glance({ effort }: { effort: PublicFeaturePage['effort'] }) {
  const stats = glanceStats(effort);
  const time = effort.duration && effort.timeSplit.length > 1 ? effort.timeSplit : null;
  const money = effort.total && effort.split.length > 0 ? effort.split : null;
  if (stats.length === 0) {
    return null;
  }
  return (
    <Section eyebrow="How long" data-testid="public-effort" commentField={null}>
      <dl className={`grid min-w-0 gap-3 ${COLUMNS[stats.length - 1]}`} data-testid="public-glance">
        {stats.map(s => (
          <div key={s.key} className="flex min-w-0 flex-col-reverse" data-testid={`public-stat-${s.key}`}>
            <dt className="mt-1 text-[12px] leading-tight text-muted-foreground">{s.label}</dt>
            <dd className="text-[22px] leading-none font-semibold tracking-tight break-words text-foreground tabular-nums sm:text-[26px]">{s.value}</dd>
          </div>
        ))}
      </dl>
      {(time || money) && (
        <div className="mt-3 space-y-1.5">
          {time && <Split summary="Where the time went" parts={time} testId="public-time-split" />}
          {money && <Split summary="Where the cost went" parts={money} testId="public-cost-split" />}
        </div>
      )}
    </Section>
  );
}

/**
 * A name's monogram: the first letters of its first two words ("Northwind
 * Studio" → "NS"), for a workspace with no picture of its own.
 * @param name - The name.
 */
export function monogram(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]!.toUpperCase()).join('') || '·';
}

/**
 * THE PAGE'S IDENTITY (Chris, 2026-10-03: "show both the workspace name and
 * the product name"; an "Open in <workspace>" button top right). Left, the
 * workspace's monogram and "<workspace> / <product>"; right, one compact
 * button to the feature's own page in the app — the word drops on a narrow
 * phone, the tooltip and the accessible name stay. The button is the page's
 * one link back in, and only when the sharer left it on.
 * @param props
 * @param props.page - The page.
 */
function TopBar({ page }: { page: PublicFeaturePage }) {
  const workspace = page.workspaceName ?? page.builtBy;
  const openLabel = `Open in ${workspace}`;
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="public-topbar">
      <p className="flex min-w-0 flex-1 items-center gap-2 text-[12px] font-medium text-muted-foreground" data-testid="public-identity">
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[10px] font-semibold text-background">{monogram(workspace)}</span>
        <span className="min-w-0 truncate">
          <span className="text-foreground" data-testid="public-workspace">{workspace}</span>
          {page.productName && (
            <>
              <span aria-hidden className="mx-1.5 text-muted-foreground/60">/</span>
              <span data-testid="public-product">{page.productName}</span>
            </>
          )}
        </span>
      </p>
      {page.openUrl && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={page.openUrl}
              aria-label={openLabel}
              data-testid="public-open"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover"
            >
              <ArrowUpRight className="size-4" aria-hidden />
              <span className="hidden min-[400px]:inline">Open</span>
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" collisionPadding={8}>{openLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * A FEATURE, SHOWN TO SOMEONE OUTSIDE THE WORKSPACE (Chris, 2026-10-03): its
 * name; how long it took and what it cost, as the subhead; who built it and
 * when it shipped; the walkthrough, the mockups and QA's screenshots in one
 * carousel right under it (the player plays in place and its own control
 * goes full screen; a picture opens full screen and pinches); the ask and
 * who asked; what it built in a sentence; how long, how many attempts and
 * what it cost at a glance, with where each went one tap away; and the
 * timeline. One column, read on a phone first; the product's
 * own sections, carousel and type, no shell, no links back in.
 *
 * It draws `PublicFeaturePage` and nothing else — the allow-list is built
 * server-side (`services/factory/featureShare.ts`), so this component cannot
 * show a field it was never handed. A part with nothing in it is left out
 * rather than explained.
 * @param props
 * @param props.page - The page, as the share route built it.
 */
export function PublicFeatureView({ page }: { page: PublicFeaturePage }) {
  const { ask, status } = page;
  return (
    <main className="mx-auto w-full max-w-2xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-10" data-testid="public-feature">
      <TopBar page={page} />
      <h1 className="mt-5 text-2xl leading-tight font-semibold tracking-tight break-words text-foreground">{page.title}</h1>
      <Subhead effort={page.effort} />
      <p className="mt-1 text-[13px] break-words text-muted-foreground" data-testid="public-status">
        {status.word}
        {status.at && (
          <>
            {' '}
            <LocalDate at={status.at} />
          </>
        )}
        {status.live && (
          <span data-testid="public-live">
            {' · '}
            {status.live.word}
            {status.live.detail ? `, ${status.live.detail}` : ''}
          </span>
        )}
      </p>

      {page.media.length > 0 && (
        <div className="mt-5 min-w-0" data-testid="public-media">
          <MediaCarousel slides={slidesOf(page.media)} />
        </div>
      )}

      <div className="mt-4">
        <Section eyebrow="The ask" data-testid="public-ask" commentField={null}>
          <blockquote className="border-l-2 border-border pl-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground">{ask.text}</blockquote>
          <p className="mt-2 text-[13px] text-muted-foreground" data-testid="public-asker">
            {ask.kind === 'proposed' ? `Put forward by ${page.builtBy}${ask.by ? ` · approved by ${ask.by}` : ''} · ` : ask.by ? `${ask.by} · ` : 'Asked '}
            {ask.at ? <LocalDate at={ask.at} /> : null}
          </p>
        </Section>

        <Section eyebrow="What it built" data-testid="public-built" commentField={null}>
          <p className="text-[17px] leading-relaxed font-medium break-words text-foreground">{page.built}</p>
        </Section>

        <Glance effort={page.effort} />

        {page.timeline.length > 0 && (
          <Section eyebrow="Timeline" data-testid="public-timeline" commentField={null}>
            <PublicTimeline steps={page.timeline} />
          </Section>
        )}
      </div>
    </main>
  );
}

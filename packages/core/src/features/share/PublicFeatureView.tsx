import type { PublicFeaturePage } from '@/services/factory/featureShare';
import { Section } from '@/components/patterns';
import { LocalDate } from '@/features/dashboard/factory/LocalDate';

/**
 * A FEATURE, SHOWN TO SOMEONE OUTSIDE THE WORKSPACE (Chris, 2026-10-03): the
 * ask and who asked, what it built in a sentence, how long and what it cost,
 * the mockups, the walkthrough, and the timeline. One column, read on a phone
 * first; the product's own sections and type, no shell, no links back in.
 *
 * It draws `PublicFeaturePage` and nothing else — the allow-list is built
 * server-side (`services/factory/featureShare.ts`), so this component cannot
 * show a field it was never handed. A part with nothing in it is left out
 * rather than explained.
 * @param props
 * @param props.page - The page, as the share route built it.
 */
export function PublicFeatureView({ page }: { page: PublicFeaturePage }) {
  const { ask, effort } = page;
  const took = effort.duration
    ? effort.until === 'so far' ? `${effort.duration} so far` : `${effort.duration}, from the ask to ${effort.until}`
    : null;
  return (
    <main className="mx-auto w-full max-w-2xl overflow-x-hidden px-4 py-8 sm:px-6 sm:py-12" data-testid="public-feature">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Shared feature · read-only</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight break-words text-foreground">{page.title}</h1>

      <div className="mt-4">
        <Section eyebrow="The ask" data-testid="public-ask" commentField={null}>
          <blockquote className="border-l-2 border-border pl-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground">{ask.text}</blockquote>
          <p className="mt-2 text-[13px] text-muted-foreground" data-testid="public-asker">
            {ask.by ? `${ask.by} · ` : 'Asked '}
            {ask.at ? <LocalDate at={ask.at} /> : null}
          </p>
        </Section>

        <Section eyebrow="What it built" data-testid="public-built" commentField={null}>
          <p className="text-[17px] leading-relaxed font-medium break-words text-foreground">{page.built}</p>
        </Section>

        <Section eyebrow="How long, and what it cost" data-testid="public-effort" commentField={null}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            {took && (
              <>
                <dt className="text-muted-foreground">Took</dt>
                <dd className="min-w-0 break-words text-foreground">{took}</dd>
              </>
            )}
            {effort.attempts !== null && (
              <>
                <dt className="text-muted-foreground">Attempts</dt>
                <dd className="text-foreground tabular-nums">{effort.attempts}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Cost</dt>
            <dd className="min-w-0 text-foreground">
              <span className="tabular-nums">{effort.total ?? 'not recorded'}</span>
              {effort.total && (
                <span className="mt-0.5 block text-[13px] break-words text-muted-foreground">
                  {effort.split.map(s => `${s.label.toLowerCase()} ${s.amount}`).join(' · ')}
                </span>
              )}
            </dd>
          </dl>
        </Section>

        {page.pictures.length > 0 && (
          <Section eyebrow="Mockups" data-testid="public-mockups" commentField={null}>
            <ul className="grid min-w-0 gap-5 sm:grid-cols-2">
              {page.pictures.map(p => (
                <li key={p.src} className="min-w-0">
                  <figure className="m-0">
                    <img src={p.src} alt={p.alt} loading="lazy" className="block h-auto w-full max-w-full rounded-lg border border-border bg-surface-soft" />
                    <figcaption className="mt-1.5 text-[13px] leading-snug break-words text-muted-foreground">
                      <span className="mr-1.5 text-[11px] font-semibold tracking-[0.06em] text-foreground uppercase">{p.label}</span>
                      {p.caption ?? p.alt}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {page.video && (
          <Section eyebrow="Walkthrough" data-testid="public-video" commentField={null}>
            <figure className="m-0 min-w-0">
              {page.video.kind === 'embed'
                ? (
                    <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-lg bg-muted">
                      <iframe
                        src={page.video.src}
                        title={`${page.video.label}: ${page.video.caption}`}
                        className="absolute inset-0 size-full border-0"
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )
                : (
                    <>
                      {/* A browser recording has no sound to caption; what it shows is the figcaption below. */}
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video controls preload="metadata" playsInline className="block max-h-[70vh] w-full max-w-full rounded-lg bg-muted object-contain" aria-label={`${page.video.label}: ${page.video.caption}`}>
                        <source src={page.video.src} type={page.video.type} />
                      </video>
                    </>
                  )}
              <figcaption className="mt-1.5 text-[13px] leading-snug break-words text-muted-foreground">
                <span className="text-foreground">{page.video.label}</span>
                {` · ${page.video.caption} · `}
                <LocalDate at={page.video.at} />
              </figcaption>
            </figure>
          </Section>
        )}

        {page.timeline.length > 0 && (
          <Section eyebrow="Timeline" data-testid="public-timeline" commentField={null}>
            <ol className="space-y-2">
              {page.timeline.map(t => (
                <li key={`${t.step}-${t.at}`} className="flex min-w-0 items-baseline gap-3 text-[15px]">
                  <span aria-hidden className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-foreground/60" />
                  <span className="min-w-0 flex-1 break-words text-foreground">{t.step}</span>
                  <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums"><LocalDate at={t.at} /></span>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>
    </main>
  );
}

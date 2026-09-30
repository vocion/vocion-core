import type { ReactNode } from 'react';
import type { DotTone } from '@/components/patterns';
import type { ProductOverview } from '@/libs/workspace/productOverview';
import type { RelatedItem } from '@/libs/workspace/related';
import type { RelatedWrite } from '@/services/objects/related';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DetailMeta, DetailPage, FactList, MetaChip, OpenInPreview, Related, Section, StatusDot } from '@/components/patterns';
import { PagePrompts } from '@/features/dashboard/pages/PagePrompts';
import { Link } from '@/libs/I18nNavigation';
import { relativeLabel } from '@/libs/timeAgo';

/**
 * A product's overview — what a product card's name opens. The generic
 * record page led with "Objects", "Product · active", the record's number
 * and every stored field in schema order; a person running the product
 * asked, in order: what needs me, what are we working towards, what is
 * underway, what shipped, how is it doing, and what do I need to know about
 * it (products red team, 2026-09-28). This draws exactly that, from
 * `libs/workspace/productOverview.ts`, in the Detail pattern, and keeps the
 * machinery behind Technical details.
 */

const DOT: Record<string, DotTone> = { ok: 'pass', warn: 'amber', bad: 'fail', muted: 'neutral' };
const ENV_DOT: Record<'ok' | 'degraded' | 'down', DotTone> = { ok: 'pass', degraded: 'amber', down: 'fail' };

/** Visible hover and focus on every link the page carries. */
const LINK = 'rounded-sm underline decoration-border underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function Title({ href, children }: { href: string | null; children: ReactNode }) {
  return href
    ? <Link href={href} className={`${LINK} font-medium text-foreground`}>{children}</Link>
    : <span className="font-medium text-foreground">{children}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/**
 * @param props - Props.
 * @param props.overview - The assembled overview.
 * @param props.page - The Products page it belongs to, for the crumb and Back.
 * @param props.page.slug - Its slug.
 * @param props.page.title - Its title.
 * @param props.now - The clock, for "8h ago".
 * @param props.related
 * @param props.writes
 */
export function ProductOverviewView({ overview: o, page, now, related = [], writes = [] }: { overview: ProductOverview; page: { slug: string; title: string }; now: number; related?: readonly RelatedItem[]; writes?: readonly RelatedWrite[] }) {
  const back = `/dashboard/p/${page.slug}`;
  const ago = (d: Date | null) => (d ? relativeLabel(d, now) : null);
  const attentionCount = o.attention.decisions.length + o.attention.blocked.length;

  return (
    <DetailPage
      crumbs={[{ label: page.title, href: back }, { label: o.name }]}
      title={o.name}
      subtitle={o.tagline ?? undefined}
      data-testid="product-overview"
      actions={(
        <>
          <Link href={back} className={LINK}>Back to Products</Link>
          {o.appUrl && <MetaChip href={o.appUrl}>Open app</MetaChip>}
          {o.siteUrl && <MetaChip href={o.siteUrl}>Website</MetaChip>}
        </>
      )}
      meta={(
        <DetailMeta
          items={[
            o.lifecycle,
            o.owner ? `Owned by ${o.owner.name}` : 'No owner recorded',
            <StatusDot key="health" tone={DOT[o.health.tone] ?? 'neutral'} label={o.health.label} />,
          ]}
        />
      )}
    >
      <div className="pt-4">
        <PagePrompts
          page={o.name}
          prompts={[{ label: 'Ask about this product', prompt: `How is ${o.name} doing? Start with what needs me, then what is underway and what last shipped.` }]}
        />
      </div>

      <Section eyebrow="Needs attention" id="attention" data-testid="product-attention" action={o.attention.reviewHref && o.attention.decisions.length > 0 ? <Link href={o.attention.reviewHref} className={LINK}>All decisions on Work</Link> : undefined}>
        {attentionCount === 0 && o.attention.gaps.length === 0 && <Empty>Nothing needs you on this product right now.</Empty>}
        {o.attention.decisions.length > 0 && (
          <ul className="divide-y divide-rule" data-testid="product-decisions">
            {o.attention.decisions.map(d => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-72">
                  <Title href={d.href}>{d.title}</Title>
                  {d.recommendation && (
                    <p className="mt-1 text-[13px]">
                      <span className="text-muted-foreground">Recommendation: </span>
                      {d.recommendation}
                      {d.why && <span className="text-muted-foreground">{` — ${d.why}`}</span>}
                    </p>
                  )}
                  {d.consequence && (
                    <p className="mt-0.5 text-[13px]">
                      <span className="text-muted-foreground">If it goes ahead: </span>
                      {d.consequence}
                    </p>
                  )}
                  {d.risk && (
                    <p className="mt-0.5 text-[13px]">
                      <span className="text-muted-foreground">Main risk: </span>
                      {d.risk}
                    </p>
                  )}
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {[d.owner ? `Decided by ${d.owner}` : 'No owner recorded', d.minutes ? `about ${d.minutes} min` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {d.href && (
                  <Link href={d.href} className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    Review
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {o.attention.blocked.length > 0 && (
          <ul className="mt-2 divide-y divide-rule" data-testid="product-blocked">
            {o.attention.blocked.map(b => (
              <li key={b.id} className="py-2 text-sm">
                <StatusDot tone="fail" label={<Title href={b.href}>{b.title}</Title>} />
                {b.blocker && <p className="mt-0.5 pl-3 text-[13px] text-muted-foreground">{`Blocked on ${b.blocker}`}</p>}
              </li>
            ))}
          </ul>
        )}
        {o.attention.gaps.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="product-gaps">
            {o.attention.gaps.map(g => (
              <li key={g} className="text-[13px] text-muted-foreground">
                <StatusDot tone="amber" label={g} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section eyebrow="Current focus" id="focus" data-testid="product-focus">
        {o.focus
          ? <p>{o.focus}</p>
          : (
              <>
                <Empty>No focus has been set for this product. The focus is what its owner says the team is working towards, in their words.</Empty>
                <div className="mt-2">
                  <PagePrompts
                    page={o.name}
                    prompts={[{ label: 'Set current focus', prompt: `I want to set the current focus for ${o.name}. Ask me what it is, in my words, then save my answer to the product record's currentFocus field. Do not suggest a focus yourself.` }]}
                  />
                </div>
              </>
            )}
      </Section>

      <Section eyebrow="Work in progress" id="work" data-testid="product-work" action={o.work.workHref ? <Link href={o.work.workHref} className={LINK}>Open on Work</Link> : undefined}>
        {o.work.inProgress.length === 0
          ? <Empty>{o.work.queued > 0 ? 'Nothing is being built right now.' : 'No work is underway.'}</Empty>
          : (
              <ul className="divide-y divide-rule">
                {o.work.inProgress.map(w => (
                  <li key={w.id} className="py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Title href={w.href}>{w.title}</Title>
                      <span className="text-[12px] text-muted-foreground">{w.status}</span>
                    </div>
                    {w.next && <p className="mt-0.5 text-[13px] text-muted-foreground">{w.next}</p>}
                  </li>
                ))}
              </ul>
            )}
        {o.work.queued > 0 && (
          <p className="mt-2 text-[13px]">
            {o.work.backlogHref
              ? <Link href={o.work.backlogHref} className={LINK}>{`${o.work.queued} open request${o.work.queued === 1 ? '' : 's'} in the backlog`}</Link>
              : `${o.work.queued} open request${o.work.queued === 1 ? '' : 's'} in the backlog`}
          </p>
        )}
      </Section>

      <Section eyebrow="Recent releases" id="releases" data-testid="product-releases" action={o.releases.allHref ? <Link href={o.releases.allHref} className={LINK}>All releases</Link> : undefined}>
        {o.releases.recent.length === 0
          ? <Empty>Nothing has been released for this product here.</Empty>
          : (
              <ul className="divide-y divide-rule">
                {o.releases.recent.map(r => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                    <Title href={r.href}>{r.title}</Title>
                    <span className="text-[12px] text-muted-foreground">{[ago(r.at), r.healthAfter ? `check after: ${r.healthAfter}` : null].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            )}
      </Section>

      {/* Where it runs. Drawn only when an environment is recorded: a
          product with none has one less section, not an empty one. What
          each one is running and whether the check passed is the line; the
          hosting ids, the pipeline step and the rollback are the record's. */}
      {o.environments.length > 0 && (
        <Section eyebrow="Where it runs" id="environments" data-testid="product-environments">
          <ul className="divide-y divide-rule">
            {o.environments.map(e => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <div className="min-w-0">
                  <Title href={e.href}>{e.name}</Title>
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className={`${LINK} ml-2 text-[13px] text-muted-foreground`}>
                      {e.url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
                {(e.deployedSha || e.health) && (
                  <span className="text-[12px] text-muted-foreground">
                    {e.health
                      ? <StatusDot tone={ENV_DOT[e.health]} label={[e.deployedSha, ago(e.deployedAt), e.health === 'ok' ? 'healthy' : e.health].filter(Boolean).join(' · ')} />
                      : [e.deployedSha, ago(e.deployedAt)].filter(Boolean).join(' · ')}
                    {e.runUrl && (
                      <a href={e.runUrl} target="_blank" rel="noopener noreferrer" className={`${LINK} ml-2`} data-testid="product-environment-run">run</a>
                    )}
                  </span>
                )}
                {/* What the pipeline last did here, from the record (backlog 049). */}
                {e.line && <p className="basis-full text-[12px] text-muted-foreground" data-testid="product-environment-line">{e.line}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section eyebrow="Product performance" id="performance" data-testid="product-performance">
        <FactList facts={[{ label: 'Health', value: <StatusDot tone={DOT[o.health.tone] ?? 'neutral'} label={`${o.health.label} — ${o.health.detail}`} /> }, ...o.performance.measures]} />
        {o.performance.connect && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            {o.performance.connect}
            {' '}
            <Link href="/dashboard/connectors" className={LINK}>Connect a source</Link>
          </p>
        )}
      </Section>

      <Section eyebrow="Product context" id="context" data-testid="product-context">
        {o.context.promises.length > 0 && (
          <div className="mb-3">
            <h4 className="mb-1 text-[12px] text-muted-foreground">What we have promised customers</h4>
            <ul className="list-disc space-y-0.5 pl-5">
              {o.context.promises.map(p => <li key={p}>{p}</li>)}
            </ul>
          </div>
        )}
        <FactList
          facts={[
            o.context.ourPrice && { label: 'Our price', value: o.context.ourPrice },
            o.context.incumbent && {
              label: 'Measured against',
              value: (
                <span>
                  {[o.context.incumbent.name, o.context.incumbent.plan].filter(Boolean).join(' ')}
                  {o.context.incumbent.price && ` at ${o.context.incumbent.price}`}
                  {o.context.incumbent.checkedOn && <span className="text-muted-foreground">{` · checked ${o.context.incumbent.checkedOn}`}</span>}
                  {o.context.incumbent.sourceUrl && (
                    <>
                      {' · '}
                      <a href={o.context.incumbent.sourceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>source</a>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
        {o.context.notes && (
          <div className="prose prose-sm mt-3 max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{o.context.notes}</ReactMarkdown>
          </div>
        )}
        {o.context.builtOn && <p className="mt-3 text-[12px] text-muted-foreground">{o.context.builtOn}</p>}
        {o.context.promises.length === 0 && !o.context.ourPrice && !o.context.incumbent && !o.context.notes && !o.context.builtOn && (
          <Empty>No promises, pricing or notes are recorded for this product.</Empty>
        )}
      </Section>

      <details className="border-b border-rule py-4" data-testid="product-activity" open={writes.length > 0 ? true : undefined}>
        <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">Activity</summary>
        {/* What changed on what it is connected to — its environments and
            repositories, kept true by the Release engineer (`relatedWrites`). */}
        {writes.length > 0 && (
          <ul className="mt-2 divide-y divide-rule" data-testid="product-writes">
            {writes.map(w => (
              <li key={w.runId} className="group/row flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="text-muted-foreground">{w.line ? `${w.by} on ` : `${w.by} updated `}</span>
                  <Link href={w.href} className={LINK}>{w.title}</Link>
                  {w.line && <span className="text-muted-foreground">{`: ${w.line}`}</span>}
                  <span className="text-muted-foreground">{` · ${relativeLabel(new Date(w.at), now)}`}</span>
                </span>
                <OpenInPreview recordRef={w.preview} label={`Open ${w.title}'s history in preview`} />
              </li>
            ))}
          </ul>
        )}
        {o.activity.length === 0
          ? <div className="mt-2"><Empty>Nothing finished in the last 14 days.</Empty></div>
          : (
              <ul className="mt-2 divide-y divide-rule">
                {o.activity.map(a => (
                  <li key={a.id} className="py-2 text-sm">
                    <Title href={a.href}>{a.title}</Title>
                    {a.line && <p className="mt-0.5 text-[13px] text-muted-foreground">{a.line}</p>}
                  </li>
                ))}
              </ul>
            )}
      </details>

      {/* What the product is connected to, in the one Related block (`relatedOf`). */}
      {related.length > 0 && (
        <Section eyebrow="Related" commentField={null} data-testid="product-related">
          <Related items={related} />
        </Section>
      )}

      <details className="py-4" data-testid="product-technical">
        <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">Technical details</summary>
        <div className="mt-2">
          <FactList facts={o.technical.facts} />
          {o.technical.other.length > 0 && (
            <>
              <h4 className="mt-4 mb-1 text-[12px] text-muted-foreground">Other fields</h4>
              <FactList facts={o.technical.other} />
            </>
          )}
          <p className="mt-3 text-[13px]">
            <Link href={`/dashboard/objects/${o.id}`} className={LINK}>Edit fields and see the record's history</Link>
          </p>
        </div>
      </details>
    </DetailPage>
  );
}

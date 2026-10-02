import type { ReactNode } from 'react';
import type { MediaSlide } from './MediaCarousel';
import type { DotTone } from '@/components/patterns';
import type { RecordStatus } from '@/libs/factory/liveStatus';
import type { ProductSection } from '@/libs/workspace/pageFields';
import type { OverviewEnvironment, ProductOverview } from '@/libs/workspace/productOverview';
import type { RelatedItem } from '@/libs/workspace/related';
import type { RelatedWrite } from '@/services/objects/related';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DetailMeta, DetailPage, FactList, MetaChip, OpenInPreview, Related, Section, StatusDot } from '@/components/patterns';
import { PagePrompts } from '@/features/dashboard/pages/PagePrompts';
import { Link } from '@/libs/I18nNavigation';
import { relativeLabel } from '@/libs/timeAgo';
import { PRODUCT_SECTIONS } from '@/libs/workspace/pageFields';
import { FeatureBuild } from './FeatureBuild';
import { FeatureDismiss } from './FeatureDismiss';
import { MediaCarousel } from './MediaCarousel';
import { ProductMeasures } from './ProductMeasures';
import { UndoRun } from './UndoRun';
import { LiveWorkStatus } from './WorkStatus';

/**
 * A PRODUCT'S OVERVIEW, for the person who runs it (Chris, 2026-10-01: "make
 * it better for a PM. Like we did for feature detail. And I should have
 * explorability into release engineer needs and configs there (env and git
 * etc) but that shouldn't be primary. If that product has Wiki pages I should
 * have a preview and link too").
 *
 * One question per section, in the order the plugin's page declares
 * (`recordPage.sections` on the products page): how is it doing, what needs
 * me, what is moving, what shipped, what is proposed, what it looks like,
 * what the wiki says, what it is — then, folded, how it ships, what happened
 * and what it is connected to. The data is `libs/workspace/productOverview.ts`;
 * the In progress rows are the feature page's own You, Now, Next, kept live.
 */

const TONE: Record<string, DotTone> = { ok: 'pass', warn: 'amber', bad: 'fail', muted: 'neutral' };
const ENV_DOT: Record<'ok' | 'degraded' | 'down', DotTone> = { ok: 'pass', degraded: 'amber', down: 'fail' };

/** Visible hover and focus on every link the page carries. */
const LINK = 'rounded-sm underline decoration-border underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const ACTION = 'inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function Title({ href, children }: { href: string | null; children: ReactNode }) {
  return href
    ? <Link href={href} className={`${LINK} font-medium text-foreground`}>{children}</Link>
    : <span className="font-medium text-foreground">{children}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

function Out({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={LINK} data-testid={testId}>{children}</a>;
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith('#')
    ? <a href={href} className={ACTION}>{children}</a>
    : <Link href={href} className={ACTION}>{children}</Link>;
}

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * "Sep 30" for a wiki page's last update.
 * @param iso
 */
function shortDay(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export type ProductOverviewProps = {
  overview: ProductOverview;
  /** The Products page it belongs to, for the crumb. */
  page: { slug: string; title: string };
  /** The clock, for "8h ago". */
  now: number;
  related?: readonly RelatedItem[];
  writes?: readonly RelatedWrite[];
  /** You, Now, Next for the work in flight, by record id (`loadWorkStatuses`). */
  statuses?: ReadonlyArray<RecordStatus>;
  /** The product's pictures (`loadProductSlides`). */
  slides?: MediaSlide[];
  /** The sections, in order, as the page declares them; every one when absent. */
  sections?: readonly ProductSection[];
  /** Sections drawn closed. */
  folded?: readonly ProductSection[];
  /** The plugin's paused automations, drawn inside How it ships. */
  paused?: ReactNode;
  /** The page's live re-read (`LiveRefresh`), drawn with the header's actions. */
  live?: ReactNode;
  /** The request type's slug, for Dismiss (`libs/factory/types.ts`). */
  requestType?: string;
};

/**
 * @param props - {@link ProductOverviewProps}.
 */
export function ProductOverviewView(props: ProductOverviewProps) {
  const { overview: o, page, now, related = [], writes = [], statuses = [], slides = [] } = props;
  const order = props.sections ?? PRODUCT_SECTIONS;
  const folded = new Set(props.folded ?? []);
  const ago = (d: Date | null) => (d ? relativeLabel(d, now) : null);
  const statusOf = new Map(statuses.map(s => [s.record.id, s]));

  // Wiki pages have their own section; what How it ships draws is not
  // repeated under Related.
  const wiki = related.filter(r => r.kind === 'page');
  const drawn = new Set([...o.environments.map(e => String(e.id)), ...o.engineering.repos.map(r => String(r.id))]);
  const rest = related.filter(r => r.kind !== 'page' && !(r.preview?.type === 'object' && drawn.has(r.preview.id)));

  const sections: Record<ProductSection, () => ReactNode> = {
    // HOW IS IT DOING — each figure with its direction, then the focus.
    doing: () => (
      <Section key="doing" eyebrow="How it is doing" id="doing" data-testid="product-doing" commentField="How it is doing">
        <ProductMeasures measures={o.measures} />
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
          {o.performance.connect
            ? (
                <span className="text-muted-foreground">
                  Usage and revenue: not connected ·
                  {' '}
                  <Link href="/dashboard/connectors" className={LINK}>Connect a source</Link>
                </span>
              )
            : o.performance.measures.filter(m => m.label.startsWith('Revenue')).map(m => <span key={m.label}>{`${m.label}: ${m.value}`}</span>)}
        </div>
        <div className="mt-3 text-[14px]" data-testid="product-focus">
          {o.focus
            ? (
                <p>
                  <span className="text-muted-foreground">Focus: </span>
                  {o.focus}
                </p>
              )
            : (
                <div className="[&_[data-testid=page-prompts]]:mb-0">
                  <PagePrompts
                    page={o.name}
                    prompts={[{ label: 'Set current focus', prompt: `I want to set the current focus for ${o.name}. Ask me what it is, in my words, then save my answer to the product record's currentFocus field. Do not suggest a focus yourself.` }]}
                  />
                </div>
              )}
        </div>
      </Section>
    ),

    // WHAT NEEDS ME — one line each, with the move.
    needs: () => (
      <Section key="needs" eyebrow="Needs you" id="attention" data-testid="product-attention" commentField="Needs you">
        {o.needs.length === 0
          ? <Empty>Nothing needs you on this product right now.</Empty>
          : (
              <ul className="divide-y divide-rule" data-testid="product-needs">
                {o.needs.map(n => (
                  <li key={n.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2" data-need={n.key}>
                    <span className="min-w-0 flex-1 basis-64 text-sm"><StatusDot tone={TONE[n.tone] ?? 'neutral'} label={n.line} /></span>
                    {n.action && <ActionLink href={n.action.href}>{n.action.label}</ActionLink>}
                  </li>
                ))}
              </ul>
            )}
      </Section>
    ),

    // WHAT IS MOVING — each piece of work with its You, Now, Next, live.
    moving: () => (
      <Section key="moving" eyebrow="In progress" id="work" data-testid="product-work" action={o.work.workHref ? <Link href={o.work.workHref} className={LINK}>Open on Work</Link> : undefined}>
        {o.work.inProgress.length === 0
          ? <Empty>Nothing is being built right now.</Empty>
          : (
              <ul className="divide-y divide-rule">
                {o.work.inProgress.map((w) => {
                  const status = statusOf.get(Number(w.id));
                  return (
                    <li key={w.id} className="py-3" data-testid="product-work-row">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <Title href={w.href}>{w.title}</Title>
                        <span className="text-[12px] text-muted-foreground">{status?.stage.label ?? w.status}</span>
                      </div>
                      {status
                        ? <LiveWorkStatus recordId={Number(w.id)} initial={status} hideStage className="mt-1.5" />
                        : w.next && <p className="mt-0.5 text-[13px] text-muted-foreground">{w.next}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
      </Section>
    ),

    // WHAT SHIPPED — and whether QA saw it working live.
    shipped: () => (
      <Section key="shipped" eyebrow="Shipped" id="releases" data-testid="product-releases" action={o.releases.allHref ? <Link href={o.releases.allHref} className={LINK}>All releases</Link> : undefined}>
        {o.releases.recent.length === 0
          ? <Empty>Nothing has shipped for this product yet.</Empty>
          : (
              <ul className="divide-y divide-rule">
                {o.releases.recent.map(r => (
                  <li key={r.id} className="py-2" data-testid="product-release-row">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Title href={r.href}>{r.title}</Title>
                      <span className="text-[12px] text-muted-foreground">{ago(r.at)}</span>
                    </div>
                    {r.live && <p className="mt-0.5 min-w-0 text-[13px] text-muted-foreground" data-testid="product-release-live"><StatusDot tone={TONE[r.live.tone] ?? 'neutral'} label={<span className="line-clamp-1">{r.live.line}</span>} className="max-w-full" /></p>}
                  </li>
                ))}
              </ul>
            )}
      </Section>
    ),

    // WHAT IS PROPOSED — compact: the name, why in a line, Build or Dismiss.
    proposed: () => (o.proposals.shown.length === 0
      ? null
      : (
          <Section key="proposed" eyebrow="Proposed" id="proposed" data-testid="product-proposed" action={o.proposals.href ? <Link href={o.proposals.href} className={LINK}>{o.proposals.more > 0 ? `${o.proposals.more} more on Work` : 'Open on Work'}</Link> : undefined}>
            <ul className="divide-y divide-rule">
              {o.proposals.shown.map(p => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5" data-testid="product-proposal">
                  <div className="min-w-0 flex-1 basis-64">
                    <Title href={p.href}>{p.title}</Title>
                    {p.why && <p className="mt-0.5 line-clamp-1 text-[13px] text-muted-foreground">{p.why}</p>}
                  </div>
                  <FeatureBuild requestId={Number(p.id)} planId={null} label="Build" pendingRunId={p.pendingRunId ?? undefined} disabledReason={p.blocked ?? undefined}>
                    <FeatureDismiss requestId={Number(p.id)} objectType={props.requestType} compact />
                  </FeatureBuild>
                </li>
              ))}
            </ul>
          </Section>
        )),

    // WHAT IT LOOKS LIKE — mockups of work underway, and what QA saw live.
    look: () => (slides.length === 0
      ? null
      : (
          <Section key="look" eyebrow="How it looks" id="look" data-testid="product-look" commentField={null}>
            <MediaCarousel slides={slides} />
          </Section>
        )),

    // WHAT THE WIKI SAYS ABOUT IT — each page's first lines, and the page.
    wiki: () => (wiki.length === 0
      ? null
      : (
          <Section key="wiki" eyebrow="Wiki" id="wiki" data-testid="product-wiki" commentField={null}>
            <ul className="divide-y divide-rule">
              {wiki.map(w => (
                <li key={w.key} className="group/row flex items-start gap-2 py-2.5" data-testid="product-wiki-page">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Title href={w.href}>{w.title}</Title>
                      {shortDay(w.at) && <span className="text-[12px] text-muted-foreground">{`Updated ${shortDay(w.at)}`}</span>}
                    </div>
                    {w.details?.[0] && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{w.details[0]}</p>}
                  </div>
                  {w.preview && <OpenInPreview recordRef={w.preview} label={`Open ${w.title} in preview`} />}
                </li>
              ))}
            </ul>
          </Section>
        )),

    // WHAT IT IS — the price against the incumbent, the promises, the notes.
    about: () => <About key="about" o={o} />,

    // HOW IT SHIPS — the Release engineer's view: environments, repositories,
    // the pipeline. Folded, one line saying what is inside, and open when
    // anything in it is paused or stopped, so nothing waits there unseen.
    engineering: () => (
      <details
        key="engineering"
        id="engineering"
        className="group border-b border-rule py-4"
        data-testid="product-engineering"
        open={!folded.has('engineering') || o.needs.some(n => n.key === 'paused') || o.engineering.pipeline.some(p => p.tone === 'bad') ? true : undefined}
      >
        <summary className="cursor-pointer list-none text-[13px] text-muted-foreground hover:text-foreground">
          <span className="text-[11px] font-semibold tracking-[0.06em] uppercase">How it ships</span>
          {o.engineering.summary && <span className="ml-2">{o.engineering.summary}</span>}
        </summary>
        <Engineering o={o} now={now} paused={props.paused} />
      </details>
    ),

    // WHAT HAPPENED — newest first.
    activity: () => (writes.length === 0 && o.activity.length === 0
      ? null
      : (
          <details key="activity" className="border-b border-rule py-4" data-testid="product-activity" open={folded.has('activity') ? undefined : true}>
            <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase hover:text-foreground">Activity</summary>
            {writes.length > 0 && (
              <ul className="mt-2 divide-y divide-rule" data-testid="product-writes">
                {[...writes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map(w => (
                  <li key={w.runId} className="group/row flex items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="text-muted-foreground">{w.line ? `${w.by} on ` : `${w.by} updated `}</span>
                      <Link href={w.href} className={LINK}>{w.title}</Link>
                      {w.line && <span className="text-muted-foreground">{`: ${w.line}`}</span>}
                      <span className="text-muted-foreground">{` · ${relativeLabel(new Date(w.at), now)}${w.undone ? ' · undone' : ''}`}</span>
                    </span>
                    {/* A move the pipeline made on its own is undone from where it is read. */}
                    {w.undoable && <UndoRun recordId={w.recordId} runId={w.runId} testId="product-write-undo" />}
                    <OpenInPreview recordRef={w.preview} label={`Open ${w.title}'s history in preview`} />
                  </li>
                ))}
              </ul>
            )}
            {o.activity.length > 0 && (
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
        )),

    // WHAT IT IS CONNECTED TO, in the one Related block (`relatedOf`).
    related: () => (rest.length === 0
      ? null
      : (
          <Section key="related" eyebrow="Related" commentField={null} data-testid="product-related">
            <Related items={rest} />
          </Section>
        )),
  };

  return (
    <DetailPage
      crumbs={[{ label: page.title, href: `/dashboard/p/${page.slug}` }, { label: o.name }]}
      title={o.name}
      subtitle={o.tagline ?? undefined}
      data-testid="product-overview"
      actions={(
        <>
          {o.appUrl && <MetaChip href={o.appUrl}>Open app</MetaChip>}
          {o.siteUrl && <MetaChip href={o.siteUrl}>Website</MetaChip>}
          <div className="[&_[data-testid=page-prompts]]:mb-0">
            <PagePrompts
              page={o.name}
              prompts={[{ label: 'Ask', prompt: `How is ${o.name} doing? Start with what needs me, then what is underway and what last shipped.` }]}
            />
          </div>
          {props.live}
        </>
      )}
      meta={(
        <DetailMeta
          items={[
            o.lifecycle,
            o.owner ? `Owned by ${o.owner.name}` : null,
            <span key="health" data-testid="product-live-health"><StatusDot tone={TONE[o.liveHealth.tone] ?? 'neutral'} label={o.liveHealth.line} /></span>,
          ]}
        />
      )}
    >
      {order.map(key => sections[key]?.())}
    </DetailPage>
  );
}

function About({ o }: { o: ProductOverview }) {
  const c = o.context;
  const price = c.ourPrice || c.incumbent
    ? (
        <p data-testid="product-price">
          {c.ourPrice && <span className="font-medium">{c.ourPrice}</span>}
          {c.incumbent && (
            <span className="text-muted-foreground">
              {`${c.ourPrice ? ' against ' : 'Measured against '}${[c.incumbent.name, c.incumbent.plan].filter(Boolean).join(' ')}${c.incumbent.price ? ` at ${c.incumbent.price}` : ''}`}
              {c.incumbent.checkedOn && ` · checked ${c.incumbent.checkedOn}`}
              {c.incumbent.sourceUrl && (
                <>
                  {' · '}
                  <Out href={c.incumbent.sourceUrl}>source</Out>
                </>
              )}
            </span>
          )}
        </p>
      )
    : null;
  if (!price && c.promises.length === 0 && !c.notes && !c.builtOn) {
    return null;
  }
  return (
    <Section eyebrow="About it" id="context" data-testid="product-context">
      <div className="space-y-2">
        {price}
        {c.promises.length > 0 && (
          <p className="text-[13px]">
            <span className="text-muted-foreground">Promised customers: </span>
            {c.promises.map((p, i) => (
              <span key={p}>
                {i > 0 && ' · '}
                {/^https:\/\//.test(p) ? <Out href={p}>{host(p)}</Out> : p}
              </span>
            ))}
          </p>
        )}
        {c.builtOn && <p className="text-[13px] text-muted-foreground">{c.builtOn}</p>}
        {c.notes && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Notes</summary>
            <div className="prose prose-sm mt-2 max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.notes}</ReactMarkdown>
            </div>
          </details>
        )}
      </div>
    </Section>
  );
}

function EnvironmentRow({ e, now }: { e: OverviewEnvironment; now: number }) {
  const facts = [
    e.deployedSha,
    e.deployedAt ? relativeLabel(e.deployedAt, now) : null,
    e.health === 'ok' ? 'healthy' : e.health,
  ].filter(Boolean).join(' · ');
  return (
    <li className="py-2.5" data-testid="product-environment">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0">
          <Title href={e.href}>{e.name}</Title>
          {e.url && <span className="ml-2 text-[13px] text-muted-foreground"><Out href={e.url}>{host(e.url)}</Out></span>}
        </span>
        {facts && (
          <span className="text-[12px] text-muted-foreground">
            {e.health ? <StatusDot tone={ENV_DOT[e.health]} label={facts} /> : facts}
            {e.runUrl && (
              <>
                {' · '}
                <Out href={e.runUrl} testId="product-environment-run">run</Out>
              </>
            )}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[12px] text-muted-foreground" data-testid="product-environment-config">
        {[
          e.deploy ? `Deploys by ${[e.deploy.workflow, e.deploy.step ? `step ${e.deploy.step}` : null].filter(Boolean).join(', ')}` : null,
          e.qaSignIn === null ? null : e.qaSignIn ? 'QA sign-in stored' : 'No QA sign-in',
        ].filter(Boolean).join(' · ')}
        {e.deploy?.url && (
          <>
            {' · '}
            <Out href={e.deploy.url}>workflow</Out>
          </>
        )}
      </p>
      {/* What the pipeline last did here, from the record (backlog 049). */}
      {e.line && <p className="text-[12px] text-muted-foreground" data-testid="product-environment-line">{e.line}</p>}
      {e.advice && <p className="text-[12px] text-muted-foreground" data-testid="product-environment-advice">{`Answers, but not as its record expects: ${e.advice}`}</p>}
    </li>
  );
}

function Engineering({ o, now, paused }: { o: ProductOverview; now: number; paused?: ReactNode }) {
  const h = 'mt-4 mb-1 text-[12px] font-medium text-muted-foreground';
  return (
    <div className="mt-2 text-sm" data-testid="product-environments">
      {o.environments.length > 0 && (
        <>
          <h4 className={h}>Environments</h4>
          <ul className="divide-y divide-rule">
            {o.environments.map(e => <EnvironmentRow key={e.id} e={e} now={now} />)}
          </ul>
        </>
      )}
      {o.engineering.repos.length > 0 && (
        <>
          <h4 className={h}>Repositories</h4>
          <ul className="divide-y divide-rule" data-testid="product-repos">
            {o.engineering.repos.map(r => (
              <li key={r.id} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Title href={r.href}>{r.name}</Title>
                  <span className="text-[12px] text-muted-foreground">
                    {r.branch && `branch ${r.branch}`}
                    {r.url && (
                      <>
                        {r.branch && ' · '}
                        <Out href={r.url}>GitHub</Out>
                      </>
                    )}
                  </span>
                </div>
                {r.checks.length > 0 && <p className="mt-0.5 text-[12px] text-muted-foreground">{`Checks: ${r.checks.join(', ')}`}</p>}
                {r.paths.length > 0 && <p className="text-[12px] text-muted-foreground">{`This product's paths: ${r.paths.join(', ')}`}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className={h}>Pipeline</h4>
      {o.engineering.pipeline.length === 0 && !paused
        ? <Empty>No pipeline change is open and no fix is underway.</Empty>
        : (
            <ul className="divide-y divide-rule" data-testid="product-pipeline">
              {o.engineering.pipeline.map(p => (
                <li key={p.key} className="py-2 text-[13px]">
                  <StatusDot
                    tone={TONE[p.tone] ?? 'neutral'}
                    label={p.href ? (p.external ? <Out href={p.href}>{p.line}</Out> : <Link href={p.href} className={LINK}>{p.line}</Link>) : p.line}
                  />
                </li>
              ))}
            </ul>
          )}
      {paused && <div className="mt-3">{paused}</div>}
      <details className="mt-4" data-testid="product-technical">
        <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground">The record</summary>
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
    </div>
  );
}

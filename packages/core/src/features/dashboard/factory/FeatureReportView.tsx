import type { DotTone } from '@/components/patterns';
import type { FeatureReport, LiveBuild, ReportAction, ReportEvidence, ReportNotice, ReportStatus, Tone } from '@/services/factory/featureReport';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Section, StatusDot } from '@/components/patterns';
import { LiveRefresh } from '@/features/dashboard/LiveRefresh';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { money } from '@/services/factory/featureReport';
import { FeatureActivity } from './FeatureActivity';
import { FeatureBuild, FeatureHeadline } from './FeatureBuild';
import { FeatureDismiss } from './FeatureDismiss';
import { FeatureDrawerLink, PreviewOpen } from './FeatureDrawerLink';
import { LocalDate } from './LocalDate';
import { MediaCarousel } from './MediaCarousel';

/**
 * The feature page, drawn for the person who owns the outcome (Chris,
 * 2026-09-28).
 *
 * One column, in the order a product owner reads it:
 *
 *   1. Introduction — the title and subtitle (the route's title bar), the
 *      user story as a short paragraph, and what it should change for people
 *   2. Where it is — one or two sentences and one action
 *   3. What it looks like — the gallery, intact
 *   4. Connected work — the three newest conversations and runs
 *   5. Plan · 6. Implementation · 7. Acceptance · 8. Release · 9. Activity —
 *      each a few lines, with the full record one tap away in the preview
 *      pane (`FeatureDrawerLink` → `feature_section:<id>.<key>`)
 *
 * Everything the old page printed is still reachable: the sections the report
 * assembles all render into a drawer (`services/factory/featureDrawer.ts`).
 * Nothing here queries, formats money twice, or decides what happened — the
 * assembly (`services/factory/featureReport.ts`) does.
 *
 * It reads at 390px: one column throughout, every long value allowed to
 * break, no horizontal scroll at any width (`FeatureReportView.layout.test.tsx`
 * measures it).
 */

const DOT_TONE: Record<Tone, DotTone> = { ok: 'pass', warn: 'amber', bad: 'fail', info: 'ink', muted: 'neutral' };

/** What this evidence is FOR, in the reader's words rather than the field's. */
const ROLE_WORD: Record<string, string> = {
  'proposed': 'Proposed',
  'shipped': 'After',
  'qa-screenshot': 'Screenshot',
  'qa-video': 'Video',
  'qa-report': 'Report',
};

/**
 * SHOW THE THING. A picture is drawn, a document is rendered where it sits,
 * and only a link out — the one thing a page cannot inline — stays a card.
 * @param props
 * @param props.items - The evidence to draw.
 */
function Gallery({ items }: { items: ReportEvidence[] }) {
  return (
    <ul className="mt-3 space-y-6">
      {items.map(item => (
        <li key={item.id} className="min-w-0">
          {(item.imageUrl !== null || item.body !== null) && (
            <figure className={`m-0 overflow-hidden rounded-xl border bg-surface-soft ${item.role === 'proposed' ? 'border-dashed border-border' : 'border-border'}`}>
              {item.imageUrl !== null && (
                <a href={item.imageUrl} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} full size`}>
                  <img src={item.imageUrl} alt={item.caption ?? item.title} loading="lazy" className="block w-full" />
                </a>
              )}
              {item.imageUrl === null && item.body !== null && (
                <div className="max-h-[32rem] overflow-y-auto px-4 py-3.5 sm:px-5">
                  <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-headings:mt-4 prose-headings:mb-1.5 prose-headings:text-[13px] prose-headings:tracking-wide prose-headings:text-muted-foreground prose-headings:uppercase prose-p:leading-relaxed prose-pre:bg-background prose-pre:text-[11px] prose-pre:leading-snug prose-table:text-xs">
                    <Markdown remarkPlugins={[remarkGfm]}>{item.body}</Markdown>
                  </div>
                </div>
              )}
            </figure>
          )}
          <figcaption className="mt-2 text-[15px] break-words">
            <span className="mr-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{ROLE_WORD[item.role] ?? item.role}</span>
            {item.title}
            {item.url && <a href={item.url} className="ml-2 text-xs whitespace-nowrap text-muted-foreground underline underline-offset-2 hover:text-foreground">Open</a>}
          </figcaption>
          {item.caption !== null && <p className="mt-0.5 max-w-prose text-[13px] leading-relaxed break-words text-muted-foreground">{item.caption}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * WHAT IT LOOKS LIKE: every picture in one swipeable carousel, tap to zoom.
 * With no picture yet it says so, honestly, instead of stretching an icon.
 * @param props
 * @param props.pictures - The pictures, ranked.
 * @param props.docs - Mockups that are documents rather than pictures.
 */
function HeroMedia({ pictures, docs }: { pictures: ReportEvidence[]; docs: ReportEvidence[] }) {
  if (pictures.length === 0) {
    return (
      <div id="report-visuals" data-section="visuals">
        {docs.length > 0
          ? <Gallery items={docs} />
          : (
              <p data-testid="report-preview-pending" className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                Preview pending — no mockup or screenshot yet.
              </p>
            )}
      </div>
    );
  }
  const word = (e: ReportEvidence) => (e.role === 'today' ? 'Today' : ROLE_WORD[e.role] ?? e.role);
  return (
    <div id="report-visuals" data-section="visuals" className="space-y-4">
      <MediaCarousel slides={pictures.map(p => ({ id: p.id, src: p.imageUrl!, label: word(p), title: p.title, caption: p.caption }))} />
      {docs.length > 0 && <Gallery items={docs} />}
    </div>
  );
}

/**
 * Seconds as a person reads them: "45s", "3m 10s", "1h 12m".
 * @param sec - Seconds.
 */
function duration(sec: number): string {
  if (sec < 60) {
    return `${sec}s`;
  }
  if (sec < 3600) {
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/**
 * WATCH THE BUILD (backlog 007): the step the worker is on, how long it has
 * run, how long since it last spoke, and the tail of what it printed. A build
 * that has gone quiet says so in words.
 * @param props - The live view.
 * @param props.live - What the run last reported.
 */
function WatchTheBuild({ live }: { live: LiveBuild }) {
  const since = live.sinceSec === null ? null : duration(live.sinceSec);
  const quiet = live.quietSec !== null && live.quietSec > 90 ? `quiet for ${duration(live.quietSec)}` : null;
  return (
    <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-2.5" data-testid="watch-the-build">
      <p className="text-xs text-foreground/90">
        <span className="font-medium">{live.step ?? 'Working'}</span>
        {since && <span className="text-muted-foreground">{` · ${since} so far`}</span>}
        {quiet && <span className="text-brand-amber-deep">{` · ${quiet}`}</span>}
      </p>
      {live.log.length > 0 && (
        <pre className="mt-1.5 max-h-40 overflow-x-auto font-mono text-[11px] leading-relaxed whitespace-pre text-muted-foreground">{live.log.join('\n')}</pre>
      )}
    </div>
  );
}

/**
 * WHICH WORK THIS IS — product, size, spend, age — under the subtitle in the
 * title block, smaller and muted (it is metadata, not the headline). It lives
 * inside the title block because a negative margin inside the scrolling
 * report column once clipped it to two grey specks (2026-09-23).
 * @param props - The context bits.
 * @param props.bits - Short facts, in reading order.
 */
export function ReportContextLine({ bits }: { bits: readonly string[] }) {
  if (bits.length === 0) {
    return null;
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
      {bits.map((bit, i) => (
        <span key={bit} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-border">·</span>}
          {bit}
        </span>
      ))}
    </p>
  );
}

/**
 * A process warning in plain words, one line. Kept for any caller that still
 * holds a raw contradiction; the page itself reads `report.notices`.
 * @param c - The contradiction as recorded.
 */
export function plainWarning(c: string): string {
  if (/plan rule required a plan/i.test(c)) {
    return 'This feature was built without the required plan.';
  }
  const first = c.split(/(?<=[.!?])\s/)[0] ?? c;
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

/**
 * The one action, drawn by kind: the Build button, a drawer, or a link.
 * @param props
 * @param props.action - The action.
 * @param props.report - The report, for the ids a Build needs.
 * @param props.primary - Whether this is the page's one primary action.
 * @param props.children - A quieter second action, placed beside Build.
 */
function ActionButton({ action, report, primary, children }: { action: ReportAction; report: FeatureReport; primary: boolean; children?: React.ReactNode }) {
  if (action.kind === 'build') {
    return (
      <div data-testid="feature-decide">
        <FeatureBuild requestId={report.requestId} planId={report.planId} label={action.label} pendingRunId={action.runId}>{children}</FeatureBuild>
      </div>
    );
  }
  if (action.kind === 'drawer') {
    return <FeatureDrawerLink requestId={report.requestId} drawer={action.drawer} look={primary ? 'primary' : 'quiet'} testId={primary ? 'report-primary-action' : undefined}>{action.label}</FeatureDrawerLink>;
  }
  const external = /^https?:\/\//i.test(action.href);
  return (
    <a
      href={action.href}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      data-testid={primary ? 'report-primary-action' : undefined}
      className={primary
        ? 'inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90'
        : 'inline-flex h-8 items-center rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground'}
    >
      {action.label}
    </a>
  );
}

/**
 * WHERE IT IS, AND THE ONE MOVE. One or two sentences — what is known, and
 * what is not established — and one action that follows the state.
 * @param props
 * @param props.report - The report.
 */
function StatusBlock({ report }: { report: FeatureReport }) {
  const s: ReportStatus = report.status;
  const secondary = s.secondary === null
    ? null
    : s.secondary.kind === 'dismiss'
      ? <FeatureDismiss requestId={report.requestId} />
      : <ActionButton action={s.secondary} report={report} primary={false} />;
  return (
    <section id="report-state" data-testid="report-status" aria-label="Where this work is" className="space-y-3">
      <FeatureHeadline requestId={report.requestId} tone={DOT_TONE[s.tone]} headline={s.headline} sentence={s.sentence} />
      {s.action && (
        <div className="flex flex-wrap items-center gap-2">
          {s.action.kind === 'build'
            ? <ActionButton action={s.action} report={report} primary>{secondary}</ActionButton>
            : (
                <>
                  <ActionButton action={s.action} report={report} primary />
                  {secondary}
                </>
              )}
        </div>
      )}
      {report.notices.length > 0 && <Notices notices={report.notices} requestId={report.requestId} />}
    </section>
  );
}

/**
 * RECORD PROBLEMS, QUIETLY. Each says what is known, whether it blocks, and
 * one specific move; the raw disagreement is in the drawer. None of these is
 * red — a disagreement between records is not an outage (Chris, 2026-09-28).
 * @param props
 * @param props.notices - The notices.
 * @param props.requestId - The request, for the drawer.
 */
function Notices({ notices, requestId }: { notices: ReportNotice[]; requestId: number }) {
  return (
    <ul id="report-notices" data-testid="report-notices" className="space-y-1.5">
      {notices.map(n => (
        <li key={n.key} data-severity={n.severity} className="flex max-w-prose items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <span aria-hidden className={`mt-[7px] size-1.5 shrink-0 rounded-full ${n.severity === 'blocking' ? 'bg-brand-fail' : 'bg-brand-borderline'}`} />
          <span className="min-w-0">
            <span className="text-foreground/90">{n.known}</span>
            {` ${n.blocks} `}
            <FeatureDrawerLink requestId={requestId} drawer={n.action.drawer} look="link" className="text-[13px]">{n.action.label}</FeatureDrawerLink>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * PLAN — the scope in a sentence, its status in a word, who approved it and
 * when, and a risk it names. Steps, rationale, boundaries, paths and the
 * approval history are in "View plan".
 * @param props
 * @param props.report - The report.
 */
function PlanBlock({ report }: { report: FeatureReport }) {
  const p = report.planSummary;
  const tone: DotTone = p.status === 'Approved' ? 'pass' : p.status === 'Superseded' || p.status === 'Rejected' ? 'neutral' : 'amber';
  return (
    <Section id="report-plan" data-testid="report-plan" eyebrow="Plan" action={<FeatureDrawerLink requestId={report.requestId} drawer="plan">View plan</FeatureDrawerLink>}>
      {p.status === null
        ? <p className="text-[15px] text-muted-foreground">{p.absence}</p>
        : (
            <div className="space-y-1.5">
              {p.scope && <p className="max-w-prose text-[15px] leading-relaxed text-foreground">{p.scope}</p>}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <StatusDot tone={tone} label={<span className="text-foreground">{p.status}</span>} />
                {p.approver && <span>{`· ${p.approver}`}</span>}
                {p.approvedAt && (
                  <span>
                    {'· '}
                    <LocalDate at={p.approvedAt} />
                  </span>
                )}
                {p.steps > 0 && <span>{`· ${p.steps} step${p.steps === 1 ? '' : 's'}`}</span>}
              </p>
              {p.risk && (
                <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
                  <span className="text-foreground/80">Risk it names: </span>
                  {p.risk}
                </p>
              )}
            </div>
          )}
    </Section>
  );
}

/**
 * IMPLEMENTATION — build and the change as one. The latest attempt as a row,
 * the earlier ones counted, the five delivery facts kept apart (run completed
 * ≠ checks passed ≠ merged ≠ acceptance verified ≠ released), and the spend.
 * @param props
 * @param props.report - The report.
 */
function ImplementationBlock({ report }: { report: FeatureReport }) {
  const impl = report.implementation;
  const live = report.timeline.find(e => e.live)?.live ?? null;
  const pr = impl.prUrl ? /\/pull\/(\d+)/.exec(impl.prUrl)?.[1] : null;
  return (
    <Section id="report-implementation" data-testid="report-implementation" eyebrow="Implementation" action={<FeatureDrawerLink requestId={report.requestId} drawer="implementation">Details</FeatureDrawerLink>}>
      {impl.latest === null
        ? <p className="text-[15px] text-muted-foreground">{impl.absence}</p>
        : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]" data-testid="report-latest-run">
                <StatusDot tone={DOT_TONE[impl.latest.tone]} label={<span className="font-medium text-foreground">{impl.latest.outcome}</span>} />
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {`Latest run · ${impl.latest.ago}${impl.latest.cents !== null ? ` · ${money(impl.latest.cents)}` : ''}`}
                </span>
                {impl.prUrl && (
                  <a href={impl.prUrl} target="_blank" rel="noreferrer" className="text-[13px] break-all text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
                    {pr ? `Pull request #${pr}` : 'Pull request'}
                  </a>
                )}
                <PreviewOpen recordRef={{ type: 'worker_run', id: String(impl.latest.runId) }} testId="report-view-run">View run</PreviewOpen>
              </div>
              {impl.latest.why && impl.latest.tone !== 'ok' && <p className="max-w-prose text-[13px] leading-relaxed break-words text-muted-foreground">{impl.latest.why}</p>}
              {live && <WatchTheBuild live={live} />}
              {impl.earlier > 0 && (
                <FeatureDrawerLink requestId={report.requestId} drawer="implementation" testId="report-earlier-attempts">
                  {`${impl.earlier} earlier attempt${impl.earlier === 1 ? '' : 's'}`}
                </FeatureDrawerLink>
              )}
            </div>
          )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" data-testid="report-ladder" aria-label="Delivery, step by step">
        {impl.ladder.map(step => (
          <li key={step.key} data-step={step.key} data-state={step.state}>
            <StatusDot
              // "Not released" is a fact, not a failure: only a step that
              // went wrong (a failed run, failed checks, a failed criterion) is red.
              tone={step.state === 'yes' ? 'pass' : step.state === 'no' && step.key !== 'released' ? 'fail' : 'neutral'}
              label={(
                <span className="text-muted-foreground">
                  {`${step.label}: `}
                  <span className="text-foreground">{step.value}</span>
                </span>
              )}
            />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted-foreground tabular-nums" data-testid="report-cost">
        {impl.costLine}
        {' · '}
        <FeatureDrawerLink requestId={report.requestId} drawer="cost">Cost breakdown</FeatureDrawerLink>
      </p>
    </Section>
  );
}

const CRITERION_WORD = { passed: 'Passed', failed: 'Failed', unverified: 'Unverified' } as const;
const CRITERION_TONE: Record<keyof typeof CRITERION_WORD, DotTone> = { passed: 'pass', failed: 'fail', unverified: 'neutral' };

/**
 * ACCEPTANCE — "N of M verified" and the criteria, each Unverified, Passed or
 * Failed. Passed needs evidence; each criterion opens it. The review
 * procedure is one click away.
 * @param props
 * @param props.report - The report.
 */
function AcceptanceBlock({ report }: { report: FeatureReport }) {
  const a = report.acceptance;
  return (
    <Section
      id="report-acceptance"
      data-testid="report-acceptance"
      eyebrow={a.total === 0 ? 'Acceptance' : `Acceptance · ${a.verified} of ${a.total} verified${a.risksLine ? ` · ${a.risksLine}` : ''}`}
      commentField="Acceptance"
      action={<FeatureDrawerLink requestId={report.requestId} drawer="acceptance">{a.procedure ? 'How it is reviewed' : 'Details'}</FeatureDrawerLink>}
    >
      {a.total === 0
        ? <p className="max-w-prose text-[15px] text-muted-foreground">Nothing says what done means for this work yet, so it can be shown to run but not shown to be done.</p>
        : (
            <>
              <CriterionList report={report} items={a.items} offset={0} testId="report-criterion" />
              {a.risks.length > 0 && (
                <>
                  <p className="mt-3 text-[12px] text-muted-foreground" data-testid="report-risks-line">{`Plan risks · ${a.risksLine}`}</p>
                  <CriterionList report={report} items={a.risks} offset={a.items.length} testId="report-risk" />
                </>
              )}
            </>
          )}
    </Section>
  );
}

/**
 * One group of criteria, each opening its drawer. `offset` places the group
 * in the drawer keys: acceptance lines first, then the plan-risk lines.
 * @param props
 * @param props.report - The report.
 * @param props.items - The criteria.
 * @param props.offset - The first drawer index.
 * @param props.testId - The row's test id.
 */
function CriterionList({ report, items, offset, testId }: { report: FeatureReport; items: FeatureReport['acceptance']['items']; offset: number; testId: string }) {
  return (
    <ul className="-mx-2 space-y-0.5">
      {items.map((c, i) => (
        <li key={c.statement}>
          <FeatureDrawerLink requestId={report.requestId} drawer={`criterion-${offset + i}`} look="row" className="flex items-start gap-3 px-2 py-1.5" testId={testId}>
            <span className="w-[5.5rem] shrink-0 pt-px text-[12px]">
              <StatusDot tone={CRITERION_TONE[c.state]} label={<span className={c.state === 'unverified' ? 'text-muted-foreground' : 'text-foreground'}>{CRITERION_WORD[c.state]}</span>} />
            </span>
            <span className="min-w-0 flex-1 text-[15px] leading-relaxed break-words text-foreground">{c.statement}</span>
          </FeatureDrawerLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * RELEASE — Live (with its evidence), Release not verified, or Not released
 * (confirmed: nothing merged). Deployment detail is in the drawer.
 * @param props
 * @param props.report - The report.
 */
function ReleaseBlock({ report }: { report: FeatureReport }) {
  const r = report.release;
  const external = r.href !== null && /^https?:\/\//i.test(r.href);
  return (
    <Section id="report-release" data-testid="report-release" eyebrow="Release" action={<FeatureDrawerLink requestId={report.requestId} drawer="release">Details</FeatureDrawerLink>}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
        <StatusDot tone={r.state === 'live' ? 'pass' : r.state === 'unverified' ? 'amber' : 'neutral'} label={<span className="font-medium text-foreground">{r.label}</span>} />
        <span className="text-[13px] text-muted-foreground">
          {r.state === 'live' && r.at
            ? (
                <>
                  {'since '}
                  <LocalDate at={r.at} />
                </>
              )
            : r.sentence}
        </span>
        {r.href && (
          <a href={r.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className="text-[13px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
            {r.state === 'live' ? 'Open it' : 'Open the record'}
          </a>
        )}
      </p>
    </Section>
  );
}

/**
 * ACTIVITY — the few events worth a glance, newest first. The whole log is
 * "View all activity".
 * @param props
 * @param props.report - The report.
 */
function ActivityBlock({ report }: { report: FeatureReport }) {
  return (
    <Section id="report-activity" data-testid="report-activity" eyebrow="Activity" action={<FeatureDrawerLink requestId={report.requestId} drawer="activity">View all activity</FeatureDrawerLink>}>
      {report.activityPreview.length === 0
        ? <p className="text-[13px] text-muted-foreground">Nothing on this work is dated yet.</p>
        : (
            <ol className="space-y-1.5">
              {report.activityPreview.map(e => (
                <li key={e.key} data-timeline-entry={e.key} className="flex min-w-0 items-baseline gap-3 text-[13px]">
                  <span className="w-24 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{e.ago}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground/90">{e.title}</span>
                </li>
              ))}
            </ol>
          )}
    </Section>
  );
}

/**
 * The same action, stuck to the bottom of a phone screen, only while the work
 * is waiting on a person. Not shown from `sm` up.
 * @param props
 * @param props.report - The report.
 */
function StickyAction({ report }: { report: FeatureReport }) {
  const a = report.status.action;
  if (!report.state.needsYou || a === null || a.kind === 'build') {
    return null;
  }
  const label = (
    <>
      <span className="opacity-80">{report.status.headline}</span>
      <span>{a.label}</span>
    </>
  );
  const look = 'pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-brand-amber px-5 text-sm font-medium text-white shadow-(--shadow-pop)';
  return (
    <div className="pointer-events-none sticky bottom-3 z-30 -mx-1 flex justify-center sm:hidden" data-testid="report-sticky-action">
      {a.kind === 'drawer'
        ? <FeatureDrawerLink requestId={report.requestId} drawer={a.drawer} className={look}>{label}</FeatureDrawerLink>
        : <a href={a.href} className={look}>{label}</a>}
    </div>
  );
}

export function FeatureReportView({ report }: { report: FeatureReport }) {
  const visuals = report.sections.find(x => x.key === 'visuals');
  const today = report.sections.find(x => x.key === 'today');
  // THE BEST REAL PICTURE LEADS: what shipped, then the product today, then a
  // mockup somebody made — the platform's own drawing only when nothing else
  // exists. Before it is built the proposal leads (2026-09-25).
  const drawn = (e: ReportEvidence) => e.role === 'proposed' && e.title === 'Proposed change';
  const landed = report.phase === 'released' || report.phase === 'qa';
  const rank = (e: ReportEvidence) => (e.role === 'shipped' ? 0 : drawn(e) ? 4 : e.role === 'today' ? (landed ? 1 : 3) : 2);
  const ranked = [...(visuals?.evidence ?? []), ...(today?.evidence ?? [])]
    .filter((e, i, all) => e.imageUrl !== null && all.findIndex(x => x.id === e.id) === i)
    .sort((a, b) => rank(a) - rank(b));
  const pictures = ranked.some(p => !drawn(p)) ? ranked.filter(p => !drawn(p)) : ranked;
  const docs = (visuals?.evidence ?? []).filter(e => e.imageUrl === null && e.body !== null);
  return (
    <div className="max-w-4xl space-y-8 overflow-x-hidden">
      {/* One pane for every drawer on this page, and for every peek. */}
      <PreviewPanel />
      {report.timeline.some(e => e.live) && <LiveRefresh everyMs={5000} />}

      {/* 1 + 2. THE INTRODUCTION, THEN WHERE IT IS. The title, subtitle and
          context line are the route's title bar; the story is a short plain
          paragraph, and what it should change for people sits with it. */}
      <div className="space-y-5">
        {(report.story !== null || report.expectedBenefit !== null) && (
          <div id="report-story" className="max-w-prose space-y-2">
            {report.story !== null && (
              <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-p:my-0 prose-p:text-[15px] prose-p:leading-relaxed">
                <Markdown remarkPlugins={[remarkGfm]}>{report.story}</Markdown>
              </div>
            )}
            {report.expectedBenefit !== null && (
              <p className="text-[15px] leading-relaxed text-foreground" data-testid="report-benefit">
                <span className="text-muted-foreground">Expected benefit: </span>
                {report.expectedBenefit}
              </p>
            )}
          </div>
        )}
        <StatusBlock report={report} />
      </div>

      {/* 3. WHAT IT LOOKS LIKE — the gallery, as it was. */}
      <HeroMedia pictures={pictures} docs={docs} />

      {/* 4. CONNECTED WORK — compact; the whole list opens in the pane. */}
      {(report.activity?.length ?? 0) > 0 && <FeatureActivity items={report.activity!} requestId={report.requestId} />}

      {/* 5–9. Each stage in a few lines, the full record one tap away. */}
      <div>
        <PlanBlock report={report} />
        <ImplementationBlock report={report} />
        <AcceptanceBlock report={report} />
        <ReleaseBlock report={report} />
        <ActivityBlock report={report} />
      </div>

      <p className="text-[13px] text-muted-foreground">
        <FeatureDrawerLink requestId={report.requestId} drawer="details">The records behind this page</FeatureDrawerLink>
        {' — the ask as written, triage, the contracts and the approvals.'}
      </p>

      <StickyAction report={report} />
    </div>
  );
}

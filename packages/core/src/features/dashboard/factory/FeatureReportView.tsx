import type { ReactNode } from 'react';
import type { DotTone } from '@/components/patterns';
import type { RecordStatus } from '@/libs/factory/liveStatus';
import type { RelatedItem } from '@/libs/workspace/related';
import type { FeatureReport, LiveBuild, ReportAction, ReportEvidence, ReportNotice, ReportReleaseSummary, ReportStatus, Tone } from '@/services/factory/featureReport';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Related, Section, StatusDot } from '@/components/patterns';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { showsAnError } from '@/libs/factory/mockup';
import { prNumberLabel } from '@/libs/factory/runTitle';
import { liveTopic } from '@/libs/live/topics';
import { featureStatusOf, oneOfEachPicture } from '@/services/factory/featureReport';
import { CheckLiveAgain } from './CheckLiveAgain';
import { FeatureBuild, FeatureHeadline } from './FeatureBuild';
import { FeatureDismiss } from './FeatureDismiss';
import { FeatureDrawerLink } from './FeatureDrawerLink';
import { FeatureTimeline } from './FeatureTimeline';
import { LocalDate } from './LocalDate';
import { MediaCarousel } from './MediaCarousel';
import { WorkStatus } from './WorkStatus';

/**
 * The feature page, drawn for the person who owns the outcome (Chris,
 * 2026-09-28).
 *
 * One column, each section answering one question (Chris, 2026-10-02,
 * FE-370 — the page had two sections called "Activity" and listed its runs
 * in three places):
 *
 *   1. Where is it, and do I need to act? — the title bar, the story, and
 *      Current state (You / Now / Next)
 *   2. What does it look like? — the gallery, intact
 *   3. Did it work? — live, seen live, each criterion with its evidence, the
 *      pull request that shipped and its checks
 *   4. What happened? — the Timeline, newest first: the few newest rows, the
 *      whole list in the side panel (`FeatureTimeline`)
 *   5. What is it connected to? — Related: records only (product, plan,
 *      chat, pull request, release)
 *
 * Each full record is one tap away in the preview pane (`FeatureDrawerLink`
 * → `feature_section:<id>.<key>`).
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
  'reported': 'Reported',
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
 * @param props.mockupStatus
 */
function HeroMedia({ pictures, docs, mockupStatus }: { pictures: ReportEvidence[]; docs: ReportEvidence[]; mockupStatus?: FeatureReport['mockupStatus'] }) {
  // Where the default mockup stands, said where it would be: drawing, or why
  // it drew nothing (`visuals.mockupDraw`).
  // A failure line never stands over pictures of the change: the page is not
  // missing a picture, it has them (Chris, 2026-09-30, #269).
  const status = mockupStatus && (pictures.length === 0 || mockupStatus.tone === 'info')
    ? (
        <p data-testid="report-mockup-status" data-tone={mockupStatus.tone} className={`rounded-lg border border-dashed px-3 py-2 text-sm ${mockupStatus.tone === 'warn' ? 'border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300' : 'border-border text-muted-foreground'}`}>
          {mockupStatus.line}
        </p>
      )
    : null;
  if (pictures.length === 0) {
    return (
      <div id="report-visuals" data-section="visuals" className="space-y-4">
        {docs.length > 0
          ? <Gallery items={docs} />
          : status ?? (
            <p data-testid="report-preview-pending" className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              Preview pending — no mockup or screenshot yet.
            </p>
          )}
        {docs.length > 0 && status}
      </div>
    );
  }
  const word = (e: ReportEvidence) => e.section ?? (e.role === 'today' ? 'Today' : ROLE_WORD[e.role] ?? e.role);
  return (
    <div id="report-visuals" data-section="visuals" className="space-y-4">
      <MediaCarousel slides={pictures.map(p => ({ id: p.id, src: p.imageUrl!, label: word(p), title: p.title, caption: p.caption, source: p.source ?? null }))} />
      {status}
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
 * @param props.end - What closes the line: the record's version chip.
 */
export function ReportContextLine({ bits, end }: { bits: readonly string[]; end?: ReactNode }) {
  if (bits.length === 0 && !end) {
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
      {end && (
        <span className="flex items-center gap-2">
          {bits.length > 0 && <span aria-hidden className="text-border">·</span>}
          {end}
        </span>
      )}
    </p>
  );
}

/**
 * How the feature page re-reads itself, or null when there is nothing to
 * follow and nothing running: when anything the page is made of changes —
 * its tasks, their runs, its cards, asks and evidence — pushed on the live
 * stream, so the Now line and the stage move without a reload or a poll. The
 * record itself is followed by the route's VersionWatch. While the stream is
 * down it polls every 5s, only while something runs. The version chip
 * carries it (`versions/VersionChip`).
 * @param report - The report.
 */
export function reportLiveRefresh(report: Pick<FeatureReport, 'live' | 'timeline' | 'follow' | 'requestId'>): { everyMs: number; follow: string[]; poll: boolean } | null {
  const moving = report.live !== null || report.timeline.some(e => e.live);
  const followed = (report.follow ?? []).filter(t => t !== liveTopic.record(report.requestId));
  return followed.length > 0 || moving ? { everyMs: 5000, follow: followed, poll: moving } : null;
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
        <FeatureBuild requestId={report.requestId} planId={report.planId} label={action.label} pendingRunId={action.runId} disabledReason={action.disabledReason}>{children}</FeatureBuild>
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
        ? buttonVariants({ variant: 'default' })
        : 'inline-flex h-8 items-center rounded-md px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground'}
    >
      {action.label}
    </a>
  );
}

/**
 * WHERE IT IS: the stage, then You, Now, Next (Chris, 2026-09-30: "so I
 * understand when I'm waiting. What's next. What's running."). The same
 * three lines the chat, the preview pane and the Work row draw
 * (`WorkStatus`). The stage keeps its one sentence while nothing runs — what
 * is known and what is not; while something runs, the Now line says it, and
 * opens the run. The move sits on the You line when it is a person's; any
 * other move follows the lines.
 * @param props
 * @param props.report - The report.
 * @param props.status - The three lines, as the page's route read them.
 */
function StatusBlock({ report, status }: { report: FeatureReport; status: RecordStatus }) {
  const s: ReportStatus = report.status;
  const secondary = s.secondary === null
    ? null
    : s.secondary.kind === 'dismiss'
      ? <FeatureDismiss requestId={report.requestId} />
      : s.secondary.kind === 'check_live'
        ? <CheckLiveAgain releaseId={s.secondary.releaseId} label={s.secondary.label} />
        : <ActionButton action={s.secondary} report={report} primary={false} />;
  // The move that IS the running run ("Watch the plan being written") is
  // the Now line already; drawn twice it would be two ways to one place.
  const moveIsLive = s.action?.kind === 'link' && report.live !== null && s.action.href === report.live.runHref;
  const actions = s.action && !moveIsLive
    ? s.action.kind === 'build'
      ? <ActionButton action={s.action} report={report} primary>{secondary}</ActionButton>
      : (
          <>
            <ActionButton action={s.action} report={report} primary />
            {secondary}
          </>
        )
    : null;
  const yours = report.state.needsYou && actions !== null;
  // LIVE'S DATE IS NOT BAKED SERVER-SIDE (2026-10-03, FE-392). `release.sentence`
  // carries no date of its own; here it is spliced onto `LocalDate` — the same
  // component the Timeline uses for its own dates — so this line and the
  // Timeline always read the same calendar day for the same instant, instead
  // of this line's old fixed-UTC stamp disagreeing with the Timeline's
  // reader-zone one across a day boundary.
  const sentence = s.headline === 'Live' && report.release.state === 'live' && report.release.at
    ? (
        <>
          {'Live since '}
          <LocalDate at={report.release.at} />
          {', '}
          {s.sentence}
        </>
      )
    : s.sentence;
  return (
    <section id="report-state" data-testid="report-status" aria-label="Current state" className="space-y-3">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Current state</div>
      {/* While a run of Vocion's carries it, the Now line says it and the
          sentence would repeat it. After the merge the run is GitHub's, and
          the sentence is the part the Now line cannot say: who merged it,
          when, and who is watching until the release lands (#269). */}
      <FeatureHeadline requestId={report.requestId} tone={DOT_TONE[s.tone]} headline={s.headline} sentence={report.live && report.live.kind !== 'deploying' ? '' : sentence} />
      <WorkStatus status={status} hideStage youAction={yours ? <span className="flex flex-wrap items-center gap-2">{actions}</span> : undefined} className="max-w-prose" />
      {!yours && actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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

const CRITERION_WORD = { passed: 'Passed', failed: 'Failed', unverified: 'Unverified' } as const;
const CRITERION_TONE: Record<keyof typeof CRITERION_WORD, DotTone> = { passed: 'pass', failed: 'fail', unverified: 'neutral' };

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
 * "seen live 4 of 4", "partly seen live 2 of 4", "not seen live", "not yet
 * seen live" — what QA saw on the live product, from the release summary.
 * @param seen - The release summary's `seen`.
 */
function seenLive(seen: ReportReleaseSummary['seen']): string | null {
  if (!seen) {
    return null;
  }
  const count = seen.reached !== undefined && seen.total !== undefined && seen.total > 0 ? ` ${seen.reached} of ${seen.total}` : '';
  return seen.state === 'seen' ? `seen live${count}` : seen.state === 'partial' ? `partly seen live${count}` : seen.state === 'not_seen' ? 'not seen live' : 'not yet seen live';
}

/**
 * DID IT WORK? — Acceptance and Release in one (Chris, 2026-10-02, FE-370).
 * One line says whether it is live and whether QA saw it there — "Live since
 * 2 Oct · REL-375 · seen live 4 of 4" — then each criterion with its
 * evidence, then the pull request that shipped and its checks. The checks
 * are the shipped attempt's, never an earlier one's (FE-370 read "Checks
 * passed: Failed" beside "Merged: Yes").
 * @param props
 * @param props.report - The report.
 */
function OutcomeBlock({ report }: { report: FeatureReport }) {
  const r = report.release;
  const a = report.acceptance;
  const impl = report.implementation;
  const attempt = impl.shipped ?? (impl.latest?.prUrl ? impl.latest : null);
  const external = r.href !== null && /^https?:\/\//i.test(r.href);
  // The checks of the attempt that counts — the shipped one — never an earlier attempt's.
  const known = (attempt && (impl.shipped ?? impl.latest)?.runId === attempt.runId ? impl.checks : attempt?.checks ?? []).filter(c => c.passed !== null);
  const failed = known.find(c => c.passed === false);
  const seen = seenLive(r.seen);
  return (
    <Section
      id="report-outcome"
      data-testid="report-outcome"
      eyebrow="Did it work?"
      commentField="Acceptance"
      action={<FeatureDrawerLink requestId={report.requestId} drawer="acceptance">{a.procedure ? 'How it is reviewed' : 'Details'}</FeatureDrawerLink>}
    >
      {/* Where the old sections' links land (`#report-release`, `#report-acceptance`). */}
      <p id="report-release" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]" data-testid="report-outcome-line">
        <StatusDot
          tone={r.state === 'live' ? (r.seen?.state === 'seen' ? 'pass' : r.seen?.state === 'not_seen' ? 'fail' : 'amber') : r.state === 'unverified' ? 'amber' : 'neutral'}
          label={(
            <span className="font-medium text-foreground">
              {r.state === 'live' && r.at
                ? (
                    <>
                      {'Live since '}
                      <LocalDate at={r.at} />
                    </>
                  )
                : r.state === 'not_released' ? 'Not live yet' : r.label}
            </span>
          )}
        />
        {r.state === 'live' && r.code && (
          <FeatureDrawerLink requestId={report.requestId} drawer="release" look="link" className="text-[13px]">{r.code}</FeatureDrawerLink>
        )}
        {r.state === 'live' && seen && <span className="text-[13px] text-muted-foreground">{seen}</span>}
        {r.href && r.state === 'live' && (
          <a href={r.href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className="text-[13px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">Open it</a>
        )}
      </p>
      {r.state !== 'live' && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">{r.sentence}</p>}

      <div id="report-acceptance" className="mt-4">
        <p className="text-[12px] text-muted-foreground" data-testid="report-acceptance-count">
          {a.total === 0 ? 'No acceptance criteria yet' : `${a.verified} of ${a.total} criteria verified${a.risksLine ? ` · ${a.risksLine}` : ''}`}
        </p>
        {a.total === 0
          ? <p className="mt-1 max-w-prose text-[15px] text-muted-foreground">Nothing says what done means for this work yet, so it can be shown to run but not shown to be done.</p>
          : (
              <div className="mt-1">
                <CriterionList report={report} items={a.items} offset={0} testId="report-criterion" />
                {a.risks.length > 0 && (
                  <>
                    <p className="mt-3 text-[12px] text-muted-foreground" data-testid="report-risks-line">{`Plan risks · ${a.risksLine}`}</p>
                    <CriterionList report={report} items={a.risks} offset={a.items.length} testId="report-risk" />
                  </>
                )}
              </div>
            )}
      </div>

      {attempt?.prUrl && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground" data-testid="report-shipped-pr">
          <a href={attempt.prUrl} target="_blank" rel="noreferrer" className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">
            {prNumberLabel(attempt.prUrl) ?? 'Pull request'}
          </a>
          {known.length > 0 && <span>{failed ? `· ${known.filter(c => c.passed).length}/${known.length} checks, \`${failed.name.replace(/^npm run /, '')}\` failed` : `· ${known.length}/${known.length} checks`}</span>}
          <span>{`· attempt ${attempt.n} of ${Math.max(impl.attempts.length, attempt.n)}`}</span>
          {impl.merged && impl.shipped && <span>· merged</span>}
        </p>
      )}
    </Section>
  );
}

/**
 * TIMELINE — what happened, newest first: the few newest rows here, the
 * whole list in the side panel (`FeatureTimeline`). While a build runs, what
 * it is doing and the tail of its log sit above the rows.
 * @param props
 * @param props.report - The report.
 */
function TimelineBlock({ report }: { report: FeatureReport }) {
  const live = report.timeline.find(e => e.live)?.live ?? null;
  return (
    <Section id="report-timeline" data-testid="report-timeline" eyebrow="Timeline">
      {live && <WatchTheBuild live={live} />}
      {/* Where the old links to the runs and the plan land. */}
      <div id="report-runs" className={live ? 'mt-3' : undefined}>
        <span id="report-plan" aria-hidden />
        <FeatureTimeline rows={report.history} cost={report.historyCost} density="compact" requestId={report.requestId} />
      </div>
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

/**
 * @param props
 * @param props.report - The assembled report.
 * @param props.status - Its three lines as the route read them (the record's own page href). Absent, read off the report here.
 * @param props.related
 */
export function FeatureReportView({ report, status, related = [] }: { report: FeatureReport; status?: RecordStatus; related?: readonly RelatedItem[] }) {
  const lines = status ?? featureStatusOf(report, { objectType: '', href: '' }, new Date());
  const visuals = report.sections.find(x => x.key === 'visuals');
  const today = report.sections.find(x => x.key === 'today');
  const qa = report.sections.find(x => x.key === 'qa');
  // THE BEST REAL PICTURE LEADS: what shipped, then QA's shot of the change,
  // then the product today, then a mockup somebody made — the platform's own
  // drawing only when nothing else exists. Before it is built the proposal
  // leads (2026-09-25). QA's before-shots follow the rest: the screen today
  // already says what they say.
  const drawn = (e: ReportEvidence) => e.role === 'proposed' && e.title === 'Proposed change';
  const landed = report.phase === 'released' || report.phase === 'qa';
  const rank = (e: ReportEvidence) => (e.role === 'shipped' ? 0 : drawn(e) ? 6 : e.section === 'QA after' ? 1 : e.section === 'QA before' ? 5 : e.role === 'today' ? (landed ? 2 : 4) : 3);
  // A capture QA itself named as the app's error state stays in the QA
  // record; it is not a picture of the change.
  const qaPictures = (qa?.evidence ?? []).filter(e => e.role === 'qa-screenshot' && !showsAnError({ title: e.title, spec: { caption: e.caption } }));
  // One slide per picture: the same artifact through two sections, or the
  // same image filed twice, is drawn once — the best-ranked (`oneOfEachPicture`).
  const ranked = oneOfEachPicture([...(visuals?.evidence ?? []), ...(today?.evidence ?? []), ...qaPictures]
    .filter(e => e.imageUrl !== null)
    .sort((a, b) => rank(a) - rank(b)));
  const pictures = ranked.some(p => !drawn(p)) ? ranked.filter(p => !drawn(p)) : ranked;
  const docs = (visuals?.evidence ?? []).filter(e => e.imageUrl === null && e.body !== null);
  return (
    <div className="max-w-4xl space-y-8 overflow-x-hidden">
      {/* One pane for every drawer on this page, and for every peek. */}
      <PreviewPanel />
      {/* The re-read — pushed on the live stream for what the page is made
          of, polled every 5s while it is down and something runs — rides the
          version chip in the title's metadata line (`reportLiveRefresh`). */}

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
        <StatusBlock report={report} status={lines} />
      </div>

      {/* 3. WHAT IT LOOKS LIKE — the gallery, as it was. */}
      <HeroMedia pictures={pictures} docs={docs} mockupStatus={report.mockupStatus} />

      {/* 3. DID IT WORK? 4. TIMELINE — one question each. */}
      <div>
        <OutcomeBlock report={report} />
        <TimelineBlock report={report} />
      </div>

      {/* 5. RELATED — the records it is connected to: the chat that started
          it, its product, plan, pull requests and releases (`relatedOf`).
          Its runs and tasks are the Timeline. */}
      {related.length > 0 && (
        <section id="report-related" aria-labelledby="report-related-heading" data-testid="feature-related">
          <h2 id="report-related-heading" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Related</h2>
          <Related items={related} className="mt-1" />
        </section>
      )}

      <p className="text-[13px] text-muted-foreground">
        <FeatureDrawerLink requestId={report.requestId} drawer="details">The records behind this page</FeatureDrawerLink>
        {' — the ask as written, triage, the contracts and the approvals.'}
      </p>

      <StickyAction report={report} />
    </div>
  );
}

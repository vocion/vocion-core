import type { FeatureReport, LifecycleStep, LiveBuild, ReportAcceptance, ReportCheck, ReportEntry, ReportEvidence, ReportFact, ReportPhase, ReportSection, ReportState, Tone } from '@/services/factory/featureReport';
import type { Status } from '@/types/Status';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StatusPill } from '@/components/ui/status-pill';
import { LiveRefresh } from '@/features/dashboard/LiveRefresh';
import { formatStamp, money } from '@/services/factory/featureReport';
import { DecisionCard } from './DecisionCard';

/**
 * The feature report, drawn — one request's whole story in one column.
 *
 * A summary strip, then a vertical timeline with the newest entry LAST, then
 * the nine sections in reading order. Everything is a server-renderable
 * function of the assembled report (`services/factory/featureReport.ts`);
 * nothing here queries, formats money twice, or decides what happened.
 *
 * It reads at 390px because that is where a person checks on a feature: one
 * column throughout, the timeline's rule and dots inside a 20px gutter, every
 * long value (a pull request URL, a branch, a file path) allowed to break
 * rather than widen the page. There is no horizontal scroll on this page at
 * any width — a fact `FeatureReportView.layout.test.tsx` measures.
 */

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-[var(--brand-pass)]',
  warn: 'text-[var(--brand-borderline)]',
  bad: 'text-[var(--brand-fail)]',
  info: 'text-foreground',
  muted: 'text-muted-foreground',
};

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-[var(--brand-pass)]',
  warn: 'bg-[var(--brand-borderline)]',
  bad: 'bg-[var(--brand-fail)]',
  info: 'bg-foreground/60',
  muted: 'bg-muted-foreground/40',
};

/**
 * A report tone as the shared status pill's vocabulary.
 * @param tone - The report tone.
 */
function pillStatus(tone: Tone): Status {
  switch (tone) {
    case 'ok':
      return 'completed';
    case 'warn':
      return 'pending';
    case 'bad':
      return 'failed';
    case 'info':
      return 'running';
    default:
      return 'inactive';
  }
}

/**
 * One labelled value. A null value is not hidden — it says the record does
 * not carry it, because a missing field is a finding too.
 * @param props - The fact.
 * @param props.fact - The fact to draw.
 */
function Fact({ fact }: { fact: ReportFact }) {
  const value = fact.value;
  // A long passage is prose, not an aside. It used to be set in italics, which
  // is legible for a phrase and a wall at four paragraphs — the plan's own
  // approach is four paragraphs. It reads as prose now, held by a quiet rule.
  const body = value === null
    ? <span className="text-muted-foreground">not recorded</span>
    : fact.href
      ? <a href={fact.href} target="_blank" rel="noreferrer" className="break-words underline underline-offset-2">{value}</a>
      : fact.format === 'quote'
        ? <span className="block border-l-2 border-border pl-3 leading-relaxed whitespace-pre-line">{value}</span>
        : <span className={fact.format === 'mono' || fact.format === 'money' ? 'font-mono break-words tabular-nums' : 'break-words'}>{value}</span>;
  // TWO SHAPES, decided by what the value is.
  //
  // A passage takes the full width with its label above it: 7.5rem of label
  // beside a wrapping paragraph gave the paragraph a third of a phone screen
  // and broke every sentence into a column. A figure does NOT — stacking
  // "$9.00" under its own label turned the money section into six rows of
  // mostly air, which is the opposite of the problem being fixed.
  // A URL is not a figure: it is long, it wraps, and beside a 7.5rem label it
  // gets a third of a phone screen. It stacks like prose.
  const prose = fact.format === 'quote' || fact.href !== undefined;
  return (
    <div className={`gap-x-4 gap-y-0.5 py-2 text-[15px] ${prose ? 'block' : 'grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)]'}`}>
      <dt className={`text-xs text-muted-foreground ${prose ? 'mb-1.5' : 'leading-6'}`}>{fact.label}</dt>
      <dd className="min-w-0 leading-relaxed">{body}</dd>
    </div>
  );
}

/**
 * A run's or a pull request's checks — the name, and whether it passed.
 * "Not run" is its own state and never reads as a pass.
 * @param props - The checks.
 * @param props.checks - The list.
 */
function Checks({ checks }: { checks: ReportCheck[] }) {
  if (checks.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {checks.map(c => (
        <li key={c.name} className="flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-xs">
          <span className={`inline-block size-1.5 shrink-0 rounded-full ${c.passed === true ? TONE_DOT.ok : c.passed === false ? TONE_DOT.bad : TONE_DOT.muted}`} />
          <span className="font-mono break-all">{c.name}</span>
          <span className="text-muted-foreground">{c.passed === true ? 'passed' : c.passed === false ? 'failed' : 'not run'}</span>
          {c.detail && <span className="text-muted-foreground">{c.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * A block inside a section — a task contract, an approval, a run, a pull
 * request, a release.
 * @param props - The entry.
 * @param props.entry - The entry to draw.
 */
function Entry({ entry }: { entry: ReportEntry }) {
  return (
    <article className="border-t border-border/60 py-5 first:border-t-0 first:pt-0">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="min-w-0 text-sm font-medium break-words">{entry.title}</h4>
        {entry.status && <StatusPill status={pillStatus(entry.tone)} label={entry.status} size="sm" />}
        <span className="ml-auto font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {formatStamp(entry.at)}
          {entry.cents !== null && ` · ${money(entry.cents)}`}
        </span>
      </header>
      {entry.steps !== undefined && entry.steps.length > 0 && (
        // THE PLAN AS A PERSON APPROVES IT: numbered, in order, one line each.
        // The reasoning that produced it sits behind the disclosure below —
        // excellent, and not the thing anybody says yes to.
        <ol className="mt-3 max-w-prose space-y-2">
          {entry.steps.map((step, i) => (
            <li key={step} className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-x-2 text-[15px] leading-relaxed">
              <span className="pt-px font-mono text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {entry.facts.length > 0 && (
        <dl className="mt-3">
          {entry.facts.map(f => <Fact key={f.label} fact={f} />)}
        </dl>
      )}
      <Checks checks={entry.checks} />
      {entry.detailFacts !== undefined && entry.detailFacts.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">Why this plan</summary>
          <dl className="mt-2">
            {entry.detailFacts.map(f => <Fact key={f.label} fact={f} />)}
          </dl>
        </details>
      )}
      {entry.flags.map(flag => (
        <p key={flag} className="mt-2 rounded border border-[var(--brand-fail)]/40 bg-[var(--brand-fail-bg)] px-2.5 py-1.5 text-xs text-[var(--brand-fail)]">{flag}</p>
      ))}
    </article>
  );
}

/**
 * The QA gallery. Every artifact with a caption under it; a screenshot draws
 * itself, a video or a report is a link that says what it is.
 * @param props - The evidence.
 * @param props.items - The artifacts.
 */
/** What the tile says when there is no picture to draw — the artifact's own kind, not "report". */
/** What this evidence is FOR, in the reader's words rather than the field's. */
const ROLE_WORD: Record<string, string> = {
  'proposed': 'Proposed',
  'shipped': 'After',
  'qa-screenshot': 'Screenshot',
  'qa-video': 'Video',
  'qa-report': 'Report',
};

/**
 * SHOW THE THING.
 *
 * This drew a grey square labelled "a document" over every mockup, flow and
 * diagram filed against a work item — a caption where a picture was meant to
 * be, and as useless as the empty field it replaced. Chris, 2026-09-22,
 * looking at two of them: *"Still no screenshots for before, mock or diagrams
 * visible."*
 *
 * So: a picture is drawn, a document is rendered where it sits, and only a
 * link out — the one thing a page genuinely cannot inline — stays a card to
 * open.
 * @param props
 * @param props.items - The evidence to draw.
 */
function Gallery({ items }: { items: ReportEvidence[] }) {
  return (
    // ONE PER ROW. A mockup is the thing a decision is made against, and two
    // to a row on a laptop halves the only part of the page that has to be
    // looked at rather than read. The caption sits under it like a figure's,
    // not as a header competing with the image above it.
    <ul className="mt-3 space-y-6">
      {items.map(item => (
        <li key={item.id} className="min-w-0">
          {(item.imageUrl !== null || item.body !== null) && (
            <figure className={`m-0 overflow-hidden rounded-xl border bg-surface-soft ${item.role === 'proposed' ? 'border-dashed border-border' : 'border-border'}`}>
              {item.imageUrl !== null && (
              // A desktop mockup at 430px is a thumbnail — the one thing on
              // this page that has to be LOOKED at, and at phone width you
              // cannot read a word of it. So the picture opens the picture,
              // full size. It used to open `item.url`, the artifact's own
              // record page, which is exactly what the "Open" link in the
              // caption below it already does: two tap targets, one outcome,
              // and no way at all to enlarge the mockup.
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
 * One section. A stage that did not happen keeps its heading and says what
 * is absent, because the absence is the finding.
 * @param props - The section.
 * @param props.section - The section to draw.
 */
function Section({ section }: { section: ReportSection }) {
  return (
    <section id={`report-${section.key}`} data-section={section.key} className="border-t border-border/60 pt-8">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{section.title}</h3>
      {section.absence
        ? <p data-absence className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">{section.absence}</p>
        : (
            <>
              {section.facts.length > 0 && <dl>{section.facts.map(f => <Fact key={f.label} fact={f} />)}</dl>}
              {section.entries.length > 0 && <div className="mt-3">{section.entries.map(e => <Entry key={e.key} entry={e} />)}</div>}
              {section.lists.map(l => (
                <div key={l.label} className="mt-5">
                  <p className="text-xs text-muted-foreground">{l.label}</p>
                  <ul className="mt-1.5 max-w-prose list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed">
                    {l.items.map(item => <li key={item} className="break-words">{item}</li>)}
                  </ul>
                </div>
              ))}
              {section.evidence.length > 0 && <Gallery items={section.evidence} />}
              {section.detailLists.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
                    {section.key === 'plan' ? 'Interfaces, risks and what was rejected' : 'More'}
                  </summary>
                  {section.detailLists.map(l => (
                    <div key={l.label} className="mt-4">
                      <p className="text-xs text-muted-foreground">{l.label}</p>
                      <ul className="mt-1.5 max-w-prose list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed">
                        {l.items.map(item => <li key={item} className="break-words">{item}</li>)}
                      </ul>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
      {section.flags.map(flag => (
        <p key={flag} className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted-foreground">{flag}</p>
      ))}
    </section>
  );
}

/**
 * THE STORY — the change as the person who will use it would tell it.
 *
 * Between the mock and the plan on purpose: a reader has just seen what it
 * will look like and has not yet been asked to judge how it will be built.
 * This is the part that says why anybody wants it, which neither the mock nor
 * the criteria ever say.
 * @param props
 * @param props.story - The story, as markdown.
 */
function Story({ story }: { story: string }) {
  return (
    <section id="report-story" className="border-t border-border/60 pt-8">
      <h3 className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">The story</h3>
      <div className="prose prose-sm max-w-prose text-foreground dark:prose-invert prose-p:text-[15px] prose-p:leading-relaxed prose-li:text-[15px]">
        <Markdown remarkPlugins={[remarkGfm]}>{story}</Markdown>
      </div>
    </section>
  );
}

/**
 * WHERE THIS IS, in four dots.
 *
 * It replaces four whole sections that each said nothing had happened yet:
 * Build, The change, QA, Release, on work nobody had started. A person
 * approving a plan already knows none of that has run — being told four times
 * in four headings is, in Chris's words, "technically transparent but visually
 * exhausting".
 * @param props
 * @param props.steps - The four steps and where the work has got to.
 */
/**
 * The stage, one line on a phone: dots and the current step's name, with
 * "your decision next" when a person holds it. The full labelled strip below
 * wrapped into two rows at 390px and orphaned "QA → Released" (Chris,
 * 2026-09-24).
 * @param props
 * @param props.steps - The lifecycle.
 * @param props.needsYou - Whether a person is the one holding it up.
 */
function LifecycleDots({ steps, needsYou }: { steps: LifecycleStep[]; needsYou: boolean }) {
  const nowIndex = steps.findIndex(s => s.state === 'now');
  const current = steps[nowIndex] ?? steps.find(s => s.state === 'todo') ?? steps[steps.length - 1];
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground sm:hidden" aria-label="Where this work has got to" data-testid="lifecycle-dots">
      <span className="flex items-center gap-1" aria-hidden>
        {steps.map(step => (
          <span key={step.key} className={`inline-block size-1.5 rounded-full ${step.state === 'done' ? 'bg-brand-ok' : step.state === 'now' ? 'bg-brand-amber' : 'bg-border'}`} />
        ))}
      </span>
      <span>
        <span className="font-medium text-foreground">{current?.label}</span>
        {' · '}
        {(nowIndex >= 0 ? nowIndex : 0) + 1}
        {' of '}
        {steps.length}
        {needsYou && <span className="text-brand-amber-deep"> · your decision next</span>}
      </span>
    </div>
  );
}

function Lifecycle({ steps }: { steps: LifecycleStep[] }) {
  return (
    <ol className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex" aria-label="Where this work has got to">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-2">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block size-1.5 rounded-full ${step.state === 'done' ? 'bg-brand-ok' : step.state === 'now' ? 'bg-brand-amber' : 'bg-border'}`}
            />
            <span className={step.state === 'now' ? 'font-medium text-foreground' : undefined}>{step.label}</span>
            {step.state === 'now' && <span className="sr-only">(now)</span>}
          </span>
          {i < steps.length - 1 && <span aria-hidden className="text-border">→</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Which sections LEAD in each phase. Everything else is still rendered when it
 * has something to say, and silently dropped when all it would say is that it
 * has not happened.
 */
const PHASE_LEADS: Record<ReportPhase, readonly string[]> = {
  asked: ['visuals', 'today', 'result', 'plan'],
  decided: ['visuals', 'today', 'result', 'plan'],
  planned: ['plan', 'contract', 'visuals', 'result'],
  building: ['runs', 'plan'],
  qa: ['qa', 'change', 'visuals'],
  released: ['result', 'release', 'qa'],
};

/**
 * Should this section be on the page at all?
 *
 * A section with content always earns its place. A section whose only content
 * is an absence earns it only while it is the thing being decided — so
 * "nothing has been built yet" is worth saying to somebody watching a build
 * stall, and is noise to somebody approving a plan.
 * @param section - The section.
 * @param phase - The phase the page is in.
 */
function showsOnPage(section: ReportSection, phase: ReportPhase): boolean {
  if (section.group !== 'story') {
    return false;
  }
  if (section.absence === null) {
    return true;
  }
  return PHASE_LEADS[phase].includes(section.key);
}

/**
 * WHERE THIS WORK IS, at the top, and what it wants from you.
 *
 * The page used to open with a paragraph describing the database and bury the
 * live blocker several screens down; a person could scroll for a while without
 * learning what to do. State first, the question verbatim, the one action —
 * and on a phone the same action again, stuck to the bottom of the screen, so
 * it is reachable from wherever the reading got to.
 * @param props
 * @param props.state - The derived state.
 */
function StateHeader({ state }: { state: ReportState }) {
  const tone = state.needsYou
    ? 'border-brand-amber/50 bg-brand-amber-tint'
    : 'border-border bg-surface-soft';
  return (
    <section id="report-state" className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`text-[11px] font-semibold tracking-[0.06em] uppercase ${state.needsYou ? 'text-brand-amber-deep' : 'text-muted-foreground'}`}>
          {state.label}
        </span>
        <span className="text-xs text-muted-foreground">{state.detail}</span>
      </div>
      {state.question !== null && (
        <p className="mt-2 text-sm font-medium break-words text-foreground">{state.question}</p>
      )}
      {state.action !== null && (
        <a
          href={state.action.href}
          data-testid="report-primary-action"
          className="mt-2 inline-flex h-9 items-center rounded-md bg-brand-amber px-3 text-[13px] font-medium text-white transition-colors hover:bg-brand-amber-deep"
        >
          {state.action.label}
        </a>
      )}
    </section>
  );
}

/**
 * The same action, stuck to the bottom of a phone screen, only while the work
 * is actually waiting on a person. It is not shown from `sm` up, where the
 * header above is never more than a scroll away.
 * @param props
 * @param props.state - The derived state.
 */
function StickyAction({ state }: { state: ReportState }) {
  if (!state.needsYou || state.action === null) {
    return null;
  }
  return (
    <div className="pointer-events-none sticky bottom-3 z-30 -mx-1 flex justify-center sm:hidden">
      <a
        href={state.action.href}
        data-testid="report-sticky-action"
        className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-brand-amber px-5 text-sm font-medium text-white shadow-(--shadow-pop)"
      >
        <span className="opacity-80">{state.label}</span>
        <span>{state.action.label}</span>
      </a>
    </div>
  );
}

/**
 * DONE WHEN — the contract, high on the page.
 *
 * This is what a person is looking at when they ask how close it is, and it
 * used to be several screens down inside the per-task contracts, drawn once
 * per attempt. Unchecked is drawn as unchecked, never as failed: nobody has
 * looked is a different fact from it does not hold, and collapsing the two is
 * how a page starts lying about a contract.
 * @param props
 * @param props.acceptance - The criteria and the count.
 */
function DoneWhen({ acceptance }: { acceptance: ReportAcceptance }) {
  if (acceptance.total === 0) {
    return (
      <section id="report-acceptance" className="rounded-lg border border-dashed border-border p-3">
        <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Done when</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Nothing says what done means for this work. Until somebody writes it, there is no way to tell whether it was delivered — only whether it ran.
        </p>
      </section>
    );
  }
  return (
    <section id="report-acceptance" className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Done when</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {acceptance.met}
          {' of '}
          {acceptance.total}
          {acceptance.frozenAt === null ? ' · still a draft' : ''}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {acceptance.items.map(item => (
          <li key={item.statement} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden
              className={`mt-[3px] inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none ${
                item.met === true
                  ? 'border-brand-ok bg-brand-ok text-white'
                  : 'border-border text-transparent'
              }`}
            >
              ✓
            </span>
            <span className={`min-w-0 break-words ${item.met === true ? 'text-muted-foreground' : 'text-foreground'}`}>
              {item.statement}
              {/* The empty circle already says it. Seven repetitions of "not
                  checked" wrapped every row onto two lines on a phone; the
                  words stay for a screen reader, which has no circle. */}
              {item.met === null && <span className="ml-1.5 hidden text-xs text-muted-foreground sm:inline">not checked</span>}
              {item.met === null && <span className="sr-only">not checked</span>}
              {item.evidenceUrl !== null && (
                <a href={item.evidenceUrl} className="ml-1.5 text-xs text-muted-foreground underline hover:text-foreground">evidence</a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Six figures across the top: asked, shipped, elapsed, what it cost, how
 * many times a person decided, how many attempts it took.
 * @param props - The report.
 * @param props.report - The assembled report.
 */
function SummaryStrip({ report }: { report: FeatureReport }) {
  const s = report.summary;
  const cells: Array<[string, string]> = [
    ['Asked', s.askedAt ? formatStamp(s.askedAt) : 'not recorded'],
    ['Shipped', s.shippedAt ? formatStamp(s.shippedAt) : 'nothing has shipped'],
    ['Elapsed', s.elapsed === null ? 'not measurable' : s.elapsedOpen ? `${s.elapsed} so far` : s.elapsed],
    ['Total cost', money(s.totalCents)],
    // `null` means no record is linked, which the assembly refuses to render
    // as a zero — the contradictions block above says why.
    ['Human decisions', s.humanDecisions === null ? 'not linked' : String(s.humanDecisions)],
    ['Attempts', s.attempts === null ? 'not linked' : String(s.attempts)],
  ];
  return (
    <dl id="report-summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
      {cells.map(([label, value]) => (
        <div key={label} className="min-w-0 bg-background p-3">
          <dd className="font-mono text-sm font-semibold break-words tabular-nums">{value}</dd>
          <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

/**
 * The timeline: oldest first, newest last, each entry stamped with its time
 * and, where money was spent, its cost.
 * @param props - The report.
 * @param props.report - The assembled report.
 */
/**
 * WATCH THE BUILD (backlog 007): the step the worker is on, how long it has
 * run, how long since it last spoke, and the tail of what it printed — from
 * the run's own heartbeat, re-read every five seconds while any run is live.
 * A build that has gone quiet says so in words; nothing here is an animation.
 * @param props - The live view.
 * @param props.live - What the run last reported.
 */
function WatchTheBuild({ live }: { live: LiveBuild }) {
  const since = live.sinceSec === null ? null : duration(live.sinceSec);
  const quiet = live.quietSec !== null && live.quietSec > 90 ? `quiet for ${duration(live.quietSec)}` : null;
  return (
    <div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2.5" data-testid="watch-the-build">
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

function Timeline({ report }: { report: FeatureReport }) {
  if (report.timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing on this request is dated, so there is no order to show.</p>;
  }
  return (
    <ol id="report-timeline" className="relative ml-1.5 border-l border-border pl-4">
      {report.timeline.some(e => e.live) && <LiveRefresh everyMs={5000} />}
      {report.timeline.map(entry => (
        <li key={entry.key} data-timeline-entry={entry.key} className="relative pb-4 last:pb-0">
          <span className={`absolute top-1.5 left-[-1.3125rem] size-2 rounded-full ring-2 ring-background ${TONE_DOT[entry.tone]}`} />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{formatStamp(entry.at)}</span>
            {entry.cents !== null && (
              <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">{money(entry.cents)}</span>
            )}
          </div>
          <p className={`text-sm break-words ${TONE_TEXT[entry.tone]}`}>
            {entry.href
              ? <a href={entry.href} className="break-all underline underline-offset-2">{entry.title}</a>
              : entry.title}
          </p>
          {entry.detail && <p className="mt-0.5 line-clamp-3 text-xs break-words text-muted-foreground">{entry.detail}</p>}
          {entry.live && <WatchTheBuild live={entry.live} />}
        </li>
      ))}
    </ol>
  );
}

/**
 * WHICH WORK THIS IS — product, size, spend, age. The breadcrumb names the
 * factory and a row id; neither of those is the product a person means.
 *
 * It renders inside the title block, under the goal, because that is where it
 * belongs and because the alternative bit us: as the first child of the report
 * column it needed a negative top margin to sit close to the title, and that
 * column is a scroll container (`overflow-x-hidden` beside the shell's
 * `overflow-y: auto`). A scrollport does not extend above its own top edge, so
 * `-mt-4` put the line 16px above the origin and the browser clipped all but
 * its bottom 3px. Production rendered two grey specks — the descenders of
 * "change" and "ago" — while `getBoundingClientRect` still reported a full
 * 398x19 box. Layout said it was there; paint said it was not.
 * Chris, 2026-09-23.
 * @param props - The context bits.
 * @param props.bits - Short facts, in reading order.
 */
export function ReportContextLine({ bits }: { bits: readonly string[] }) {
  if (bits.length === 0) {
    return null;
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
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
 * The whole page body.
 * @param props - The report.
 * @param props.report - The assembled report.
 */
export function FeatureReportView({ report }: { report: FeatureReport }) {
  return (
    <div className="max-w-4xl space-y-8 overflow-x-hidden">
      {/* ABOVE THE FOLD ON A PHONE: the decision, decidable; where it stands,
          one line; the picture. On a desk the picture sits beside them. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
        {report.hero?.imageUrl && (
          <a href="#report-visuals" className="order-3 block w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:order-1 sm:w-64" data-testid="report-hero">
            <img src={report.hero.imageUrl} alt={report.hero.role === 'after' ? 'How it looks now' : 'The proposed change'} className="aspect-[8/5] w-full object-cover object-top" loading="eager" />
          </a>
        )}
        <div className="order-1 min-w-0 flex-1 space-y-3 sm:order-2">
          {report.state.decision ? <DecisionCard state={report.state} /> : <StateHeader state={report.state} />}
          <LifecycleDots steps={report.lifecycle} needsYou={report.state.needsYou} />
          <Lifecycle steps={report.lifecycle} />
        </div>
      </div>

      {report.contradictions.length > 0 && (
        <section id="report-contradictions" className="rounded-lg border border-[var(--brand-fail)]/40 bg-[var(--brand-fail-bg)] p-3">
          <h2 className="text-[11px] font-semibold tracking-[0.06em] text-[var(--brand-fail)] uppercase">The records disagree</h2>
          <ul className="mt-1.5 space-y-1 text-sm text-[var(--brand-fail)]">
            {report.contradictions.map(c => <li key={c} className="break-words">{c}</li>)}
          </ul>
          <p className="mt-1.5 text-xs text-[var(--brand-fail)]/80">Both facts are shown as recorded. Nothing here was resolved for you.</p>
        </section>
      )}

      {/* THE STORY, in the order a person follows it: what we are going to
          make, what was built, the evidence, what remains, what it cost. The
          machinery that produced it — the original ask, the triage figures,
          the per-task contracts, the approval records — is all still here,
          one level down, where it is traceable without being in the way. */}
      {/* THE ORDER A PERSON READS IT IN (Chris, 2026-09-23): the outcome, then
          the mock, then the story, then where to go and see how it works
          today, then the plan and what counts as done. The mock comes before
          the prose because it answers the question the prose is about. */}
      <div className="space-y-8">
        {report.sections.filter(x => showsOnPage(x, report.phase) && x.key === 'visuals').map(section => <Section key={section.key} section={section} />)}
        {report.story !== null && <Story story={report.story} />}
        {report.sections.filter(x => showsOnPage(x, report.phase) && x.key !== 'visuals').map(section => <Section key={section.key} section={section} />)}
      </div>

      {/* WHAT COUNTS AS DONE, under the proposal rather than above it: it is
          the last thing read before approving, not the first. */}
      <DoneWhen acceptance={report.acceptance} />

      {/* HISTORY, at the bottom. The timeline is genuinely useful and it was
          the second thing on the page, which made the database the
          protagonist. The work is the protagonist; this is what happened to
          it, for a reader who has got that far and wants it. */}
      {/* HISTORY behind a tap. Good audit data, and nobody approving a plan
          needs to scroll a timestamped event stream to understand a feature. */}
      <details className="border-t border-border/60 pt-6">
        <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
          History
          <span className="ml-2 text-xs">
            {report.timeline.length}
            {report.timeline.length === 1 ? ' event' : ' events'}
          </span>
        </summary>
        <div className="mt-4">
          <Timeline report={report} />
        </div>
      </details>

      {report.sections.some(x => x.group === 'detail') && (
        <details id="report-technical" className="border-t border-border/60 pt-6">
          <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
            Details
            <span className="ml-2 text-xs">the ask as written, triage, the contracts, the approvals, the figures</span>
          </summary>
          <div className="mt-4 space-y-8">
            {report.sections.filter(x => x.group === 'detail' || !showsOnPage(x, report.phase)).map(section => <Section key={section.key} section={section} />)}
            <SummaryStrip report={report} />
          </div>
        </details>
      )}

      <StickyAction state={report.state} />

      <p className="text-xs text-muted-foreground">
        Every figure on this page is read off a record.
        {' '}
        {report.summary.elapsedOpen
          ? 'Elapsed is measured to now, because nothing has shipped.'
          : 'Elapsed is measured from when it was asked to when it shipped.'}
      </p>
    </div>
  );
}

import type { CaseSide, Delta, ModelUpgradeComparison, RunSide } from '@/services/evals/modelUpgradeTest';
import { ArrowLeft, CheckCircle2, GitCompareArrows, MinusCircle, OctagonAlert, TriangleAlert, XCircle } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getComparison, pct, usd } from '@/services/evals/modelUpgradeTest';

/**
 * `/dashboard/evals/[slug]/compare?baseline=<runId>&candidate=<runId>` — two
 * runs of one dataset, side by side, read on the three questions of a model
 * upgrade: what it finishes, where it stops needing a retry or a person, and
 * what a finished piece of work costs. Any two runs of the dataset can be
 * compared here after the fact; the "Compare models" form lands here with
 * the pair it just produced.
 *
 * Numbers wear text tokens; verdicts carry an icon and a word, never colour
 * alone. No chart — seven paired figures and a table are the honest form for
 * two runs of a dozen cases.
 * @param props - Route props.
 * @param props.params - Locale and dataset slug.
 * @param props.searchParams - `baseline` and `candidate` run ids.
 */
export default async function EvalComparePage(props: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ baseline?: string; candidate?: string }>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const sp = await props.searchParams;
  const baselineId = Number.parseInt(sp.baseline ?? '', 10);
  const candidateId = Number.parseInt(sp.candidate ?? '', 10);
  if (!Number.isFinite(baselineId) || !Number.isFinite(candidateId)) {
    notFound();
  }
  const c = await getComparison(orgId, slug, baselineId, candidateId);
  if (!c) {
    notFound();
  }

  const changed = c.cases.filter(x => x.flip !== 'same');

  return (
    <>
      <div className="mb-4">
        <Link href={`/dashboard/evals/${slug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" />
          Back to
          {' '}
          {c.datasetName}
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GitCompareArrows className="size-5" />
            </div>
            <div>
              <div>Model upgrade test</div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-sm font-normal text-muted-foreground">
                <span>{c.agentSlug}</span>
                <span aria-hidden>·</span>
                <RunLink slug={slug} side={c.baseline} />
                <span aria-hidden>→</span>
                <RunLink slug={slug} side={c.candidate} />
              </div>
            </div>
          </div>
        )}
        description={c.verdict}
      />

      {(c.baseline.unpriced || c.candidate.unpriced) && (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {[c.baseline.unpriced ? c.baseline.model : null, c.candidate.unpriced ? c.candidate.model : null].filter(Boolean).map(m => <code key={m} className="font-mono">{m}</code>)}
            {' '}
            is not in the price table, so its cost reads as $0.00. Add it to
            {' '}
            <code className="font-mono">libs/pricing.ts</code>
            {' '}
            before trusting the cost rows.
          </span>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold">The three questions</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Measure</th>
                <th className="px-4 py-2 text-right font-mono font-medium normal-case">{c.baseline.model}</th>
                <th className="px-4 py-2 text-right font-mono font-medium normal-case">{c.candidate.model}</th>
                <th className="px-4 py-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <Group label="1 · What it finishes" />
              <Row label="Pass rate" b={pct(c.baseline.passRate)} cnd={pct(c.candidate.passRate)} d={c.deltas.passRate} strong />
              <Row label="Cases passed" b={`${c.baseline.passed} / ${c.baseline.cases}`} cnd={`${c.candidate.passed} / ${c.candidate.cases}`} d={null} note={`${c.gained} gained · ${c.lost} lost`} />
              <Row label="Mean judge score" b={num(c.baseline.meanScore, 2)} cnd={num(c.candidate.meanScore, 2)} d={c.deltas.meanScore} />
              <Group label="2 · Where it stops needing a retry or a handoff" />
              <Row label="Model turns per case" b={num(c.baseline.meanTurns, 2)} cnd={num(c.candidate.meanTurns, 2)} d={c.deltas.meanTurns} lowerIsBetter />
              <Row label="Tool calls per case" b={num(c.baseline.meanToolCalls, 2)} cnd={num(c.candidate.meanToolCalls, 2)} d={c.deltas.meanToolCalls} lowerIsBetter />
              <Row label="Median latency" b={ms(c.baseline.medianLatencyMs)} cnd={ms(c.candidate.medianLatencyMs)} d={c.deltas.medianLatencyMs} lowerIsBetter />
              <Group label="3 · What a finished piece of work costs" />
              <Row label="Total cost, all cases" b={usd(c.baseline.totalCents)} cnd={usd(c.candidate.totalCents)} d={c.deltas.totalCents} lowerIsBetter />
              <Row label="Cost per passed case" b={c.baseline.costPerPassedCaseCents != null ? usd(c.baseline.costPerPassedCaseCents) : '—'} cnd={c.candidate.costPerPassedCaseCents != null ? usd(c.candidate.costPerPassedCaseCents) : '—'} d={c.deltas.costPerPassedCase} lowerIsBetter strong />
              <Row label="Tokens in / out" b={`${fmtInt(c.baseline.totalInputTokens)} / ${fmtInt(c.baseline.totalOutputTokens)}`} cnd={`${fmtInt(c.candidate.totalInputTokens)} / ${fmtInt(c.candidate.totalOutputTokens)}`} d={null} />
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold">
          Cases that changed (
          {changed.length}
          {' '}
          of
          {' '}
          {c.cases.length}
          )
        </h2>
        {changed.length === 0
          ? <p className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">Every case landed the same verdict on both models.</p>
          : <CaseTable comparison={c} rows={changed} />}
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold">Every case</h2>
        <CaseTable comparison={c} rows={c.cases} showRationale />
      </section>
    </>
  );
}

function RunLink({ slug, side }: { slug: string; side: RunSide }) {
  return (
    <Link href={`/dashboard/evals/${slug}/runs/${side.runId}`} className="underline-offset-2 hover:underline">
      {side.model}
      <span className="text-muted-foreground/70">
        {' '}
        #
        {side.runId}
      </span>
    </Link>
  );
}

function Group({ label }: { label: string }) {
  return (
    <tr className="bg-muted/15">
      <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</td>
    </tr>
  );
}

function Row({ label, b, cnd, d, lowerIsBetter = false, strong = false, note }: { label: string; b: string; cnd: string; d: Delta; lowerIsBetter?: boolean; strong?: boolean; note?: string }) {
  return (
    <tr>
      <td className={strong ? 'px-4 py-2 font-semibold' : 'px-4 py-2'}>{label}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{b}</td>
      <td className={strong ? 'px-4 py-2 text-right font-mono font-semibold tabular-nums' : 'px-4 py-2 text-right font-mono tabular-nums'}>{cnd}</td>
      <td className="px-4 py-2 text-right">{note ? <span className="font-mono text-xs text-muted-foreground">{note}</span> : <DeltaChip d={d} lowerIsBetter={lowerIsBetter} />}</td>
    </tr>
  );
}

/**
 * The change, with a word and an icon so direction never rides on colour
 * alone. "Better" is judged per measure: a lower cost or fewer turns is the
 * good direction, a higher pass rate is.
 * @param props - Chip props.
 * @param props.d - Relative change, candidate over baseline.
 * @param props.lowerIsBetter - Whether a decrease is the good direction for this measure.
 */
function DeltaChip({ d, lowerIsBetter }: { d: Delta; lowerIsBetter: boolean }) {
  if (d == null) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  }
  const p = Math.round(d * 100);
  if (p === 0) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
        <MinusCircle className="size-3" aria-hidden />
        ±0%
      </span>
    );
  }
  const better = lowerIsBetter ? p < 0 : p > 0;
  const Icon = better ? CheckCircle2 : XCircle;
  return (
    <span className={better
      ? 'inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-800 dark:text-emerald-200'
      : 'inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-xs text-red-800 dark:text-red-200'}
    >
      <Icon className="size-3" aria-hidden />
      {p > 0 ? '+' : ''}
      {p}
      %
      {' '}
      {better ? 'better' : 'worse'}
    </span>
  );
}

function CaseTable({ comparison: c, rows, showRationale = false }: { comparison: ModelUpgradeComparison; rows: ModelUpgradeComparison['cases']; showRationale?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Input</th>
            <th className="px-3 py-2 text-left font-mono font-medium normal-case">{c.baseline.model}</th>
            <th className="px-3 py-2 text-left font-mono font-medium normal-case">{c.candidate.model}</th>
            <th className="px-3 py-2 text-left font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(x => (
            <tr key={x.itemIndex} className="align-top">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{x.itemIndex + 1}</td>
              <td className="max-w-md px-3 py-2">
                <div className="line-clamp-2 text-foreground">{x.input}</div>
                {showRationale && x.candidate?.rationale && (
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground italic">{x.candidate.rationale}</div>
                )}
              </td>
              <td className="px-3 py-2"><SideCell s={x.baseline} /></td>
              <td className="px-3 py-2"><SideCell s={x.candidate} /></td>
              <td className="px-3 py-2"><Flip flip={x.flip} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SideCell({ s }: { s: CaseSide | null }) {
  if (!s) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 font-mono text-xs">
      <Verdict v={s.verdict} />
      <span className="text-muted-foreground tabular-nums">
        {[s.score != null ? s.score.toFixed(2) : null, s.cents != null ? usd(s.cents) : null, s.turns != null ? `${s.turns} turns` : null, s.toolCalls != null ? `${s.toolCalls} tools` : null].filter(Boolean).join(' · ')}
      </span>
    </div>
  );
}

function Verdict({ v }: { v: string }) {
  if (v === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="size-3" aria-hidden />
        pass
      </span>
    );
  }
  if (v === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 text-red-800 dark:text-red-200">
        <XCircle className="size-3" aria-hidden />
        fail
      </span>
    );
  }
  if (v === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-200">
        <OctagonAlert className="size-3" aria-hidden />
        error
      </span>
    );
  }
  return <span className="text-muted-foreground">{v}</span>;
}

function Flip({ flip }: { flip: 'gained' | 'lost' | 'same' }) {
  if (flip === 'gained') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="size-3" aria-hidden />
        gained
      </span>
    );
  }
  if (flip === 'lost') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-800 dark:text-red-200">
        <XCircle className="size-3" aria-hidden />
        lost
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">same</span>;
}

function num(n: number | null, digits: number): string {
  return n == null ? '—' : n.toFixed(digits);
}

function ms(n: number | null): string {
  return n == null ? '—' : `${fmtInt(n)} ms`;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

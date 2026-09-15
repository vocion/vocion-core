import type { WorkerRun } from '@/services/WorkerRunService';
import { ArrowLeft } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createElement } from 'react';
import { ContractGrid } from '@/features/dashboard/team-report/ContractGrid';
import { ago, compact, duration, pct, usd, windowLabel } from '@/features/dashboard/team-report/format';
import { KindMix, RunKindBadge } from '@/features/dashboard/team-report/RunKindBadge';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { memberReport, parseReportWindow } from '@/services/TeamReportService';

/**
 * /dashboard/team-report/[agentSlug] — one member: its contract, then its runs.
 *
 * The contract first (purpose, owner inherited from its team, autonomy,
 * permissions, escalation) with weight against outcome — the member's share
 * of the org's spend beside its share of the team's KPI readings. Then the
 * evidence: a quiet line of numbers and every run in the window, newest
 * first, with kind badge, model, duration, cost, status and the worker's own
 * summary. Rows carry `id="run-<id>"` so the activity feed can deep-link.
 */

export const dynamic = 'force-dynamic';

export default async function MemberReportPage(props: {
  params: Promise<{ locale: string; agentSlug: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { locale, agentSlug } = await props.params;
  const { window: rawWindow } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }
  const window = parseReportWindow(rawWindow);
  const detail = await memberReport(orgId, decodeURIComponent(agentSlug), { window });
  if (!detail) {
    return notFound();
  }
  const { member, team, runs, counts } = detail;
  const a = agentAccent(member.accent);
  const countEntries = Object.entries(counts).sort((x, y) => y[1] - x[1]);

  return (
    <>
      <div className="mb-5">
        <Link href={`/dashboard/team-report?window=${window}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden />
          Team report
        </Link>
      </div>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl" style={{ background: a.tint, color: a.ink }}>
          {createElement(agentIcon(member.icon, { primary: member.isLead }), { 'className': 'size-6', 'aria-hidden': true })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">{member.name}</h1>
            {member.isLead && <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-background uppercase" style={{ background: a.ink }}>lead</span>}
            {team && (
              <Link href={`/dashboard/team-report#team-${team.slug}`} className="text-sm text-muted-foreground hover:text-foreground">
                {team.name}
              </Link>
            )}
          </div>
          {/* Weight against outcome, for this member. */}
          <p className="mt-1 text-sm tabular-nums">
            <span className="font-semibold">{pct(member.shareOfCents)}</span>
            <span className="text-muted-foreground"> of org spend</span>
            <span className="mx-2 text-muted-foreground/60">·</span>
            {member.outcomeShare === null
              ? <span className="text-muted-foreground">{team ? 'team outcome not measured' : 'no team contract'}</span>
              : (
                  <>
                    <span className="font-semibold">{pct(member.outcomeShare)}</span>
                    <span className="text-muted-foreground">
                      {' of '}
                      {team?.name ?? 'team'}
                      ’s outcome
                    </span>
                  </>
                )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <Link href={`/dashboard/agents/${member.slug}`} className="font-medium text-muted-foreground hover:text-primary">Profile →</Link>
            <Link href={`/dashboard/activity?kind=tool&agent=${encodeURIComponent(member.slug)}`} className="font-medium text-muted-foreground hover:text-primary">Tool calls →</Link>
          </div>
        </div>
      </header>

      <section className="mt-6 border-y border-border py-5">
        <ContractGrid
          contract={{ ...member.contract, purpose: member.contract.purpose ?? team?.goal ?? null }}
          escalationHref={`/dashboard/inbox?agent=${encodeURIComponent(member.slug)}`}
          purposeFallback="No description authored for this agent."
        />
      </section>

      {/* ── Evidence ─────────────────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Evidence
            <span className="font-normal text-muted-foreground">
              {' · '}
              {windowLabel(window).toLowerCase()}
            </span>
          </h2>
          <KindMix byKind={member.byKind} />
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Num k="Spend" v={usd(member.cents)} />
          <Num k="Tokens" v={compact(member.tokens)} />
          <Num k="Runs" v={String(member.runs)} />
          {member.failed > 0 && <Num k="Failed / lost" v={String(member.failed)} tone="text-rose-700 dark:text-rose-400" />}
          {member.active > 0 && <Num k="Running" v={String(member.active)} tone="text-emerald-700 dark:text-emerald-400" />}
          {member.judgementCents > 0 && <Num k="Judgement spend" v={usd(member.judgementCents)} />}
          {member.budget && (
            <Num
              k={`${member.budget.period} budget`}
              v={`${usd(member.budget.currentCents)}${member.budget.hardCentsLimit !== null ? ` / ${usd(member.budget.hardCentsLimit)} cap` : ' (no cap)'}`}
            />
          )}
          {member.models.length > 0 && <Num k="Models" v={member.models.join(', ')} mono />}
          <Num k="Last active" v={ago(member.lastActivity)} />
        </dl>
        {countEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {countEntries.slice(0, 16).map(([k, v]) => (
              <span key={k} className="rounded-sm border border-border bg-muted/40 px-1.5 py-px font-mono text-[11px] text-muted-foreground">
                {k}
                {' '}
                <span className="text-foreground tabular-nums">{compact(v)}</span>
              </span>
            ))}
          </div>
        )}

        <h3 className="mt-6 mb-2 text-sm font-semibold">
          Runs
          <span className="font-normal text-muted-foreground">
            {' · '}
            {runs.length}
            {runs.length >= 100 ? ' (latest 100)' : ''}
          </span>
        </h3>
        {runs.length === 0
          ? <p className="text-sm text-muted-foreground">No runs in this window.</p>
          : <ol className="divide-y divide-border/60">{runs.map(r => <RunRow key={r.id} run={r} />)}</ol>}
      </section>
    </>
  );
}

/**
 * One run — the facts on one line, the worker's summary beneath, counts as chips.
 * @param root0
 * @param root0.run
 */
function RunRow({ run }: { run: WorkerRun }) {
  const started = run.claimedAt ?? run.createdAt;
  const ended = run.completedAt ?? (run.status === 'running' || run.status === 'paused' ? null : run.heartbeatAt);
  const countEntries = Object.entries(run.counts ?? {}).filter(([, v]) => typeof v === 'number' && v !== 0);
  return (
    <li id={`run-${run.id}`} className="scroll-mt-20 py-3 target:bg-primary/5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <RunKindBadge kind={run.kind} />
        <span className="font-mono text-[12px] text-muted-foreground">{run.model ?? '—'}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {started.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          {' · '}
          {duration(started, ended)}
        </span>
        <span className="font-medium tabular-nums">{usd(run.cents)}</span>
        {run.tokens > 0 && <span className="text-xs text-muted-foreground tabular-nums">{`${compact(run.tokens)} tok`}</span>}
        <StatusPill status={run.status} />
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">{`#${run.id}`}</span>
      </div>
      {run.summary && <p className="mt-1.5 max-w-4xl text-sm leading-relaxed whitespace-pre-line text-foreground/85">{run.summary}</p>}
      {run.error && <p className="mt-1.5 text-sm text-rose-700 dark:text-rose-400">{run.error}</p>}
      {countEntries.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {countEntries.map(([k, v]) => (
            <span key={k} className="rounded-sm border border-border bg-muted/40 px-1.5 py-px font-mono text-[11px] text-muted-foreground">
              {k}
              {' '}
              <span className="text-foreground tabular-nums">{v}</span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'completed'
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : status === 'failed' || status === 'lost'
      ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
      : status === 'running' || status === 'paused' || status === 'awaiting_review'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : 'bg-muted text-muted-foreground';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{status.replaceAll('_', ' ')}</span>;
}

function Num({ k, v, tone, mono = false }: { k: string; v: string; tone?: string; mono?: boolean }) {
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={`font-medium tabular-nums ${tone ?? ''} ${mono ? 'font-mono text-[12px]' : ''}`}>{v}</dd>
    </div>
  );
}

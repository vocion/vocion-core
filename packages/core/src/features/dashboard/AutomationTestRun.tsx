'use client';

import type { AutomationCheckResult } from '@/services/automations/checkSummary';
import { ExternalLink, FlaskConical, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration, summarizeResult } from './automationResult';

/**
 * The orders a report-only test run carries instead of the authored prompt.
 * The mission-check branch prefers `input.prompt`, so this replaces the full
 * three-part pass with the one part that answers "did it identify anyone".
 */
const REPORT_ONLY_PROMPT = `REPORT ONLY. Run PART ONE of your standing orders and then STOP.

Identify who is in scope: call hubspot_count_contacts with no lifecycle filter to read the exact stage string from \`facets.lifecycleStage\`, then call it again with that stage, created_within_days 7 and limit 200, paging until you have every record. Call get_lead_ledger to tell new arrivals from repeats, and reconcile_mql_window with the same stage and since_days 7.

Do NOT call queue_lead. Do NOT write briefs. Do NOT draft anything. Do NOT propose any action.

Report: the contacts in scope (the \`total\`), how many are already on the queue, the window the tools applied (\`created_after_applied\` / \`window.since\`), the mirror's \`as_of\`, and any \`mirror_stale\` warning. Then stop.`;

/**
 * Test-run control for an automation — "does this actually work, and what
 * would it do?" without waiting for the next fire or opening a shell.
 *
 * Fires the SAME `fireAutomation` path the Temporal schedule uses, so the run
 * exercises the automation's authored `do.input`; only what is passed here
 * differs. That is deliberate — a test run with its own config would prove
 * nothing about the scheduled one.
 *
 * Two things this control used to get wrong. Dry run was checked by default
 * and labelled "no review-queue items", and for a mission check it did
 * nothing at all: the flag reached the run row and the branch never read it,
 * so a run marked `dry_run = t` ran the full live agent. And the POST held an
 * HTTP connection for the whole agent loop, 2.7 minutes typically and 29 at
 * the August peak. Now: no dry-run claim for a mission check, copy that names
 * the real consequence, and a request that returns as soon as the fire is
 * recorded, then polls.
 * @param props
 * @param props.slug
 * @param props.kind - Which do-type this automation dispatches.
 * @param props.supportsDay - Show the day picker (only jobs that accept `day`).
 */
export function AutomationTestRun({
  slug,
  kind,
  supportsDay,
}: {
  slug: string;
  kind: 'mission_check' | 'workflow' | 'job';
  supportsDay: boolean;
}) {
  const router = useRouter();
  const isCheck = kind === 'mission_check';
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  // A dry run is only offered where the code honours one. For a mission check
  // it does not, and a half-honoured dry run is worse than an honest live one.
  const [dryRun, setDryRun] = useState(!isCheck);
  const [reportOnly, setReportOnly] = useState(isCheck);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState<{ automationRunId: number; missionRunId: number | null } | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  /** Watch the run row until it leaves `running`. */
  const watch = useCallback((automationRunId: number) => {
    stopPolling();
    poll.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/automations/${slug}/runs/${automationRunId}`);
        if (!res.ok) {
          return;
        }
        const body = await res.json();
        setStatus(body?.status ?? null);
        if (body?.status && body.status !== 'running') {
          setResult(body.result ?? null);
          setError(body.error ?? null);
          setRunning(false);
          stopPolling();
          router.refresh();
        }
      } catch {
        /* keep polling — a transient failure is not a verdict */
      }
    }, 4000);
  }, [router, slug, stopPolling]);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    setStatus('running');
    setStarted(null);
    try {
      const res = await fetch(`/api/v1/automations/${slug}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // `async` returns as soon as the run row exists, instead of holding
          // the connection for the whole agent loop.
          async: true,
          ...(isCheck ? {} : { dryRun }),
          input: {
            ...(supportsDay && day ? { day } : {}),
            ...(isCheck && reportOnly ? { prompt: REPORT_ONLY_PROMPT } : {}),
          },
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      setStarted({ automationRunId: body.automationRunId, missionRunId: body.runId ?? null });
      if (body.status && body.status !== 'running') {
        // A synchronous do-type (a job) is already finished.
        setResult(body.result ?? null);
        setStatus(body.status);
        setRunning(false);
        router.refresh();
        return;
      }
      watch(body.automationRunId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
      setStatus(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <FlaskConical className="size-3.5" />
        Test run
      </button>
    );
  }

  return (
    <div className="w-full rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-3">
        {supportsDay && (
          <div>
            <label htmlFor={`day-${slug}`} className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Day to sweep (UTC)
            </label>
            <input
              id={`day-${slug}`}
              type="date"
              value={day}
              onChange={e => setDay(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
          </div>
        )}
        {isCheck
          ? (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={reportOnly} onChange={e => setReportOnly(e.target.checked)} />
                Report only
                <span className="text-muted-foreground">(identify and stop, no briefs or drafts)</span>
              </label>
            )
          : (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
                Dry run
                <span className="text-muted-foreground">(no review-queue items)</span>
              </label>
            )}
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
          {running ? 'Running…' : 'Run now'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      {/* The real consequence of THIS automation, not the sweep's copy. */}
      {isCheck && (
        <p className="mt-2 text-[11px] text-amber-600">
          {reportOnly
            ? 'Report only: the agent identifies who is in scope and stops. No briefs, no drafts, no review items.'
            : 'A live pass: queues arrivals, writes briefs, drafts sends and proposes enroll cards for review. Nothing is sent and nobody is enrolled — every send still waits for a human’s Enroll.'}
        </p>
      )}
      {!isCheck && !dryRun && (
        <p className="mt-2 text-[11px] text-amber-600">
          A real run posts matched calls to the review queue and marks them routed.
        </p>
      )}

      {started && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Fire
          {' '}
          <span className="font-mono">
            #
            {started.automationRunId}
          </span>
          {' '}
          recorded
          {started.missionRunId
            ? (
                <>
                  {', mission run '}
                  <a
                    href={`/dashboard/missions/runs/${started.missionRunId}`}
                    className="inline-flex items-center gap-0.5 font-mono hover:underline"
                  >
                    #
                    {started.missionRunId}
                    <ExternalLink className="size-3" />
                  </a>
                </>
              )
            : ''}
          {running ? ' — still running; this panel updates when it finishes.' : '.'}
        </p>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {result !== null && <TestRunResult result={result} status={status} />}
    </div>
  );
}

type SweepShape = {
  eligibleParties?: number;
  meetingsScanned?: number;
  matched?: number;
  classified?: number;
  dryRun?: boolean;
  routed?: { generate: number; confirm: number; drop: number };
  window?: { since: string; until: string };
  meetings?: {
    meetingExternalId: string;
    title: string | null;
    matchType: string;
    matchRef: string | null;
    matchReason: string;
    skipped?: string;
    route?: string;
    classification?: { isDiscovery: boolean; isDiscoveryConfidence: number; reasoning: string };
  }[];
};

function isCheckResult(result: unknown): result is AutomationCheckResult {
  return !!result && typeof result === 'object' && (result as AutomationCheckResult).kind === 'mission_check';
}

/**
 * Render the fire's own counts. A mission check answers the four questions the
 * panel exists for; the sweep keeps its counts; anything else falls back to
 * the raw payload, because the control is generic over automations.
 * @param props
 * @param props.result
 * @param props.status - The run row's status.
 */
function TestRunResult({ result, status }: { result: unknown; status: string | null }) {
  if (isCheckResult(result)) {
    return <CheckResult result={result} status={status} />;
  }
  const sweep = result as SweepShape | null;
  const looksLikeSweep = sweep && typeof sweep === 'object' && typeof sweep.meetingsScanned === 'number';

  if (!looksLikeSweep) {
    return (
      <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-background p-2 text-[11px]">
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <Stat label="scanned" value={sweep.meetingsScanned} />
        <Stat label="matched" value={sweep.matched} />
        <Stat label="classified" value={sweep.classified} />
        <Stat label="eligible CRM parties" value={sweep.eligibleParties} />
        {sweep.routed && (
          <span className="text-muted-foreground">
            routed:
            {' '}
            {sweep.routed.generate}
            {' '}
            generate /
            {' '}
            {sweep.routed.confirm}
            {' '}
            confirm /
            {' '}
            {sweep.routed.drop}
            {' '}
            drop
          </span>
        )}
      </div>

      {sweep.window && (
        <div className="text-[11px] text-muted-foreground">
          window
          {' '}
          {sweep.window.since.slice(0, 16).replace('T', ' ')}
          {' → '}
          {sweep.window.until.slice(0, 16).replace('T', ' ')}
          {' UTC'}
        </div>
      )}

      {sweep.matched === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Nothing matched in this window. With zero eligible CRM parties the cause is usually that the
          HubSpot sync has not stamped owner/lifecycle metadata yet; with parties but no matches, the
          calendar sync has not supplied the Zoom meeting id the attendee join needs.
        </p>
      )}

      {!!sweep.meetings?.length && (
        <ul className="space-y-1.5">
          {sweep.meetings.map(m => (
            <li key={m.meetingExternalId} className="rounded border border-border bg-background p-2 text-[11px]">
              <div className="font-medium">{m.title ?? m.meetingExternalId}</div>
              <div className="text-muted-foreground">
                matched
                {' '}
                {m.matchType}
                {m.matchRef ? ` · ${m.matchRef}` : ''}
                {' · '}
                {m.matchReason}
              </div>
              {m.skipped && (
                <div className="text-muted-foreground">
                  not classified:
                  {' '}
                  {m.skipped === 'no-transcript' ? 'no transcript synced yet' : 'already routed on an earlier sweep'}
                </div>
              )}
              {m.classification && (
                <div>
                  <span className={m.classification.isDiscovery ? 'text-emerald-600' : 'text-muted-foreground'}>
                    {m.classification.isDiscovery ? 'discovery' : 'not discovery'}
                  </span>
                  {' '}
                  {Math.round(m.classification.isDiscoveryConfidence * 100)}
                  % confident
                  {m.route ? ` → ${m.route}` : ''}
                  <div className="text-muted-foreground">{m.classification.reasoning}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {sweep.dryRun && (
        <p className="text-[11px] text-muted-foreground">
          Dry run: matches were recorded, nothing was queued for review or marked routed.
        </p>
      )}
    </div>
  );
}

/**
 * The four numbers a test run exists to answer, each traceable to a table or a
 * tool response rather than the agent's prose.
 * @param props
 * @param props.result
 * @param props.status
 */
function CheckResult({ result, status }: { result: AutomationCheckResult; status: string | null }) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-background p-2.5">
      <dl className="grid gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
        <Row label="Time period evaluated">
          {result.window?.since
            ? `${result.window.since.slice(0, 16).replace('T', ' ')} → ${result.window.until.slice(0, 16).replace('T', ' ')} UTC`
            : <span className="text-muted-foreground">no window applied — the pass made no in-window CRM read</span>}
        </Row>
        <Row label="Run status">
          {status === 'error' ? 'the fire failed' : result.missionRunStatus}
          {result.tasks.total > 0 && ` · ${result.tasks.ok}/${result.tasks.total} tasks ok`}
          {result.tasks.failed > 0 && ` · ${result.tasks.failed} failed`}
          {formatDuration(result.durationMs) && ` · ${formatDuration(result.durationMs)}`}
        </Row>
        <Row label="Contacts found">
          {result.counts.contactsInWindow === null
            ? <span className="text-muted-foreground">not counted — no stage-filtered CRM read in this pass</span>
            : `${result.counts.contactsInWindow} in the window at the stage filter`}
        </Row>
        <Row label="MQLs sent to agent">
          {result.counts.queued}
          {' queued this run · '}
          {result.counts.queueTotal}
          {' on the queue'}
        </Row>
      </dl>

      {(result.counts.briefed > 0 || result.counts.drafted > 0) && (
        <p className="text-[11px] text-muted-foreground">
          {result.counts.briefed}
          {' briefed · '}
          {result.counts.drafted}
          {' drafted in this pass.'}
        </p>
      )}

      {result.mirror?.stale && (
        <p className="text-[11px] text-amber-600">{result.mirror.note ?? 'The mirror this pass read is behind its own sync schedule.'}</p>
      )}
      {result.mirror?.asOf && !result.mirror.stale && (
        <p className="text-[11px] text-muted-foreground">
          Mirror last synced
          {' '}
          {result.mirror.asOf.slice(0, 16).replace('T', ' ')}
          {' UTC.'}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">{summarizeResult(result)}</p>

      <a
        href={`/dashboard/missions/runs/${result.missionRunId}`}
        className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
      >
        Full report
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) {
    return null;
  }
  return (
    <span>
      <strong className="font-semibold">{value}</strong>
      {' '}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

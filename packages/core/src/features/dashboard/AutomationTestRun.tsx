'use client';

import { FlaskConical, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Test-run control for a scheduled automation — "does this actually work, and
 * what would it do?" without waiting for the next fire or opening a shell.
 *
 * Fires the SAME `fireAutomation` path the Temporal schedule uses, so the run
 * exercises the automation's authored `do.input`; only the day and the dry-run
 * flag are overridden. Dry run is the default because the discovery sweep is
 * idempotent by design (an already-swept day reports zero on a real re-run,
 * which reads as broken) and because a real run posts to the review queue.
 * @param props
 * @param props.slug
 * @param props.supportsDay - Show the day picker (only jobs that accept `day`).
 */
export function AutomationTestRun({ slug, supportsDay }: { slug: string; supportsDay: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/automations/${slug}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, input: supportsDay && day ? { day } : {} }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      setResult(body?.result ?? body);
      // Refresh the server component so the new run row shows in "last run".
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
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
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
          Dry run
          <span className="text-muted-foreground">(no review-queue items)</span>
        </label>
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

      {!dryRun && (
        <p className="mt-2 text-[11px] text-amber-600">
          A real run posts matched calls to the review queue and marks them routed.
        </p>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {result !== null && <TestRunResult result={result} />}
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

/**
 * Render the sweep's own counts when the result looks like one, otherwise the
 * raw JSON — the control is generic over automations, so it must not assume the
 * discovery sweep's shape.
 * @param props
 * @param props.result
 */
function TestRunResult({ result }: { result: unknown }) {
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

'use client';

/**
 * "Check now" on the Routing section (ADR 0006, health): one tiny Jev call
 * with this workspace's key, and one line saying how it went.
 */
import { useState } from 'react';
import { client } from '@/libs/Orpc';
import { OUTCOME_LABEL } from './routingStatus';

export type JevCheckLine = { ok: boolean; outcome: string; reason: string | null; latencyMs: number | null; model: string | null };

/**
 * The line a check result reads as. Pure.
 * @param r - The result.
 */
export function checkLine(r: JevCheckLine): string {
  if (r.ok) {
    return `Jev answered in ${Math.round(r.latencyMs ?? 0)} ms${r.model ? ` (${r.model})` : ''}.`;
  }
  if (r.outcome === 'auth') {
    return 'Jev rejected the key. Replace it in System Keys.';
  }
  return `No answer: ${OUTCOME_LABEL[r.outcome] ?? r.outcome}${r.reason ? ` (${r.reason})` : ''}.`;
}

export function JevCheckButton(props: { initial?: JevCheckLine | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JevCheckLine | null>(props.initial ?? null);
  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(await client.routing.checkNow());
          } catch {
            setResult({ ok: false, outcome: 'unreachable', reason: 'the check could not run', latencyMs: null, model: null });
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
      >
        {busy ? 'Checking…' : 'Check now'}
      </button>
      {result && <span className={result.ok ? 'text-muted-foreground' : 'text-destructive'}>{checkLine(result)}</span>}
    </div>
  );
}

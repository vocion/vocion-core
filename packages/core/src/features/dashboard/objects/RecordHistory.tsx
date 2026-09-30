'use client';

import type { RecordHistory as History, RecordVersion } from '@/services/objects/recordBody';
import { Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { announceVersionWritten, useVersionWritten } from '@/features/dashboard/versions/versionEvents';
import { client } from '@/libs/Orpc';

/**
 * A record's history — its body artifact's versions (backlog 035): who, when,
 * why, what each write changed, and Restore.
 *
 * Restore is not a second write path. It re-applies the version's fields
 * through `objects.update_meta`, so trust rules and the ledger apply, the
 * restore lands as a version of its own, and Undo puts it back. The same
 * component draws in the preview panel and on the record page.
 */

/**
 * A field value as one readable line: a list of statements as its
 * statements, an object as its values, nothing as a dash.
 * @param v - The value.
 */
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') {
    return '—';
  }
  if (Array.isArray(v)) {
    return v.map((item) => {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return String(o.statement ?? o.text ?? o.title ?? JSON.stringify(o));
      }
      return String(item);
    }).join(' · ') || '—';
  }
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).filter(x => x !== null && x !== undefined).map(String).join(' · ') || '—';
  }
  const s = String(v);
  return s.length > 280 ? `${s.slice(0, 279)}…` : s;
}

type Receipt = { kind: 'done'; runId: number; version: number | null } | { kind: 'pending'; runId: number } | { kind: 'unchanged' } | { kind: 'error'; message: string };

function VersionRow({ v, current, busy, focused, onRestore }: { v: RecordVersion; current: number; busy: boolean; focused: boolean; onRestore: (version: number) => void }) {
  const at = new Date(v.createdAt);
  return (
    <li className={`py-3 ${focused ? '-mx-2 rounded-md bg-brand-amber/10 px-2' : ''}`} data-testid="record-version" data-version={v.version} data-version-section={`v${v.version}`} {...(focused ? { 'aria-current': 'true' as const } : {})}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-foreground">
            <span className="font-semibold tabular-nums">{`v${v.version}`}</span>
            {v.version === current && <span className="ml-1.5 text-xs text-muted-foreground">current</span>}
            <span className="text-muted-foreground">{` · ${v.authorName} · `}</span>
            <time dateTime={v.createdAt} className="text-muted-foreground">{at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </p>
          {v.reason && <p className="mt-0.5 text-[13px] break-words text-foreground/80">{v.reason}</p>}
        </div>
        {v.restorable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onRestore(v.version)}
                disabled={busy}
                aria-label={`Restore version ${v.version}`}
                data-testid="record-version-restore"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{`Restore version ${v.version} — written as a new version, with Undo`}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {v.changes.length > 0 && (
        <dl className="mt-1.5 space-y-1 text-[12px]">
          {v.changes.map(c => (
            <div key={c.key} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2">
              <dt className="truncate text-muted-foreground">{c.label}</dt>
              <dd className="min-w-0 break-words">
                <span className="text-muted-foreground line-through decoration-muted-foreground/50">{show(c.before)}</span>
                <span className="mx-1 text-muted-foreground" aria-hidden>→</span>
                <span className="text-foreground">{show(c.after)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {v.drift.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {`Also moved without this write: ${v.drift.map(d => d.label).join(', ')}`}
        </p>
      )}
    </li>
  );
}

/**
 * @param props - Component props.
 * @param props.objectId - The record (`business_object.id`).
 * @param props.focusVersion - A version to mark — the one the chat's "Changed …" line links to.
 */
export function RecordHistory({ objectId, focusVersion = null }: { objectId: number; focusVersion?: number | null }) {
  const [history, setHistory] = useState<History | null>(null);
  const [focus, setFocus] = useState<number | null>(focusVersion);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const load = useCallback(async () => {
    try {
      setHistory(await client.businessObject.history({ id: objectId }) as History);
      setFailed(null);
    } catch (err) {
      setFailed((err as Error).message || 'The history did not load.');
    }
  }, [objectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A version written anywhere — the chat, this page, the artifact pane —
  // lands here without a reload, marked (backlog 035).
  useVersionWritten([{ type: 'object', id: String(objectId) }], (v) => {
    // A change heard on the live stream names no version: read the list again.
    if (v.live) {
      void load();
      return;
    }
    // A write beneath the record (a plan filed for it) is not one of its versions.
    if (v.related) {
      return;
    }
    setFocus(v.to);
    void load();
  });

  const restore = async (version: number) => {
    setBusy(true);
    try {
      const out = await client.businessObject.restore({ id: objectId, version });
      if (out.status === 'unchanged') {
        setReceipt({ kind: 'unchanged' });
      } else if (out.status === 'done' && out.runId) {
        setReceipt({ kind: 'done', runId: out.runId, version: out.version });
      } else if (out.runId) {
        setReceipt({ kind: 'pending', runId: out.runId });
      } else {
        setReceipt({ kind: 'error', message: out.error ?? `The restore is ${out.status}.` });
      }
      if (out.status === 'done' && out.version) {
        // The page showing the record refreshes in place and marks the change.
        announceVersionWritten({ ref: { type: 'object', id: String(objectId) }, from: history?.current ?? null, to: out.version, fields: out.fields });
      } else {
        await load();
      }
    } catch (err) {
      setReceipt({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const undo = async (runId: number) => {
    setBusy(true);
    try {
      await client.review.undoAction({ id: runId });
      setReceipt(null);
      // Undo is a version too: announce it so the page and this list catch up.
      announceVersionWritten({ ref: { type: 'object', id: String(objectId) }, from: history?.current ?? null, to: (history?.current ?? 0) + 1 });
    } catch (err) {
      setReceipt({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">{failed}</p>;
  }
  if (!history) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Reading the history…
      </p>
    );
  }
  return (
    <div className="px-4 py-2" data-testid="record-history">
      {receipt && (
        <p className="mb-1 flex flex-wrap items-center gap-x-2 border-b border-rule py-2 text-[13px]" role="status" data-testid="record-history-receipt">
          {receipt.kind === 'done' && (
            <>
              <span>{receipt.version ? `Restored — now v${receipt.version}.` : 'Restored.'}</span>
              <button type="button" disabled={busy} onClick={() => void undo(receipt.runId)} className="inline-flex items-center gap-1 text-foreground underline underline-offset-2">
                <RotateCcw className="size-3" aria-hidden />
                Undo
              </button>
            </>
          )}
          {receipt.kind === 'pending' && <span>The restore is waiting for a person in Review, under this workspace's trust rule.</span>}
          {receipt.kind === 'unchanged' && <span>The record already says that. Nothing was written.</span>}
          {receipt.kind === 'error' && <span className="text-[var(--brand-fail)]">{receipt.message}</span>}
        </p>
      )}
      <ol className="divide-y divide-rule">
        {history.versions.map(v => <VersionRow key={v.version} v={v} current={history.current} busy={busy} focused={focus === v.version} onRestore={version => void restore(version)} />)}
      </ol>
    </div>
  );
}

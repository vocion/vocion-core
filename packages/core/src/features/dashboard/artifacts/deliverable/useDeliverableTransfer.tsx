'use client';

/**
 * Download and Upload a new version, for the header's actions and the pane's
 * banner (`transfer.ts` speaks to the routes). A download that the export
 * gate has advice about still downloads; the advice is one line in a toast.
 * An upload says what it did in plain words ("12 kept, 2 text edited, 1
 * added") and selects the first page it changed; a stale one says what
 * changed in Vocion since and offers "Reload and retry".
 */

import type { ArtifactEntry } from '../artifactReducer';
import type { DeliverableKind } from './pages';
import type { ExportFormat, ReportCountKey } from './transfer';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { client } from '@/libs/Orpc';
import { conflictLines, downloadDeliverable, importAccept, reportSummary, uploadDeliverable } from './transfer';

type Conflict = { reason: string; lines: string[]; file: File };

export type DeliverableTransfer = {
  download: (format: ExportFormat) => void;
  /** Open the file picker. */
  upload: () => void;
  /** The hidden file input; render it anywhere. */
  input: React.ReactNode;
  /** The stale-upload banner, or null. */
  banner: React.ReactNode;
};

export function useDeliverableTransfer(opts: {
  artifactId: number;
  kind: DeliverableKind | null;
  title: string;
  version: number;
  onUpdated?: (artifact: ArtifactEntry) => void;
  onVersionsChanged?: () => void;
  onSelect?: (key: string) => void;
}): DeliverableTransfer {
  const t = useTranslations('Deliverable');
  const fileRef = useRef<HTMLInputElement>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);
  const { artifactId, kind, title, version, onUpdated, onVersionsChanged, onSelect } = opts;

  const countWords = useCallback((key: ReportCountKey, count: number): string => {
    switch (key) {
      case 'kept': return t('report.kept', { count });
      case 'textEdited': return t('report.textEdited', { count });
      case 'converted': return t('report.converted', { count });
      case 'added': return t('report.added', { count });
      case 'removed': return t('report.removed', { count });
      case 'moved': return t('report.moved', { count });
      case 'edited': return t('report.edited', { count });
      case 'unplaced': return t('report.unplaced', { count });
    }
  }, [t]);

  const formatName = useCallback((format: ExportFormat) => (format === 'pdf' ? 'PDF' : format === 'pptx' ? 'PowerPoint' : 'Word'), []);

  const download = useCallback((format: ExportFormat) => {
    const id = toast.pending(t('download.preparing', { format: formatName(format) }));
    downloadDeliverable(artifactId, format, title)
      .then(({ advice, filename }) => {
        toast.update(id, advice ? 'info' : 'success', advice ?? t('download.done', { filename }), advice ? { description: t('download.adviceHint', { filename }) } : undefined);
      })
      .catch((err: Error) => toast.update(id, 'error', t('download.failed', { format: formatName(format) }), { description: err.message }));
  }, [artifactId, formatName, t, title]);

  const refresh = useCallback(async () => {
    const row = await client.artifacts.get({ id: artifactId });
    onUpdated?.(row as ArtifactEntry);
    onVersionsChanged?.();
    return row.version;
  }, [artifactId, onUpdated, onVersionsChanged]);

  const send = useCallback(async (file: File, base: number) => {
    if (!kind) {
      return;
    }
    setBusy(true);
    const id = toast.pending(t('upload.sending', { name: file.name }));
    try {
      const out = await uploadDeliverable(artifactId, file, base);
      if (out.ok) {
        setConflict(null);
        if (!out.changed) {
          toast.update(id, 'info', t('upload.unchanged', { version: out.version }));
          return;
        }
        const summary = reportSummary(kind, out.report);
        toast.update(id, 'success', t('upload.done', { version: out.version }), {
          ...(summary.counts.length ? { description: summary.counts.map(c => countWords(c.key, c.count)).join(', ') } : {}),
        });
        await refresh().catch(() => {});
        if (summary.firstChanged) {
          onSelect?.(summary.firstChanged);
        }
        return;
      }
      if (out.conflict) {
        toast.dismiss(id);
        setConflict({ reason: out.reason, lines: conflictLines(out.diff), file });
        return;
      }
      toast.update(id, 'error', t('upload.failed'), { description: out.reason });
    } catch (err) {
      toast.update(id, 'error', t('upload.failed'), { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [artifactId, countWords, kind, onSelect, refresh, t]);

  const upload = useCallback(() => fileRef.current?.click(), []);

  const input = kind
    ? (
        <input
          ref={fileRef}
          type="file"
          accept={importAccept(kind)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-deliverable-upload-input
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              void send(file, version);
            }
          }}
        />
      )
    : null;

  const banner = conflict
    ? (
        <div className="flex flex-col gap-1.5 border-b border-border bg-brand-amber/10 px-3 py-2 text-xs text-foreground" role="alert" data-deliverable-upload-conflict>
          <p>{conflict.reason}</p>
          {conflict.lines.length > 0 && (
            <ul className="list-inside list-disc text-muted-foreground">
              {conflict.lines.map(line => <li key={line}>{line}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded border border-border px-2 py-0.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                const file = conflict.file;
                void refresh().then(v => send(file, v)).catch(err => toast.error(t('upload.failed'), { description: (err as Error).message }));
              }}
            >
              {t('upload.retry')}
            </button>
            <button type="button" className="text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setConflict(null)}>
              {t('upload.dismiss')}
            </button>
          </div>
        </div>
      )
    : null;

  return { download, upload, input, banner };
}

'use client';

/**
 * The "Import many" tab of the Add-source dialog: download a template, upload a
 * filled-in CSV, see what it would do, then create the sources.
 *
 * The file is previewed the moment it is chosen — the server reads it and
 * returns a verdict per row, writing nothing — so the operator agrees to a
 * concrete outcome ("38 will be added, 2 malformed, 1 already configured")
 * rather than to a file they cannot see inside.
 *
 * Nothing about a connector's columns is hard-coded here. Which columns exist,
 * what they mean and how they validate all live with the connector
 * (`libs/sources/bulkImport`), so this form works unchanged for every source
 * type that opts in.
 */

import { CircleCheck, CircleX, Download, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { AddSourceDialogFrame } from './AddSourceDialogFrame';

/** One row's verdict, mirroring `SourceImportRow` on the server. */
type ImportRow = {
  line: number;
  slug: string | null;
  identity: string | null;
  verdict: 'ok' | 'malformed' | 'duplicate-in-file' | 'already-exists';
  problem: string | null;
};

type ImportSummary = {
  total: number;
  willAdd: number;
  malformed: number;
  duplicateInFile: number;
  alreadyExists: number;
};

type ImportPreview = {
  rows: ImportRow[];
  summary: ImportSummary;
};

/** Largest file the browser will even send, matching the server's limit. */
const MAX_UPLOAD_BYTES = 1_048_576;

/** How each verdict reads in the preview table. */
const VERDICT_LABELS: Record<ImportRow['verdict'], string> = {
  'ok': 'Will be added',
  'malformed': 'Not valid',
  'duplicate-in-file': 'Duplicate',
  'already-exists': 'Already configured',
};

export function BulkImportSourcesForm({ kind, connectorName, title, tabs, onClose, onImported }: {
  /** Connector slug the rows belong to. */
  kind: string;
  /** Human name of the connector, for the copy. */
  connectorName: string;
  title: string;
  /** Tab switcher rendered by the dialog that owns both tabs. */
  tabs?: React.ReactNode;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPreview(null);
    setError(null);
    setCsvText(null);
    setFileName(file?.name ?? null);
    if (!file) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1_048_576)} MB limit.`);
      return;
    }

    setPreviewing(true);
    try {
      const text = await file.text();
      const result = await requestPreview(kind, text);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCsvText(text);
      setPreview(result.preview);
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!csvText) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestImport(kind, csvText);
      if (result.error) {
        setError(result.error);
        return;
      }
      await onImported();
    } finally {
      setSubmitting(false);
    }
  };

  const willAdd = preview?.summary.willAdd ?? 0;

  return (
    <AddSourceDialogFrame
      title={title}
      error={error}
      tabs={tabs}
      requirement={describeMissingStep({ fileChosen: fileName !== null, previewing, willAdd })}
      notice={null}
      submitLabel={willAdd > 0 ? `Add ${willAdd} ${willAdd === 1 ? 'source' : 'sources'}` : 'Add sources'}
      submitting={submitting}
      canSubmit={willAdd > 0 && !previewing}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {`Add one ${connectorName} source per row. Download the template, fill in a row for each source, then upload it back.`}
        </p>
        <a
          href={`/rpc/sources/import-template?kind=${encodeURIComponent(kind)}`}
          download
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <Download className="size-3.5" />
          Download CSV template
        </a>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-foreground/80">CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={chooseFile}
          aria-label="CSV file"
          className="mt-1 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
        />
      </label>

      {previewing
        ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Checking that file…
            </p>
          )
        : null}

      {preview ? <ImportPreviewTable preview={preview} /> : null}
    </AddSourceDialogFrame>
  );
}

/**
 * The per-row verdict table plus the one-line summary above it.
 *
 * Every row is listed, not only the problems: an operator confirming a
 * 40-source import should be able to see the forty names they are about to
 * create, and the rows that were skipped sit in the same list rather than in a
 * separate place they have to go looking for.
 * @param root0 - Component props.
 * @param root0.preview - The server's verdict for the uploaded file.
 */
function ImportPreviewTable({ preview }: { preview: ImportPreview }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium" data-testid="import-summary">
        {describeSummary(preview.summary)}
      </p>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted/60">
            <tr>
              <th className="px-2 py-1.5 font-medium">Line</th>
              <th className="px-2 py-1.5 font-medium">Source</th>
              <th className="px-2 py-1.5 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map(row => (
              <tr key={row.line} className="border-t" data-testid={`import-row-${row.verdict}`}>
                <td className="px-2 py-1.5 align-top text-muted-foreground">{row.line}</td>
                <td className="px-2 py-1.5 align-top">
                  <span className="font-mono">{row.slug ?? row.identity ?? '—'}</span>
                </td>
                <td className="px-2 py-1.5 align-top">
                  <span className="flex items-start gap-1.5">
                    <VerdictIcon verdict={row.verdict} />
                    <span>
                      {VERDICT_LABELS[row.verdict]}
                      {row.problem ? <span className="text-muted-foreground">{` — ${row.problem}`}</span> : null}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The icon that goes with one verdict.
 * @param root0 - Component props.
 * @param root0.verdict - The row's verdict.
 */
function VerdictIcon({ verdict }: { verdict: ImportRow['verdict'] }) {
  if (verdict === 'ok') {
    return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />;
  }
  if (verdict === 'malformed') {
    return <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />;
  }
  return <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />;
}

/**
 * The counts, as a sentence — only mentioning the categories that occurred.
 *
 * A summary reading "38 will be added · 0 malformed · 0 duplicates" makes the
 * operator read three numbers to learn one thing.
 * @param summary - Counts from the preview.
 */
export function describeSummary(summary: ImportSummary): string {
  const parts = [`${summary.willAdd} will be added`];
  if (summary.malformed > 0) {
    parts.push(`${summary.malformed} not valid`);
  }
  if (summary.duplicateInFile > 0) {
    parts.push(`${summary.duplicateInFile} duplicated in the file`);
  }
  if (summary.alreadyExists > 0) {
    parts.push(`${summary.alreadyExists} already configured`);
  }
  return `${parts.join(' · ')} (${summary.total} ${summary.total === 1 ? 'row' : 'rows'} read)`;
}

/**
 * What the operator still has to do, for the footer's "still needed" line.
 * @param state - Where the form has got to.
 * @param state.fileChosen - Whether a file has been picked.
 * @param state.previewing - Whether the preview request is in flight.
 * @param state.willAdd - How many rows would be created.
 */
export function describeMissingStep(state: {
  fileChosen: boolean;
  previewing: boolean;
  willAdd: number;
}): string | null {
  if (!state.fileChosen) {
    return 'a filled-in CSV file';
  }
  if (state.previewing) {
    return 'the file check to finish';
  }
  if (state.willAdd === 0) {
    return 'at least one row that can be added';
  }
  return null;
}

/**
 * Ask the server what the file would do. Writes nothing.
 * @param kind - Connector slug.
 * @param csvText - The file's text.
 */
async function requestPreview(kind: string, csvText: string): Promise<{ preview: ImportPreview | null; error: string | null }> {
  const res = await fetch('/rpc/sources/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, csv: csvText }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { preview: null, error: data.error ?? 'Could not read that file' };
  }
  return { preview: data.preview as ImportPreview, error: null };
}

/**
 * Create the sources the preview judged importable.
 * @param kind - Connector slug.
 * @param csvText - The file's text, re-judged server-side.
 */
async function requestImport(kind: string, csvText: string): Promise<{ error: string | null }> {
  const res = await fetch('/rpc/sources/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, csv: csvText }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { error: data.error ?? 'Could not import those sources' };
  }
  return { error: null };
}

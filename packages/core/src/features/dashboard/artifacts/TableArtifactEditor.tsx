'use client';

/**
 * Editing a table artifact in place: cells, column labels, add/remove row.
 *
 * What is NOT here is as deliberate as what is. Sorting and hiding a column
 * are VIEW state — a person re-sorting to read something has not changed the
 * artifact, and writing a version for it would fill the history with
 * non-events. Only content edits (a cell, a label, a row) produce a version.
 */

import type { DataTableSpec } from '@/libs/cards/specs';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type TableDraft = DataTableSpec;

/**
 * Cell value as typed — the spec's schema accepts strings, so numbers stay strings until the person means a number.
 * @param raw
 */
function coerce(raw: string): string | number | null {
  if (raw === '') {
    return null;
  }
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim()) ? n : raw;
}

export function TableArtifactEditor({ draft, onChange, onSave, onCancel, disabled }: {
  draft: TableDraft;
  onChange: (next: TableDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const setColumnLabel = (i: number, label: string) => {
    onChange({ ...draft, columns: draft.columns.map((c, j) => (i === j ? { ...c, label } : c)) });
  };
  const setColumnType = (i: number, type: DataTableSpec['columns'][number]['type']) => {
    onChange({ ...draft, columns: draft.columns.map((c, j) => (i === j ? { ...c, type } : c)) });
  };
  const setCell = (row: number, key: string, raw: string) => {
    onChange({ ...draft, rows: draft.rows.map((r, j) => (j === row ? { ...r, [key]: coerce(raw) } : r)) });
  };
  const addRow = () => {
    onChange({ ...draft, rows: [...draft.rows, Object.fromEntries(draft.columns.map(c => [c.key, null]))] });
  };
  const removeRow = (row: number) => {
    onChange({ ...draft, rows: draft.rows.filter((_, j) => j !== row) });
  };

  // ⌘S / Esc ride on the fields themselves, not on a wrapper div: a div that
  // handles keys is a control without a role, which is exactly the thing a
  // keyboard or screen-reader user cannot find.
  const keys = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60">
            <tr>
              {draft.columns.map((c, i) => (
                <th key={c.key} className="border-b border-border px-2 py-1.5 text-left align-top">
                  <input
                    value={c.label ?? c.key}
                    disabled={disabled}
                    onChange={e => setColumnLabel(i, e.target.value)}
                    onKeyDown={keys}
                    className="w-full bg-transparent text-xs font-medium text-foreground focus:outline-none"
                    aria-label={`Column ${i + 1} name`}
                  />
                  <select
                    value={c.type ?? 'text'}
                    disabled={disabled}
                    onChange={e => setColumnType(i, e.target.value as DataTableSpec['columns'][number]['type'])}
                    onKeyDown={keys}
                    className="mt-0.5 w-full bg-transparent text-[10px] tracking-wide text-muted-foreground uppercase focus:outline-none"
                    aria-label={`Column ${i + 1} type`}
                  >
                    {(['text', 'number', 'currency', 'percent', 'date', 'badge', 'link'] as const).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </th>
              ))}
              <th className="w-8 border-b border-border" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, ri) => (
              // eslint-disable-next-line react/no-array-index-key -- rows have no stable id; a spec row IS its index
              <tr key={ri} className="hover:bg-muted/30">
                {draft.columns.map(c => (
                  <td key={c.key} className="border-b border-border/60 px-2 py-1">
                    <input
                      value={row[c.key] === null || row[c.key] === undefined ? '' : String(row[c.key])}
                      disabled={disabled}
                      onChange={e => setCell(ri, c.key, e.target.value)}
                      onKeyDown={keys}
                      className="w-full min-w-32 bg-transparent text-sm text-foreground focus:outline-none"
                      aria-label={`${c.label ?? c.key}, row ${ri + 1}`}
                    />
                  </td>
                ))}
                <td className="border-b border-border/60 px-1 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(ri)}
                    disabled={disabled}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Remove row ${ri + 1}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={addRow} disabled={disabled} className="gap-1.5">
          <Plus className="size-3.5" />
          Add row
        </Button>
        <p className="text-[11px] text-muted-foreground">⌘S saves a new version · Esc discards · sorting stays a view, not a version</p>
      </div>
    </div>
  );
}

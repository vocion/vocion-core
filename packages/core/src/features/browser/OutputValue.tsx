'use client';

/**
 * One output of a browser run, drawn as the run gave it: a list of rows as a
 * table, columns in the order the run read them off the page, numbers right
 * aligned; a list as a list; anything else as a line. The pane draws its
 * outputs with this (`BrowserRunView`), and so does the turn that asked for
 * them (`BrowserRunResult`), so the two never disagree.
 */

import { cn } from '@/utils/Helpers';

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === 'number') {
    return <>{value.toLocaleString('en-US', { maximumFractionDigits: 2 })}</>;
  }
  return <>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</>;
}

export function OutputValue({ value }: { value: unknown }) {
  if (Array.isArray(value) && value.length > 0 && value.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
    const cols = [...new Set(value.flatMap(v => Object.keys(v as object)))];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-wide text-muted-foreground uppercase">
              {cols.map(c => <th key={c} className="py-1 pr-3 font-medium">{c.replace(/_/g, ' ')}</th>)}
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              // eslint-disable-next-line react/no-array-index-key -- rows have no id of their own
              <tr key={i} className="border-b border-border/60">
                {cols.map(c => <td key={c} className={cn('py-1 pr-3 align-top', typeof (row as Record<string, unknown>)[c] === 'number' && 'text-right tabular-nums')}><Cell value={(row as Record<string, unknown>)[c]} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (Array.isArray(value)) {
    return <ul className="list-disc pl-4">{value.map((v, i) => <li key={i}><Cell value={v} /></li>)}</ul>; // eslint-disable-line react/no-array-index-key
  }
  return <p className="text-sm font-medium text-foreground"><Cell value={value} /></p>;
}

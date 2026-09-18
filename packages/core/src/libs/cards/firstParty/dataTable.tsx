'use client';

/**
 * data-table Card — rows and columns an agent rendered with `render_table`.
 *
 * Chat surface: dense, first eight rows, "+n more" tail. Canvas surface: the
 * whole table in a scroll region with a sticky header. Sorting is client-side
 * (tanstack) so a person can re-order what the agent produced without another
 * turn. Text wears text tokens; the only color is a badge tone.
 */

import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { CellValue, DataTableSpec } from '../specs';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { defineCard } from '@vocion/sdk';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/utils/Helpers';
import { dataTableSpecSchema } from '../specs';

export const DATA_TABLE_SLUG = 'data-table';

const CHAT_ROW_LIMIT = 8;

type Row = Record<string, CellValue>;

function formatCell(v: CellValue, type: DataTableSpec['columns'][number]['type']): string {
  if (v === null || v === undefined) {
    return '—';
  }
  switch (type) {
    case 'currency': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : String(v);
    }
    case 'percent': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? `${Math.round(n * 10) / 10}%` : String(v);
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n.toLocaleString() : String(v);
    }
    case 'date': {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    default:
      return typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  }
}

function isNumeric(type: DataTableSpec['columns'][number]['type']): boolean {
  return type === 'number' || type === 'currency' || type === 'percent';
}

export function DataTableCardView({ data, surface }: { data: DataTableSpec; surface: string }) {
  const dense = surface !== 'artifact';
  const [sorting, setSorting] = useState<SortingState>(
    data.sortBy ? [{ id: data.sortBy, desc: data.sortDir !== 'asc' }] : [],
  );

  const columns = useMemo<ColumnDef<Row, CellValue>[]>(() => data.columns.map(col => ({
    id: col.key,
    accessorFn: row => row[col.key] ?? null,
    header: ({ column }) => {
      const dir = column.getIsSorted();
      return (
        <button
          type="button"
          onClick={column.getToggleSortingHandler()}
          className={cn('inline-flex items-center gap-1 font-medium', isNumeric(col.type) && 'w-full justify-end')}
        >
          {col.label ?? col.key}
          {dir === 'asc' ? <ArrowUp className="size-3 opacity-60" /> : dir === 'desc' ? <ArrowDown className="size-3 opacity-60" /> : <ArrowUpDown className="size-3 opacity-30" />}
        </button>
      );
    },
    cell: ({ row, getValue }) => {
      const v = getValue();
      if (col.type === 'badge' && v !== null && v !== undefined) {
        return <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] leading-4 text-foreground/80">{String(v)}</span>;
      }
      if (col.type === 'link') {
        const href = col.hrefKey ? row.original[col.hrefKey] : null;
        const label = formatCell(v, 'text');
        return typeof href === 'string' && href
          ? <a href={href} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground" target={href.startsWith('/') ? undefined : '_blank'} rel="noreferrer">{label}</a>
          : label;
      }
      return <span className={cn(isNumeric(col.type) && 'block text-right tabular-nums')}>{formatCell(v, col.type)}</span>;
    },
    sortingFn: isNumeric(col.type) ? 'basic' : 'alphanumeric',
    sortUndefined: 'last',
  })), [data.columns]);

  const table = useReactTable({
    data: data.rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const shown = dense ? rows.slice(0, CHAT_ROW_LIMIT) : rows;
  const hidden = rows.length - shown.length;

  return (
    <figure className={cn('min-w-0', dense ? 'text-xs' : 'text-sm')}>
      {data.title && <figcaption className={cn('mb-2 font-medium text-foreground', dense ? 'text-xs' : 'text-sm')}>{data.title}</figcaption>}
      <div className={cn('overflow-auto rounded-md border border-border', !dense && 'max-h-[60vh]')}>
        <Table>
          <TableHeader className={cn('bg-muted/60 whitespace-nowrap', !dense && 'sticky top-0 z-10')}>
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id}>
                {hg.headers.map(h => (
                  <TableHead key={h.id} className={cn(dense ? 'h-8 px-2 text-[11px]' : 'h-9 px-3 text-xs', 'text-muted-foreground')}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {shown.length === 0
              ? (
                  <TableRow><TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">No rows.</TableCell></TableRow>
                )
              : shown.map(row => (
                  <TableRow key={row.id} className="hover:bg-muted/40">
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id} className={cn('whitespace-nowrap', dense ? 'px-2 py-1.5' : 'px-3 py-2')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{data.caption ?? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}</span>
        {hidden > 0 && (
          <span>
            +
            {hidden}
            {' '}
            more on the canvas
          </span>
        )}
      </div>
    </figure>
  );
}

export const dataTableCard = defineCard({
  slug: DATA_TABLE_SLUG,
  name: 'Data table',
  description: 'Renders rows and typed columns (text, number, currency, percent, date, badge, link) as a sortable table. Use for any list the agent assembled — open deals, runs, contacts — where a person wants to scan and re-sort. Chat shows the first eight rows; the canvas shows all of them.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: dataTableSpecSchema,
  Renderer: ({ data, surface }) => <DataTableCardView data={data} surface={surface} />,
});

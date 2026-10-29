/**
 * The table spec — rows and columns, as `render_table` makes them and the
 * table card draws them. A module of its own so the dashboard spec can hold
 * a table without importing the card registry's specs (`./specs`).
 */

import { z } from 'zod';

/** A cell value. Dates arrive as ISO strings; the table formats by column type. */
export const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type CellValue = z.infer<typeof cellValueSchema>;

export const dataTableSpecSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.object({
    key: z.string().min(1),
    label: z.string().optional(),
    /** Drives alignment + formatting. `href` renders the cell as a link to another column's URL. */
    type: z.enum(['text', 'number', 'currency', 'percent', 'date', 'badge', 'link']).optional(),
    /** For `link` columns: the key of the column that holds the URL. */
    hrefKey: z.string().optional(),
  })).min(1).max(24),
  rows: z.array(z.record(z.string(), cellValueSchema)).max(2000),
  caption: z.string().optional(),
  /** Column key to sort by initially. */
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});
export type DataTableSpec = z.infer<typeof dataTableSpecSchema>;

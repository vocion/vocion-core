import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import type { PageField, PagePrimary, PageRow, PageRowAction, TableLayout } from '@/libs/workspace/pageFields';
import { Badge } from '@/components/ui/badge';
import { LinkRow } from '@/features/dashboard/LinkRow';
import { FieldValue } from '@/features/dashboard/pages/FieldValue';
import { computeTotals, fieldAlign, interpolateHref, isEmptyValue, priorityClass, resolveField, resolveRowActionHref, tableLayout } from '@/libs/workspace/pageFields';

/**
 * One table of a list page's rows.
 *
 * The Factory floor declared fourteen columns and at 1440px the title wrapped
 * to four lines while the pull request and the date fell off the right edge.
 * So a row here leads with ONE wide column — the thing the page is about,
 * never truncated, pinned while the rest scrolls — and reads its secondary
 * facts as a muted second line. A fact that is the same on every visible row
 * is said once above the table instead of once per row, figures share a right
 * edge, and a column declares how hard it is holding on (`priority`) so a
 * phone drops the least important first rather than clipping everything.
 */

/**
 * The columns this table collapsed because every row said the same thing.
 * @param root0 - Props.
 * @param root0.constants - What {@link tableLayout} found constant.
 */
function ConstantLine({ constants }: { constants: TableLayout['constants'] }) {
  if (constants.length === 0) {
    return null;
  }
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="constant-line">
      {constants.map(({ field, value }, i) => (
        <span key={field.key} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
          <span>{field.label ?? field.key}</span>
          <span className="font-mono text-foreground">{String(value)}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * The evidence a row keeps out of its columns, one disclosure per row.
 *
 * Native `<details>`, so it costs no client JavaScript and a row that is
 * being investigated opens where it sits rather than navigating away from
 * the timeline it was read in. Empty fields are left out rather than drawn as
 * dashes: a run that finished yesterday has no live lease, and a row of
 * dashes is a worse answer than no row.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.details - The fields marked `detail`.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by key.
 */
function RowDetails({ row, details, now, links }: { row: PageRow; details: PageField[]; now: number; links?: LinkMap }) {
  const present = details.filter(f => !isEmptyValue(resolveField(row, f.from ?? f.key)));
  if (present.length === 0) {
    return null;
  }
  return (
    <details className="group/details mt-1" data-testid="row-details">
      <summary className="cursor-pointer list-none text-xs text-muted-foreground underline-offset-2 hover:underline">
        <span className="group-open/details:hidden">Evidence</span>
        <span className="hidden group-open/details:inline">Hide evidence</span>
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l-2 border-border pl-3 text-xs">
        {present.map(f => (
          <div key={f.key} className="contents">
            <dt className="text-muted-foreground">{f.label ?? f.key}</dt>
            <dd className="min-w-0 break-words text-foreground">
              <FieldValue row={row} field={f} now={now} links={links} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * The total under a table: each `total` column's sum in its own cell, the
 * word in the first column that is not one, the rest empty. On a grouped
 * page it sits under every group, so a group is read with its cumulative
 * figure.
 * @param root0 - Props.
 * @param root0.rows - The rows under this table.
 * @param root0.fields - Every declared field, so a column collapsed into the
 * line above the table is still summed.
 * @param root0.layout - The drawn layout.
 * @param root0.extra - 1 when the row carries a trailing chevron cell.
 */
function TotalsRow({ rows, fields, layout, extra }: { rows: PageRow[]; fields: PageField[]; layout: TableLayout; extra: number }) {
  const totals = computeTotals(rows, fields);
  const labelKey = layout.columns.find(f => !f.total)?.key;
  return (
    <tfoot>
      <tr className="border-t border-border bg-muted/40">
        {layout.primary && (
          <td className="sticky left-0 z-10 bg-muted/40 px-4 py-2 text-xs">
            <span className="font-medium text-muted-foreground">Total</span>
          </td>
        )}
        {layout.columns.map(f => (
          <td key={f.key} className={`px-4 py-2 text-xs ${priorityClass(f.priority)} ${fieldAlign(f) === 'right' ? 'text-right' : ''}`}>
            {f.key in totals
              ? <span className="font-mono text-sm font-semibold tabular-nums">{totals[f.key]}</span>
              : !layout.primary && f.key === labelKey
                  ? <span className="font-medium text-muted-foreground">Total</span>
                  : null}
          </td>
        ))}
        {extra > 0 && <td />}
      </tr>
    </tfoot>
  );
}

/**
 * A list page's table — the layout is computed from the rows themselves, so
 * a grouped page can collapse a column inside one group and keep it in
 * another.
 * @param root0 - Props.
 * @param root0.rowActionsAs
 * @param root0.omitConstants
 * @param root0.rows - The rows under this table, filtered and sorted.
 * @param root0.fields - The page's declared fields.
 * @param root0.primary - The page's `primary` block, if it declared one.
 * @param root0.rowLink - Where a row opens, with `{id}` interpolated.
 * @param root0.rowActions - Trailing links on each row, interpolated the same way.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by key.
 * @param root0.groupLabel - The group heading, on a grouped page.
 * @param root0.id - DOM id for the section.
 */
export function PageTable({ rows, fields, primary, rowLink, rowActions = [], now, links, groupLabel, id }: {
  /** Accepted for parity with `PageBlocks`; a table draws its actions as a column either way. */
  rowActionsAs?: 'links' | 'menu';
  /** Accepted for parity with `PageBlocks`. */
  omitConstants?: string[];
  rows: PageRow[];
  fields: PageField[];
  primary?: PagePrimary;
  rowLink?: string;
  rowActions?: PageRowAction[];
  now: number;
  links?: LinkMap;
  groupLabel?: string | null;
  id?: string;
}) {
  const layout = tableLayout(rows, fields, primary);
  const span = layout.columns.length + (layout.primary ? 1 : 0) + rowActions.length + (rowLink ? 1 : 0);
  const hasTotals = fields.some(f => f.total);

  return (
    <section id={id} className="@container mb-8">
      {groupLabel && (
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          {groupLabel}
          <Badge variant="outline">{rows.length}</Badge>
        </h2>
      )}
      <ConstantLine constants={layout.constants} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {layout.primary && (
                <th scope="col" className="sticky left-0 z-10 w-[55%] min-w-64 bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
                  {layout.primary.label ?? layout.primary.key}
                </th>
              )}
              {layout.columns.map(f => (
                <th
                  key={f.key}
                  scope="col"
                  className={`px-4 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground ${priorityClass(f.priority)} ${fieldAlign(f) === 'right' ? 'text-right' : ''}`}
                >
                  {f.label ?? f.key}
                </th>
              ))}
              {rowActions.map(a => (
                <th key={a.label} scope="col" className="px-2 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground">{a.label}</th>
              ))}
              {rowLink && <th className="w-8 px-2 py-2" aria-label="Open" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={span} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing here yet.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const cells = [
                layout.primary
                  ? (
                      <td key="__primary" className="sticky left-0 z-10 w-[55%] min-w-64 bg-background px-4 py-2.5 group-hover:bg-muted/40">
                        <div className="text-sm font-medium text-foreground">
                          <FieldValue row={row} field={layout.primary} now={now} links={links} />
                        </div>
                        {layout.subtitle.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                            {layout.subtitle
                              .filter(f => !isEmptyValue(resolveField(row, f.from ?? f.key)))
                              .map((f, i) => (
                                <span key={f.key} className="flex items-center gap-1.5">
                                  {i > 0 && <span aria-hidden className="text-muted-foreground/50">·</span>}
                                  <FieldValue row={row} field={f} now={now} links={links} />
                                </span>
                              ))}
                          </div>
                        )}
                        <RowDetails row={row} details={layout.details} now={now} links={links} />
                      </td>
                    )
                  : null,
                ...layout.columns.map(f => (
                  <td key={f.key} className={`px-4 py-2.5 ${priorityClass(f.priority)} ${fieldAlign(f) === 'right' ? 'text-right' : ''}`}>
                    <FieldValue row={row} field={f} now={now} links={links} />
                  </td>
                )),
                // Row actions sit inside the row link's cells, so a row with
                // a click-through still reaches a second place; the anchor
                // stops the row's own navigation (see LinkRow).
                ...rowActions.map((a) => {
                  const href = resolveRowActionHref(row, a.href);
                  return (
                    <td key={`__action-${a.label}`} className="px-2 py-2.5">
                      {href
                        // A plain anchor, the way a `link` field renders one:
                        // next-intl's Link would make every table a client
                        // component for a href the middleware already localises.
                        ? <a href={href} className="text-xs whitespace-nowrap underline underline-offset-2">{a.label}</a>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  );
                }),
              ].filter(c => c !== null);
              const href = rowLink ? interpolateHref(row, rowLink) : null;
              return href
                ? (
                    <LinkRow key={row.id} href={href}>
                      {cells}
                    </LinkRow>
                  )
                : (
                    <tr key={row.id} className="group border-b border-border/60 last:border-0 hover:bg-muted/30">
                      {cells}
                    </tr>
                  );
            })}
          </tbody>
          {hasTotals && rows.length > 0 && (
            <TotalsRow rows={rows} fields={fields} layout={layout} extra={rowActions.length + (rowLink ? 1 : 0)} />
          )}
        </table>
      </div>
    </section>
  );
}

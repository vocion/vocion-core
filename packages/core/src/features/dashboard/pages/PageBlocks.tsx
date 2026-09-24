import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import type { PageField, PagePrimary, PageRow, PageRowAction, TableLayout } from '@/libs/workspace/pageFields';
import { Badge } from '@/components/ui/badge';
import { FieldValue } from '@/features/dashboard/pages/FieldValue';
import { fieldIsEmptyOn, interpolateHref, resolveRowActionHref, tableLayout } from '@/libs/workspace/pageFields';
import { RowMenu } from './RowMenu';

/**
 * A list page's rows drawn as BLOCKS rather than as a grid: `layout: block`.
 *
 * A table compares rows down a column, and that is the right shape when
 * there are thirty of them and the question is which is the biggest. It is
 * the wrong shape for a portfolio: two products in fourteen columns is a
 * horizontal scrollbar, a header row the reader keeps looking back up at,
 * and a dash in every cell one product has no answer for.
 *
 * So a block leads with the headline and its status, reads its muted second
 * line underneath, and then carries the rest as labelled facts that wrap to
 * the width available. A label travels with its value, so nothing has to be
 * matched back to a header, and a fact this row does not have is simply not
 * drawn, so a sparse row is SHORT here where in a table it was gappy.
 */

/**
 * The facts a block draws for one row: the layout's columns, minus the ones
 * this particular row has nothing for.
 * @param row - The row.
 * @param columns - The fields that survived the page-level layout.
 * @param now - The instant `staleAfterHours` is measured against.
 */
function factsFor(row: PageRow, columns: PageField[], now: number): PageField[] {
  return columns.filter(f => !fieldIsEmptyOn(row, f, now));
}

/**
 * The facts said once above the blocks because every row said them.
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
 * The picture that leads a block, or the space one would have taken.
 *
 * An empty slot rather than no slot: this is a GRID, and a card whose text
 * starts at a different left edge from the one beside it costs more to read
 * than a hole costs to look at. The hole is also the honest drawing of a row
 * nothing has been recorded about, which is the only way to be in it.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.field - The field holding the image URL.
 * @param root0.now - The instant a `relative` value is measured against.
 */
function Thumb({ row, field, now }: { row: PageRow; field: PageField; now: number }) {
  // On a phone the picture sits ABOVE the words at the card's full width;
  // beside them from a medium container up. An empty frame beside the title
  // is honest on a desktop and a third of the row on a phone (Chris,
  // 2026-09-24: the card overflowed the screen), so a narrow card draws the
  // frame only when there is a picture to put in it.
  if (field.format === 'icon') {
    // A mark, not a picture: a small tile beside the title at every width.
    return (
      <span className="block size-12 shrink-0 overflow-hidden rounded-lg border border-border">
        <FieldValue row={row} field={field} now={now} />
      </span>
    );
  }
  if (fieldIsEmptyOn(row, field, now)) {
    return <span aria-hidden className="hidden h-20 w-32 shrink-0 rounded border border-dashed border-border @md:block" />;
  }
  return (
    <span className="block aspect-[8/5] w-full overflow-hidden rounded border border-border @md:h-20 @md:w-32 @md:shrink-0">
      <FieldValue row={row} field={field} now={now} />
    </span>
  );
}

/**
 * One row as a block.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.layout - The computed layout, shared by every block.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by key.
 * @param root0.href - Where the block opens, already interpolated.
 * @param root0.rowActions - Trailing links, interpolated per row.
 * @param root0.rowActionsAs
 */
function Block({ row, layout, now, links, href, rowActions, rowActionsAs }: {
  row: PageRow;
  layout: TableLayout;
  now: number;
  links?: LinkMap;
  href: string | null;
  rowActions: PageRowAction[];
  rowActionsAs: 'links' | 'menu';
}) {
  const menu = rowActionsAs === 'menu';
  const menuItems = menu
    ? rowActions.flatMap((a) => {
        const to = resolveRowActionHref(row, a.href);
        return to ? [{ label: a.label, href: to }] : [];
      })
    : [];
  // Status reads beside the name, not in a column of its own: "Send ·
  // dogfood · healthy" is the line a person came for.
  const badges = layout.subtitle.filter(f => f.format === 'badge');
  const rest = layout.subtitle.filter(f => f.format !== 'badge');
  const facts = factsFor(row, layout.columns, now);
  const body = (
    <>
      {/* The headline and its state, on one line that does NOT wrap between
          them. They used to share a `flex-wrap` row, so where the badge
          landed depended on how long the title was — under the title on a
          long one, beside it on a short one, and a column of rows that each
          put their status somewhere different is a column you cannot scan.
          The title takes the space it can (`min-w-0`) and wraps inside
          itself; the badges hold the top right on every row. */}
      <div className="flex flex-col gap-1 @md:flex-row @md:items-start @md:justify-between @md:gap-x-3">
        <span className="min-w-0 text-base font-semibold text-foreground">
          {layout.primary
            ? <FieldValue row={row} field={layout.primary} now={now} links={links} />
            : row.title}
        </span>
        {badges.some(f => !fieldIsEmptyOn(row, f, now)) && (
          <span className="flex flex-wrap items-center gap-1.5 @md:shrink-0">
            {badges.filter(f => !fieldIsEmptyOn(row, f, now)).map(f => (
              <FieldValue key={f.key} row={row} field={f} now={now} links={links} />
            ))}
          </span>
        )}
      </div>
      {rest.some(f => !fieldIsEmptyOn(row, f, now)) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {/* The separator TRAILS its fact rather than leading the next one.
              Led, it wrapped onto the start of a new line as a stray "·"
              floating before the value it was meant to divide. */}
          {rest.filter(f => !fieldIsEmptyOn(row, f, now)).map((f, i, drawn) => (
            <span key={f.key} className="flex items-center gap-1.5">
              <FieldValue row={row} field={f} now={now} links={links} />
              {i < drawn.length - 1 && <span aria-hidden className="text-muted-foreground/50">·</span>}
            </span>
          ))}
        </div>
      )}
      {facts.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          {facts.map(f => (
            <div key={f.key} className="min-w-0">
              <dt className="text-[0.6875rem] tracking-wide text-muted-foreground uppercase">{f.label ?? f.key}</dt>
              <dd className="mt-0.5 text-sm">
                <FieldValue row={row} field={f} now={now} links={links} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!menu && rowActions.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-4 text-xs">
          {rowActions.map((a) => {
            const to = resolveRowActionHref(row, a.href);
            return to
              ? <a key={a.label} href={to} className="underline underline-offset-2">{a.label}</a>
              : null;
          })}
        </p>
      )}
    </>
  );
  // The picture leads, and the words sit beside it rather than under it: a
  // thumbnail above the headline pushes every row's title down by its own
  // height, and a column of titles that do not start at the same place is a
  // column nobody can scan. `shrink-0` because the drawing has one size —
  // it is 128 by 80 and letting the grid squeeze it would distort the one
  // thing on the card that is meant to be read as a shape.
  const inner = layout.thumb === null
    ? body
    : (
        <div className={layout.thumb.format === 'icon' ? 'flex items-start gap-3' : 'flex flex-col gap-3 @md:flex-row @md:items-start'}>
          <Thumb row={row} field={layout.thumb} now={now} />
          <div className={`min-w-0 flex-1 ${menuItems.length > 0 ? 'pr-8' : ''}`}>{body}</div>
        </div>
      );
  const className = 'block min-w-0 overflow-hidden rounded-lg border border-border bg-background p-4 text-left';
  const card = href
    ? <a href={href} className={`${className} transition-colors hover:bg-muted/40`}>{inner}</a>
    : <div className={className}>{inner}</div>;
  // The menu sits OUTSIDE the anchor — a button inside a link is a tap that
  // does two things — at the card's corner, over the room the body left it.
  return menuItems.length > 0
    ? (
        <div className="relative min-w-0">
          {card}
          <div className="absolute top-2 right-2">
            <RowMenu items={menuItems} label={`More about ${row.title}`} />
          </div>
        </div>
      )
    : card;
}

/**
 * One group of a list page's rows, as blocks.
 * @param root0 - Props.
 * @param root0.rows - The rows under this group, filtered and sorted.
 * @param root0.fields - The page's declared fields.
 * @param root0.primary - The page's `primary` block, if it declared one.
 * @param root0.rowLink - Where a block opens, with `{id}` interpolated.
 * @param root0.rowActions - Trailing links on each block.
 * @param root0.rowActionsAs
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by key.
 * @param root0.groupLabel - The group heading, on a grouped page.
 * @param root0.id - DOM id for the section.
 */
export function PageBlocks({ rows, fields, primary, rowLink, rowActions = [], rowActionsAs = 'links', now, links, groupLabel, id }: {
  rows: PageRow[];
  fields: PageField[];
  primary?: PagePrimary;
  rowLink?: string;
  rowActions?: PageRowAction[];
  rowActionsAs?: 'links' | 'menu';
  now: number;
  links?: LinkMap;
  groupLabel?: string | null;
  id?: string;
}) {
  const layout = tableLayout(rows, fields, primary, now);
  return (
    <section id={id} className="@container mb-8">
      {groupLabel && (
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          {groupLabel}
          <Badge variant="outline">{rows.length}</Badge>
        </h2>
      )}
      <ConstantLine constants={layout.constants} />
      {rows.length === 0
        ? (
            <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
          )
        : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @3xl:grid-cols-2">
              {rows.map(row => (
                <Block
                  key={row.id}
                  row={row}
                  layout={layout}
                  now={now}
                  links={links}
                  href={rowLink ? interpolateHref(row, rowLink) : null}
                  rowActions={rowActions}
                  rowActionsAs={rowActionsAs}
                />
              ))}
            </div>
          )}
    </section>
  );
}

import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import type { PageField, PagePrimary, PageRow, PageRowAction, TableLayout } from '@/libs/workspace/pageFields';
import { PendingIcon } from '@/components/patterns/PendingIcon';
import { Badge } from '@/components/ui/badge';
import { FieldValue } from '@/features/dashboard/pages/FieldValue';
import { Link } from '@/libs/I18nNavigation';
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
/**
 * The picture, or the mark in its place — a full-height strip on the card's
 * LEFT EDGE at every width (Chris, 2026-09-24: "the thumbnail should be full
 * height and left edge of the card"). A picture fills the strip; a named
 * icon (`thumbFallback`) sits centred in it; a row with neither draws no
 * strip at all — never an empty frame.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.field - The picture field.
 * @param root0.fallback - The icon field drawn when the picture is missing.
 * @param root0.now - The instant a `relative` value is measured against.
 */
function Thumb({ row, field, fallback, now }: { row: PageRow; field: PageField | null; fallback: PageField | null; now: number }) {
  const picture = field && field.format !== 'icon' && !fieldIsEmptyOn(row, field, now) ? field : null;
  const mark = picture ? null : (field?.format === 'icon' && !fieldIsEmptyOn(row, field, now) ? field : fallback && !fieldIsEmptyOn(row, fallback, now) ? fallback : null);
  if (!picture && !mark) {
    return null;
  }
  return (
    <span className="flex w-20 shrink-0 self-stretch overflow-hidden border-r border-border bg-muted @md:w-28" data-testid={picture ? 'block-thumb' : 'block-mark'}>
      <FieldValue row={row} field={picture ?? mark!} now={now} />
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
      {/* The headline alone on its line; the state leads the line under it as
          the first chip, so a card never spends a whole row on one word
          (phone, 2026-09-24). On a wide card the badges still hold the right. */}
      <div className="flex flex-col gap-1 @md:flex-row @md:items-start @md:justify-between @md:gap-x-3">
        <span className="min-w-0 text-base font-semibold text-foreground">
          {layout.primary
            ? <FieldValue row={row} field={layout.primary} now={now} links={links} />
            : row.title}
        </span>
        {badges.some(f => !fieldIsEmptyOn(row, f, now)) && (
          <span className="hidden items-center gap-1.5 @md:flex @md:shrink-0">
            {badges.filter(f => !fieldIsEmptyOn(row, f, now)).map(f => (
              <FieldValue key={f.key} row={row} field={f} now={now} links={links} />
            ))}
          </span>
        )}
      </div>
      {(rest.some(f => !fieldIsEmptyOn(row, f, now)) || badges.some(f => !fieldIsEmptyOn(row, f, now))) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {badges.filter(f => !fieldIsEmptyOn(row, f, now)).map(f => (
            <span key={f.key} className="flex items-center gap-1.5 @md:hidden">
              <FieldValue row={row} field={f} now={now} links={links} />
              <span aria-hidden className="text-muted-foreground/50">·</span>
            </span>
          ))}
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
  const inner = layout.thumb === null && layout.thumbFallback === null
    ? <div className="p-4">{body}</div>
    : (
        <div className="flex items-stretch">
          <Thumb row={row} field={layout.thumb} fallback={layout.thumbFallback} now={now} />
          <div className={`min-w-0 flex-1 p-4 ${menuItems.length > 0 ? 'pr-8' : ''}`}>{body}</div>
        </div>
      );
  const className = 'block min-w-0 overflow-hidden rounded-lg border border-border bg-background text-left';
  // A real `<Link>`, not an anchor: it is prefetched as it scrolls into view
  // and its own transition is readable, so the tap is acknowledged at once —
  // the card dims and a corner spinner appears — before the new page has
  // rendered a thing (backlog 013). `active:` answers the finger itself.
  const card = href
    ? (
        <Link href={href} className={`${className} relative transition-colors hover:bg-muted/40 active:bg-muted/60 has-[[data-link-pending]]:opacity-60`}>
          {inner}
          <PendingIcon className={`absolute top-3 size-4 text-muted-foreground ${menuItems.length > 0 ? 'right-10' : 'right-3'}`} />
        </Link>
      )
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
 * @param root0.omitConstants
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by key.
 * @param root0.groupLabel - The group heading, on a grouped page.
 * @param root0.id - DOM id for the section.
 */
export function PageBlocks({ rows, fields, primary, rowLink, rowActions = [], rowActionsAs = 'links', omitConstants = [], now, links, groupLabel, id }: {
  rows: PageRow[];
  fields: PageField[];
  primary?: PagePrimary;
  rowLink?: string;
  rowActions?: PageRowAction[];
  rowActionsAs?: 'links' | 'menu';
  /** Fields (by `from` path) whose constant value the page already states — a URL filter — so the constant line does not say it twice. */
  omitConstants?: string[];
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
      <ConstantLine constants={layout.constants.filter(c => !omitConstants.includes(c.field.from ?? c.field.key))} />
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

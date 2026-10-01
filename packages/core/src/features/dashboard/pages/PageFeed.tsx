import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import type { PageFeed as PageFeedConfig, PageField, PagePrimary, PageRow } from '@/libs/workspace/pageFields';
import { LedgerEntry, LedgerGroup, RecordCode } from '@/components/patterns';
import { FieldValue } from '@/features/dashboard/pages/FieldValue';
import { Link } from '@/libs/I18nNavigation';
import { fieldIsEmptyOn, interpolateHref, resolveField } from '@/libs/workspace/pageFields';

/**
 * A list page's rows as a FEED: `layout: feed`.
 *
 * The Ledger pattern (`components/patterns/Ledger`, `docs/design/patterns.md`
 * § Ledger) over a page's rows: a day heading with its count, then one entry
 * per row — the title that opens the row's own page, a muted aside beside
 * it, the detail line, the state at the right, one sentence, one muted line
 * of evidence, and a line that needs a person only on the rows that have one.
 *
 * It exists because Releases is read as a log of what happened, one day at a
 * time. As a table it put a sha, a deploy URL and a cost in every row; as
 * blocks it put each release in a card. Neither said what changed.
 */

function drawn(row: PageRow, field: PageField | undefined, now: number): field is PageField {
  return field !== undefined && !fieldIsEmptyOn(row, field, now);
}

/**
 * A field's value at the entry's own type size: plain text inherits it, so a
 * detail line reads at 12px rather than at the table cell's 14px; every other
 * format keeps the one formatting layer.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.field - The field.
 * @param root0.now - The clock.
 * @param root0.links - Resolved record references.
 */
function FeedValue({ row, field, now, links }: { row: PageRow; field: PageField; now: number; links?: LinkMap }) {
  if (field.format === 'text') {
    const v = resolveField(row, field.from ?? field.key);
    return <span>{Array.isArray(v) ? v.map(String).join(', ') : String(v)}</span>;
  }
  return <FieldValue row={row} field={field} now={now} links={links} />;
}

/**
 * One group of a list page's rows, as a feed.
 * @param root0 - Props.
 * @param root0.rows - The rows under this group, filtered and sorted.
 * @param root0.fields - The page's declared fields.
 * @param root0.primary - The page's `primary` block.
 * @param root0.feed - The page's `feed` block.
 * @param root0.rowLink - Where a row's title opens, with `{id}` interpolated.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by key.
 * @param root0.groupLabel - The group heading — the day.
 * @param root0.id - DOM id for the section.
 */
export function PageFeed({ rows, fields, primary, feed, rowLink, now, links, groupLabel, id }: {
  rows: PageRow[];
  fields: PageField[];
  primary?: PagePrimary;
  feed?: PageFeedConfig;
  rowLink?: string;
  now: number;
  links?: LinkMap;
  groupLabel?: string | null;
  id?: string;
}) {
  const byKey = (k: string | undefined) => (k === undefined ? undefined : fields.find(f => f.key === k));
  const lead = byKey(primary?.field);
  const sub = (primary?.subtitle ?? []).map(byKey).filter((f): f is PageField => f !== undefined);
  const badges = sub.filter(f => f.format === 'badge');
  const detail = sub.filter(f => f.format !== 'badge');
  const aside = (feed?.aside ?? []).map(byKey).filter((f): f is PageField => f !== undefined);
  const lines = (feed?.lines ?? []).map(byKey).filter((f): f is PageField => f !== undefined);
  const summary = byKey(feed?.summary);
  const note = byKey(feed?.note);

  return (
    <section id={id} data-testid="page-feed">
      <LedgerGroup label={groupLabel ?? 'All'} count={rows.length}>
        {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nothing here yet.</p>}
        {rows.map((row) => {
          const href = rowLink ? interpolateHref(row, rowLink) : null;
          const named = lead ? <FeedValue row={row} field={lead} now={now} links={links} /> : row.title;
          const title = row.code
            ? (
                <>
                  {named}
                  {' '}
                  <RecordCode code={row.code} className="text-xs" />
                </>
              )
            : named;
          const shownLines = lines.filter(f => drawn(row, f, now));
          const summaryText = drawn(row, summary, now) ? String(resolveField(row, summary.from ?? summary.key)) : null;
          return (
            <LedgerEntry
              key={row.id}
              data-testid="feed-entry"
              title={href ? <Link href={href} className="hover:underline hover:underline-offset-2">{title}</Link> : title}
              when={aside.some(f => drawn(row, f, now))
                ? (
                    <span className="font-mono">
                      {aside.filter(f => drawn(row, f, now)).map(f => <FeedValue key={f.key} row={row} field={f} now={now} links={links} />)}
                    </span>
                  )
                : undefined}
              detail={detail.some(f => drawn(row, f, now))
                ? (
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      {detail.filter(f => drawn(row, f, now)).map((f, i, all) => (
                        <span key={f.key} className="flex items-center gap-1.5">
                          <FeedValue row={row} field={f} now={now} links={links} />
                          {i < all.length - 1 && <span aria-hidden className="text-muted-foreground/50">·</span>}
                        </span>
                      ))}
                    </span>
                  )
                : undefined}
              state={badges.some(f => drawn(row, f, now))
                ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {badges.filter(f => drawn(row, f, now)).map(f => <FieldValue key={f.key} row={row} field={f} now={now} links={links} />)}
                    </span>
                  )
                : undefined}
              summary={summaryText}
              human={shownLines.length > 0 || drawn(row, note, now)
                ? (
                    <div className="space-y-1">
                      {shownLines.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-1.5">
                          {shownLines.map((f, i) => (
                            <span key={f.key} className="flex items-center gap-1.5">
                              <FeedValue row={row} field={f} now={now} links={links} />
                              {i < shownLines.length - 1 && <span aria-hidden className="text-muted-foreground/50">·</span>}
                            </span>
                          ))}
                        </div>
                      )}
                      {drawn(row, note, now) && (
                        <p className="font-medium text-[var(--brand-borderline)]" data-testid="feed-note">
                          {String(resolveField(row, note.from ?? note.key))}
                        </p>
                      )}
                    </div>
                  )
                : undefined}
            />
          );
        })}
      </LedgerGroup>
    </section>
  );
}

'use client';

import type { Fact } from './DetailPage';
import type { RelatedItem } from '@/libs/workspace/related';
import { Link } from '@/libs/I18nNavigation';
import { groupRelated } from '@/libs/workspace/related';
import { FactList } from './DetailPage';
import { OpenInPreview } from './OpenInPreview';

/**
 * RELATED — what a record is connected to, as the patterns' fact rows (Chris,
 * 2026-09-30). One row per relation ("Started in chat", "Plan", "Engineering
 * runs"), each item a link to its full page with "Open in preview" beside it
 * (`OpenInPreview`: on hover, always on touch). An item that lives outside
 * Vocion — a pull request — opens in a new tab and has no preview.
 *
 * The items come from one read (`services/objects/related.relatedOf`) that a
 * type's declaration drives; this draws them and knows no type. A page that
 * has more facts of its own composes {@link relatedFacts} into its FactList
 * rather than drawing a second list beside it.
 */

const LINK = 'underline decoration-border underline-offset-2 hover:decoration-foreground';

function ItemLink({ item }: { item: RelatedItem }) {
  const inner = <span data-testid="related-link">{item.title}</span>;
  if (!item.href) {
    return inner;
  }
  return item.external
    ? <a href={item.href} target="_blank" rel="noopener noreferrer" className={LINK} data-related-kind={item.kind}>{inner}</a>
    : <Link href={item.href} className={LINK} data-related-kind={item.kind}>{inner}</Link>;
}

function Item({ item, action }: { item: RelatedItem; action: boolean }) {
  const line = (
    <span className="group/row inline-flex min-w-0 items-center gap-1.5" data-related-item={item.key}>
      <ItemLink item={item} />
      {item.note && <span className="text-[12px] text-muted-foreground">{item.note}</span>}
      {action && item.preview && <OpenInPreview recordRef={item.preview} label={`Open ${item.title} in preview`} />}
    </span>
  );
  if (!item.details || item.details.length === 0) {
    return line;
  }
  return (
    <span className="flex min-w-0 flex-col">
      {line}
      <span className="text-[12px] break-words text-muted-foreground" data-testid="related-details">{item.details.join(' · ')}</span>
    </span>
  );
}

/**
 * A stored value that disagrees with the records the row reads, said under the row.
 * @param root0
 * @param root0.items
 */
function Drift({ items }: { items: readonly RelatedItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <span className="mt-1 flex flex-col gap-0.5" data-testid="related-drift">
      {items.map(d => <span key={d.key} className="text-[12px] break-words text-brand-borderline">{d.title}</span>)}
    </span>
  );
}

/**
 * The fact rows for a list of related items, one per relation. A relation of
 * one item carries its preview as the row's action; a relation of several
 * carries one beside each item.
 * @param items - From `relatedOf`.
 */
export function relatedFacts(items: readonly RelatedItem[]): Fact[] {
  return groupRelated(items).map((g) => {
    const shown = g.items.filter(i => i.kind !== 'drift');
    const drift = g.items.filter(i => i.kind === 'drift');
    const one = shown.length === 1 ? shown[0]! : null;
    // Records that say something under their link stack; bare links wrap.
    const stacked = shown.some(i => (i.details?.length ?? 0) > 0);
    return {
      key: `related:${g.relation}`,
      label: g.label,
      preview: one?.preview ?? null,
      value: (
        <>
          {one
            ? <Item item={one} action={false} />
            : (
                <span className={stacked ? 'flex flex-col gap-1.5' : 'flex flex-wrap gap-x-3 gap-y-1'}>
                  {shown.map(i => <Item key={i.key} item={i} action />)}
                </span>
              )}
          <Drift items={drift} />
        </>
      ),
    };
  });
}

/**
 * The block: the related items as fact rows, or nothing when there are none.
 * @param props
 * @param props.items - From `relatedOf`.
 * @param props.layout - Rows (the content column) or a column (a narrow rail, the pane).
 * @param props.className - Extra classes.
 */
export function Related({ items, layout = 'rows', className }: { items: readonly RelatedItem[]; layout?: 'rows' | 'column'; className?: string }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div data-pattern="related" data-testid="related" className={className}>
      <FactList facts={relatedFacts(items)} layout={layout} />
    </div>
  );
}

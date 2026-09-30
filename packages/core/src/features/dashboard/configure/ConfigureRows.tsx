'use client';

import type { ConfigureRow } from './configurePlan';
import type { ColumnKind } from '@/components/patterns';
import { useMemo } from 'react';
import { Column, ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { toneToStatus } from '@/features/dashboard/pages/FieldValue';
import { usePreviewList } from '@/features/preview/usePreviewList';

/**
 * One Configure tab's rows — hairline list rows through the one `ListRow`,
 * each a door to where the thing it names is edited.
 *
 * A row that names a record the preview pane can show (a seat is an agent)
 * PREVIEWS on a plain click and stays a real link for ⌘-click, a new tab or a
 * copied address: the list is one a person scans to choose from, which is
 * the reference case in `docs/design/patterns.md` § *A row is a reference, or
 * it is the task*. `j`/`k` walk the rows with the preview following.
 *
 * Seam: when `components/patterns` grows a row preview action (open in the
 * pane from a hover control), it replaces the `onSelect` below and nothing
 * else here changes — `row.preview` already says what a row opens.
 * @param props
 * @param props.rows - The tab's rows, in order.
 * @param props.empty - What the tab says when it has none.
 * @param props.figure - The width convention of the right-hand figure.
 * @param props.figureAlways - Keep the figure on a phone (a measure's value is the point of its row).
 */
export function ConfigureRows(props: { rows: ConfigureRow[]; empty: string; figure: ColumnKind; figureAlways?: boolean }) {
  const previewable = useMemo(
    () => props.rows.flatMap(r => (r.preview ? [{ ref: r.preview, href: r.href }] : [])),
    [props.rows],
  );
  const preview = usePreviewList(previewable);
  if (props.rows.length === 0) {
    return <ListEmpty variant="inline" title={props.empty} />;
  }
  return (
    <ListRows>
      {props.rows.map((row) => {
        const at = row.preview ? previewable.findIndex(p => p.ref.id === row.preview!.id) : -1;
        return (
          <ListRow
            key={row.id}
            data-testid={`configure-row-${row.id}`}
            href={row.href}
            onSelect={at >= 0 ? () => preview.select(at) : undefined}
            selected={at >= 0 && preview.selected === at}
            title={row.title}
            subline={<Subline segments={row.facts} separator="·" />}
            columns={row.figure !== null ? <Column kind={props.figure} always={props.figureAlways}>{row.figure}</Column> : undefined}
            chip={row.chip ? <StatusPill status={toneToStatus(row.chip.tone)} label={row.chip.label} size="sm" /> : undefined}
          />
        );
      })}
    </ListRows>
  );
}

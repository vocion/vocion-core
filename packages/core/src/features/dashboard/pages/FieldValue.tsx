import type React from 'react';
import type { PageField, PageRow } from '@/libs/workspace/pageFields';
import { createElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { iconByName } from '@/features/dashboard/iconByName';
import { relativeLabel } from '@/libs/timeAgo';
import { fieldHasSource, fieldIsFresh, formatDuration, formatMoney, formatProgress, isEmptyValue, resolveField, shortUrlLabel, toDate } from '@/libs/workspace/pageFields';

/**
 * ONE formatting layer for a declared field, wherever it is read.
 *
 * A `money` figure, a `badge` tone, a `relative` timestamp and a resolved
 * record link look the same in a table row on `/dashboard/p/<slug>` and in
 * the definition list on `/dashboard/objects/<id>`, because both surfaces
 * render through this file. It was the list's private `Cell` until the
 * record page needed the same thing; nothing here knows which surface is
 * asking.
 */

type PillStatus = React.ComponentProps<typeof StatusPill>['status'];

export function toneToStatus(tone: string): PillStatus {
  switch (tone) {
    case 'ok':
      return 'completed';
    case 'warn':
      return 'pending';
    case 'bad':
      return 'failed';
    case 'info':
      return 'running';
    default:
      return 'inactive';
  }
}

/** What a resolved record reference turned out to be. */
export type RecordLink = { href: string; label: string };

/**
 * The key a resolved reference is filed under, so the surface that did the
 * database work and the cell that draws it agree without passing functions
 * through a server boundary.
 * @param to - The target object type (`field.to`).
 * @param value - The raw reference — an id or a slug.
 */
export function recordLinkKey(to: string, value: unknown): string {
  return `${to}:${String(value)}`;
}

export type LinkMap = Record<string, RecordLink>;

/**
 * The muted dash a cell shows when there is nothing to show. It names the
 * field on hover, so an empty column is readable as "Size: not recorded"
 * rather than as a grid of dashes nobody can tell apart.
 * @param root0 - Props.
 * @param root0.field - The field that has no value.
 */
export function EmptyValue({ field }: { field: PageField }) {
  return (
    <span className="text-muted-foreground" title={`${field.label ?? field.key}: not recorded`} aria-label={`${field.label ?? field.key}: not recorded`}>
      —
    </span>
  );
}

/**
 * Our figure beside the one it is measured against, as `format: compare`.
 *
 * The Product board spent four columns on this (ours, their name, their
 * price, the date it was checked) and the comparison still had to be made in
 * the reader's head. It is ONE fact: what we charge, against whom, at what.
 * The date it was checked is how much to trust it, not part of the reading,
 * so it rides on the title. Either side alone still says something; the
 * field is drawn as long as one of them is recorded.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.field - The field declaration, carrying `beside`.
 */
export function CompareValue({ row, field }: { row: PageRow; field: PageField }) {
  const ours = resolveField(row, field.from ?? field.key);
  const theirs = field.beside ? resolveField(row, field.beside.from) : undefined;
  const whose = field.beside?.labelFrom ? resolveField(row, field.beside.labelFrom) : undefined;
  const checked = field.beside?.checkedFrom ? resolveField(row, field.beside.checkedFrom) : undefined;
  if (isEmptyValue(ours) && isEmptyValue(theirs) && isEmptyValue(whose)) {
    return <EmptyValue field={field} />;
  }
  const checkedOn = toDate(checked);
  return (
    <span
      className="flex flex-col gap-0.5"
      data-testid="compare-value"
      title={checkedOn ? `Checked ${checkedOn.toLocaleDateString()}` : undefined}
    >
      {isEmptyValue(ours)
        ? <span className="text-sm text-muted-foreground">not priced yet</span>
        : <span className="text-lg leading-tight font-semibold tracking-tight text-foreground">{String(ours)}</span>}
      {(!isEmptyValue(theirs) || !isEmptyValue(whose)) && (
        <span className="text-xs text-muted-foreground">
          {'against '}
          {isEmptyValue(whose) ? 'the incumbent' : String(whose)}
          {isEmptyValue(theirs)
            ? <span className="italic">, price not recorded</span>
            : <span className="font-medium text-foreground/90">{` ${String(theirs)}`}</span>}
        </span>
      )}
    </span>
  );
}

/**
 * A queue as a shape rather than a number, as `format: workload`.
 *
 * Two open requests with one being worked on and nothing urgent is a healthy
 * backlog; two open with both urgent and neither moving is a morning's work.
 * The bare "2" cannot tell those apart, so it is not yet information, and a
 * portfolio row that prints it has spent its space without answering the
 * question it was opened for. Urgent is the only part that carries weight,
 * and only when there is some: a quiet row should read quiet.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.field - The field declaration, carrying `workload`.
 */
export function WorkloadValue({ row, field }: { row: PageRow; field: PageField }) {
  const cfg = field.workload!;
  const num = (accessor?: string): number | null => {
    if (!accessor) {
      return null;
    }
    const v = resolveField(row, accessor);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const open = num(field.from ?? field.key);
  if (open === null) {
    return <EmptyValue field={field} />;
  }
  const plural = open === 1 ? cfg.noun : `${cfg.noun}s`;
  if (open === 0) {
    return <span className="text-sm text-muted-foreground" data-testid="workload-value">{`No ${plural}`}</span>;
  }
  const inFlight = num(cfg.inFlightFrom);
  const urgent = num(cfg.urgentFrom);
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm" data-testid="workload-value">
      <span className="font-medium">{`${open} ${plural}`}</span>
      {inFlight !== null && inFlight > 0 && (
        <span className="text-xs text-muted-foreground">{`· ${inFlight} being worked on`}</span>
      )}
      {urgent !== null && (
        urgent > 0
          ? <span className="text-xs font-medium text-destructive">{`· ${urgent} ${cfg.urgentLabel}`}</span>
          : <span className="text-xs text-muted-foreground">{`· none ${cfg.urgentLabel}`}</span>
      )}
    </span>
  );
}

/**
 * The muted line under a value. See a field's `caption`.
 *
 * `promoted` is the case where the value it was qualifying is not recorded.
 * "Last shipped: not recorded, 22h ago" is a dash and a contradiction; "Last
 * shipped: 22h ago" is the part we do know, said plainly, so the caption
 * steps up and takes the line rather than propping up an empty one.
 * @param root0 - Props.
 * @param root0.row - The row.
 * @param root0.field - The field declaration, carrying `caption`.
 * @param root0.now - The instant a `relative` caption is measured against.
 * @param root0.promoted - Whether it is standing in for the missing value.
 */
function Caption({ row, field, now, promoted }: { row: PageRow; field: PageField; now: number; promoted?: boolean }) {
  const raw = resolveField(row, field.caption!.from);
  if (isEmptyValue(raw)) {
    return null;
  }
  const d = toDate(raw);
  const text = field.caption!.format === 'relative' && d
    ? relativeLabel(d, now)
    : field.caption!.format === 'date' && d
      ? d.toLocaleDateString()
      : String(raw);
  return (
    <span
      className={promoted ? 'block text-sm' : 'block text-xs text-muted-foreground'}
      title={d ? d.toLocaleString() : undefined}
      data-testid="field-caption"
    >
      {text}
    </span>
  );
}

/**
 * One declared field's value, formatted, with its caption under it.
 * @param root0 - Props.
 * @param root0.row - The row (or record) the value is read from.
 * @param root0.field - The field declaration.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by {@link recordLinkKey}.
 */
export function FieldValue({ row, field, now, links }: { row: PageRow; field: PageField; now: number; links?: LinkMap }) {
  const body = <FieldBody row={row} field={field} now={now} links={links} />;
  if (!field.caption || fieldIsFresh(row, field, now)) {
    return body;
  }
  // Nothing was recorded for the value itself, so the caption is all this
  // field knows. It says that on its own instead of propping up a dash.
  if (isEmptyValue(resolveField(row, field.from ?? field.key))) {
    return <Caption row={row} field={field} now={now} promoted />;
  }
  return (
    <span className="block">
      {body}
      <Caption row={row} field={field} now={now} />
    </span>
  );
}

/**
 * One declared field's value, formatted.
 * @param root0 - Props.
 * @param root0.row - The row (or record) the value is read from.
 * @param root0.field - The field declaration.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by {@link recordLinkKey}.
 */
function FieldBody({ row, field, now, links }: { row: PageRow; field: PageField; now: number; links?: LinkMap }) {
  const raw = resolveField(row, field.from ?? field.key);
  // Nothing is feeding this field, so whatever is sitting in it is not an
  // observation. Say what is missing in the page's words, "monitoring not
  // connected" and never "unknown", so a reader can tell a product in trouble
  // from a product we have not wired up. Not a badge: it is not a state the
  // product is in.
  if (!fieldHasSource(row, field)) {
    return (
      <span className="text-xs text-muted-foreground italic" title={`${field.label ?? field.key}: ${field.source!.absentLabel}`}>
        {field.source!.absentLabel}
      </span>
    );
  }
  // Freshness that is still fresh is the machinery reporting that it ran.
  // It is drawn only once it has become news. See `staleAfterHours`.
  if (fieldIsFresh(row, field, now)) {
    return null;
  }
  if (field.format === 'compare') {
    return <CompareValue row={row} field={field} />;
  }
  if (field.format === 'workload' && field.workload) {
    return <WorkloadValue row={row} field={field} />;
  }
  if (isEmptyValue(raw)) {
    // A badge column over a boolean is the one place an absent value is
    // worth saying out loud: the floor's `verified` used to paint a red
    // `false` on a task that simply has no verification record yet, which
    // reads as a check that failed.
    return field.format === 'badge'
      ? <span className="text-xs text-muted-foreground" title={`${field.label ?? field.key}: not recorded`}>not recorded</span>
      : <EmptyValue field={field} />;
  }
  const s = String(raw);
  switch (field.format) {
    case 'badge': {
      const tone = field.tones?.[s];
      // A flag that is off is nothing to badge unless the page maps it.
      if (raw === false && !tone) {
        return <EmptyValue field={field} />;
      }
      return tone
        ? <StatusPill status={toneToStatus(tone)} label={s} size="sm" />
        : <Badge variant="outline">{s}</Badge>;
    }
    case 'score': {
      const n = Number(raw);
      const cls = n >= 85 ? 'text-emerald-600' : n >= 70 ? 'text-foreground' : n >= 60 ? 'text-amber-600' : 'text-muted-foreground';
      return <span className={`font-mono text-sm font-semibold tabular-nums ${cls}`}>{Number.isFinite(n) ? n : s}</span>;
    }
    case 'date': {
      const d = toDate(raw);
      return <span className="text-sm whitespace-nowrap text-muted-foreground">{d ? d.toLocaleDateString() : s}</span>;
    }
    case 'mono':
      return <span className="font-mono text-xs">{s}</span>;
    case 'duration': {
      const secs = Number(raw);
      return <span className="font-mono text-xs whitespace-nowrap tabular-nums">{Number.isFinite(secs) ? formatDuration(secs) : s}</span>;
    }
    case 'money': {
      const cents = Number(raw);
      return <span className="font-mono text-sm tabular-nums">{Number.isFinite(cents) ? formatMoney(cents) : s}</span>;
    }
    case 'link': {
      // A reference to another record reads as that record's title; a URL
      // reads as itself and opens in a new tab.
      if (field.to) {
        const hit = links?.[recordLinkKey(field.to, raw)];
        return hit
          ? <a href={hit.href} className="text-sm underline underline-offset-2">{hit.label}</a>
          : <span className="font-mono text-xs text-muted-foreground" title={`${field.label ?? field.key}: ${field.to} ${s} is not a record here`}>{s}</span>;
      }
      return <a href={s} target="_blank" rel="noreferrer" title={s} className="font-mono text-xs whitespace-nowrap underline underline-offset-2">{shortUrlLabel(s)}</a>;
    }
    case 'relative': {
      // Rendered on the server at request time, so on a live page it is
      // re-read with the rows; the exact moment is one hover away.
      const d = toDate(raw);
      return d
        ? <time dateTime={d.toISOString()} title={d.toLocaleString()} className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">{relativeLabel(d, now)}</time>
        : <span className="text-sm">{s}</span>;
    }
    case 'progress': {
      const line = formatProgress(raw);
      return line
        ? <span className="text-sm">{line}</span>
        : <EmptyValue field={field} />;
    }
    case 'steps': {
      // A checklist the record carries in order — an acceptance contract,
      // the required checks, the paths a worker may touch. One line each,
      // because that is how they were written.
      const items = Array.isArray(raw) ? raw : [raw];
      return (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={`${field.key}-${i}`} className="flex items-start gap-2 text-sm">
              <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
              <span className="min-w-0 break-words">{typeof it === 'object' ? formatProgress(it) ?? JSON.stringify(it) : String(it)}</span>
            </li>
          ))}
        </ul>
      );
    }
    case 'icon': {
      // A NAMED icon as the row's picture: a product's mark, a page's glyph.
      // Fills its tile the way `image` fills its frame.
      return (
        <span className="flex size-full items-center justify-center bg-muted text-foreground/70">
          {createElement(iconByName(s), { 'className': 'size-1/2', 'aria-hidden': true })}
        </span>
      );
    }
    case 'image':
      // FILLS its container rather than choosing a size. The same drawing is
      // a thumbnail leading a block and would be a smaller one in a table
      // cell, and a value that picks its own dimensions cannot be both; the
      // layout that knows how much room it has sizes the box.
      return <img src={s} alt={field.label ?? field.key} loading="lazy" className="block size-full object-cover" />;
    default:
      // A list — a request's tags — reads as its items, not as JSON.
      return <span className="text-sm">{Array.isArray(raw) ? raw.map(String).join(', ') : s}</span>;
  }
}

import type React from 'react';
import type { PageField, PageRow } from '@/libs/workspace/pageFields';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { relativeLabel } from '@/libs/timeAgo';
import { formatDuration, formatMoney, formatProgress, isEmptyValue, resolveField, shortUrlLabel, toDate } from '@/libs/workspace/pageFields';

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
 * One declared field's value, formatted.
 * @param root0 - Props.
 * @param root0.row - The row (or record) the value is read from.
 * @param root0.field - The field declaration.
 * @param root0.now - The instant a `relative` value is measured against.
 * @param root0.links - Resolved record references, by {@link recordLinkKey}.
 */
export function FieldValue({ row, field, now, links }: { row: PageRow; field: PageField; now: number; links?: LinkMap }) {
  const raw = resolveField(row, field.from ?? field.key);
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
    case 'image':
      return <img src={s} alt={field.label ?? field.key} loading="lazy" className="h-14 w-24 rounded border border-border object-cover" />;
    default:
      // A list — a request's tags — reads as its items, not as JSON.
      return <span className="text-sm">{Array.isArray(raw) ? raw.map(String).join(', ') : s}</span>;
  }
}

'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { confidenceLevel } from './confidence';
import { entranceLabel, LANE_PILL, shortDate } from './LeadContext';

/**
 * The personalization queue — a pure list. One lead per row, four lanes
 * across the top; a row is a link to the lead's own page
 * (`/gtm/lead/{hubspot_id}`), where the brief, the evidence and the decision
 * live. Nothing expands here and nothing decides here: the queue's one job is
 * finding the right lead.
 *
 * Nothing reaches this screen without a brief. A lead the sweep has picked up
 * but not yet researched, and a lead part-way through its retries, are both
 * absent by construction: the page is handed only rows that carry one. When
 * the tries run out the lead arrives anyway (its page carries the error),
 * because a reviewer needs to see what failed.
 */

export type BriefRow = {
  id: number;
  /** CRM mirror ref, `contacts:{hubspot_id}` — what the row links through. */
  contactRef: string;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  entranceSource: string | null;
  utmCampaign: string | null;
  engagementSent: number;
  engagementOpened: number;
  status: string;
  confidence: number | null;
  /** HubSpot's stage-entry date; null falls back to arrival, labeled as such. */
  mqlAt: string | null;
  arrivedAt: string | null;
  briefedAt: string | null;
};

/**
 * Lane order is the review order: what needs you, then what you did with it.
 * There is no lane for unbriefed leads because there is no such row on this
 * page.
 */
const LANES = [
  { key: 'ready_for_review', label: 'Review' },
  { key: 'handed_off', label: 'Hand off' },
  { key: 'held', label: 'Held' },
  { key: 'sent', label: 'Sent' },
] as const;

/** The page opens where the work is. */
const DEFAULT_LANE: string = 'ready_for_review';

type SortKey = 'arrived' | 'confidence' | 'name';

/**
 * Arrival order is the default and the first option. Confidence sorts a row
 * with no score (a lead that ran out of tries) to the bottom rather than
 * dropping it, because that row is the one most worth reading.
 */
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'arrived', label: 'Arrived' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'name', label: 'Name' },
];

const BriefListRow = ({ row }: { row: BriefRow }) => {
  const level = confidenceLevel(row.confidence);
  const pill = LANE_PILL[row.status] ?? { status: 'pending' as const, label: row.status };
  const hubspotId = row.contactRef.split(':')[1];

  // The one-line "why this lead": who they are, when and how they arrived,
  // how warm. Anything the CRM does not carry is left out rather than shown
  // as a blank or a zero pretending to be a reading.
  const meta = [
    row.contactTitle,
    row.companyName,
    // The true stage-entry date wins; the create date is labeled as arrival,
    // never as when they became an MQL.
    row.mqlAt ? `MQL ${shortDate(row.mqlAt)}` : row.arrivedAt ? `arrived ${shortDate(row.arrivedAt)}` : null,
    row.entranceSource ? entranceLabel(row.entranceSource) : null,
    // "via", not "utm=": what the CRM carries is the source detail (the ad
    // network, the keyword), which is only sometimes a campaign tag.
    row.utmCampaign ? `via ${row.utmCampaign}` : null,
    row.engagementSent > 0 ? `${row.engagementSent} sent` : null,
    row.engagementOpened > 0 ? `${row.engagementOpened} opened` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Link
      href={`/gtm/lead/${hubspotId}`}
      className="flex items-center gap-3 border-b border-border py-3 transition hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{row.contactName}</div>
        <div className="truncate text-[13px] text-muted-foreground">{meta}</div>
      </div>
      {level && (
        <span className="hidden text-[13px] text-muted-foreground sm:inline">
          {level}
          {' '}
          {row.confidence?.toFixed(2)}
        </span>
      )}
      <StatusPill status={pill.status} label={pill.label} size="sm" />
    </Link>
  );
};

export const PersonalizationQueue = (props: { briefs: BriefRow[] }) => {
  // The page query already excludes unbriefed rows. Repeated here so the
  // guarantee holds whatever the caller passes: `queued` has no lane, and a
  // row in it would otherwise still be reachable through All and the search.
  const briefs = useMemo(
    () => props.briefs.filter(b => b.status !== 'queued'),
    [props.briefs],
  );
  const [lane, setLane] = useState<string>(DEFAULT_LANE);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('arrived');
  const [descending, setDescending] = useState(true);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: briefs.length };
    for (const b of briefs) {
      c[b.status] = (c[b.status] ?? 0) + 1;
    }
    return c;
  }, [briefs]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = briefs
      .filter(b => lane === 'all' || b.status === lane)
      .filter(b => !q
        || b.contactName.toLowerCase().includes(q)
        || (b.companyName ?? '').toLowerCase().includes(q));

    const direction = descending ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sort === 'name') {
        return a.contactName.localeCompare(b.contactName) * -direction;
      }
      if (sort === 'arrived') {
        // Falls back to briefed time so a row with no CRM create date still
        // orders, rather than collapsing to the top in an arbitrary spot.
        const at = a.arrivedAt ?? a.briefedAt ?? '';
        const bt = b.arrivedAt ?? b.briefedAt ?? '';
        if (at === bt) {
          return 0;
        }
        return (at < bt ? -1 : 1) * direction;
      }
      return ((a.confidence ?? 0) - (b.confidence ?? 0)) * direction;
    });
  }, [briefs, lane, query, sort, descending]);

  return (
    <div className="flex flex-col">
      {/* Lanes + find/sort share a row so the queue starts at the fold. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-0">
        <div className="flex items-end gap-5">
          {[...LANES, { key: 'all', label: 'All' } as const].map(l => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLane(l.key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 pb-2 text-sm transition',
                lane === l.key
                  ? 'border-[var(--brand-borderline)] font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {l.label}
              <span className="text-xs text-muted-foreground/70">{counts[l.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 pb-2">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a lead or company"
            className="h-8 w-56 text-sm"
          />
          <label htmlFor="brief-sort" className="text-xs text-muted-foreground">Sort</label>
          <select
            id="brief-sort"
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setDescending(d => !d)}
            aria-label={descending ? 'Sort ascending' : 'Sort descending'}
            className="flex size-8 items-center justify-center rounded-md border border-border transition hover:bg-muted"
          >
            {descending ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
          </button>
        </div>
      </div>

      {rows.length === 0
        ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {query ? 'No lead matches that search.' : 'Nothing in this lane.'}
            </p>
          )
        : rows.map(row => <BriefListRow key={row.id} row={row} />)}
    </div>
  );
};

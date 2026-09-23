'use client';

import { useMemo, useState } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListToolbar, Subline, useListUrlState } from '@/components/patterns';
import { ConfidenceBars } from '@/components/ui/confidence-indicator';
import { StatusPill } from '@/components/ui/status-pill';
import { confidenceLevel } from './confidence';
import { entranceLabel, LANE_PILL, shortDate, shortDateTime } from './leadFormat';

/**
 * The personalization queue — a pure list, and the reference implementation
 * of the List archetype (`components/patterns`, `docs/design/patterns.md`).
 * One lead per row, four lanes across the top; a row is a link to the lead's
 * own page (`/gtm/lead/{hubspot_id}`), where the brief, the evidence and the
 * decision live. Nothing expands here and nothing decides here: the queue's
 * one job is finding the right lead. Lane, search and sort live in the URL.
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
  { key: 'all', label: 'All' },
] as const;

/**
 * Arrival order is the default and the first option. Confidence sorts a row
 * with no score (a lead that ran out of tries) to the bottom rather than
 * dropping it, because that row is the one most worth reading.
 */
const SORTS = [
  { key: 'arrived', label: 'Arrived' },
  { key: 'briefed', label: 'Briefed' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'name', label: 'Name' },
] as const;

/**
 * When the brief was written, as a filter. A reviewer working through the
 * cards drafted before a rule changed (the voice gate on 2026-09-19, the
 * sequence ladder on 2026-09-13) needs to find "the old ones" in one move;
 * a sort alone makes them scroll to the end and guess where the line is
 * (Valerie, 2026-09-23). Chips, because a reviewer may want two windows at
 * once ("this week and today"), and kept in the URL with the lane and sort.
 */
const BRIEFED_WINDOWS = [
  { key: 'today', label: 'Briefed today' },
  { key: 'week', label: 'Briefed this week' },
  { key: 'earlier', label: 'Briefed earlier' },
] as const;
type BriefedWindow = (typeof BRIEFED_WINDOWS)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which window a brief falls in, by its age at `now`. Null for a row with no
 * brief timestamp, which no window claims.
 * @param briefedAt - ISO timestamp, or null.
 * @param now - The moment the list was rendered, in ms.
 */
export function briefedWindowOf(briefedAt: string | null, now: number): BriefedWindow | null {
  if (!briefedAt) {
    return null;
  }
  const t = new Date(briefedAt).getTime();
  if (Number.isNaN(t)) {
    return null;
  }
  const age = now - t;
  if (age < DAY_MS) {
    return 'today';
  }
  if (age < 7 * DAY_MS) {
    return 'week';
  }
  return 'earlier';
}

/** The page opens where the work is; the clean URL means this state. */
const LIST = {
  defaults: { tab: 'ready_for_review', q: '', sort: 'arrived', dir: 'desc' as const, chips: [] },
  tabs: LANES.map(l => l.key),
  sorts: SORTS.map(s => s.key),
  chips: BRIEFED_WINDOWS.map(w => w.key),
};

const BriefListRow = ({ row }: { row: BriefRow }) => {
  const level = confidenceLevel(row.confidence);
  const pill = LANE_PILL[row.status] ?? { status: 'pending' as const, label: row.status };
  const hubspotId = row.contactRef.split(':')[1];

  return (
    <ListRow
      href={`/gtm/lead/${hubspotId}`}
      title={row.contactName}
      chevron={false}
      // The one-line "why this lead": who they are, when and how they
      // arrived, how warm. Anything the CRM does not carry is left out rather
      // than shown as a blank or a zero pretending to be a reading.
      subline={(
        <Subline
          separator="·"
          segments={[
            row.contactTitle,
            row.companyName,
            // The true stage-entry date wins; the create date is labeled as
            // arrival, never as when they became an MQL.
            row.mqlAt ? `MQL ${shortDate(row.mqlAt)}` : row.arrivedAt ? `arrived ${shortDate(row.arrivedAt)}` : null,
            // The moment the brief was written, with the time: two passes on
            // one day are two different briefs, and this is what the Briefed
            // sort and chips read.
            row.briefedAt ? `briefed ${shortDateTime(row.briefedAt)}` : null,
            row.entranceSource ? entranceLabel(row.entranceSource) : null,
            // "via", not "utm=": what the CRM carries is the source detail
            // (the ad network, the keyword), only sometimes a campaign tag.
            row.utmCampaign ? `via ${row.utmCampaign}` : null,
            row.engagementSent > 0 ? `${row.engagementSent} sent` : null,
            row.engagementOpened > 0 ? `${row.engagementOpened} opened` : null,
          ]}
        />
      )}
      columns={level && (
        <Column kind="score">
          {/* One confidence renderer everywhere (design principle 6): the same bars
              the ledger, the inbox and the review detail draw. */}
          <ConfidenceBars value={row.confidence} subject="Brief" />
        </Column>
      )}
      chip={<StatusPill status={pill.status} label={pill.label} size="sm" />}
    />
  );
};

export const PersonalizationQueue = (props: {
  briefs: BriefRow[];
  /**
   * The moment the briefed windows are measured from. Tests and stories pin
   * it; the page leaves it out and the component reads its own clock once.
   */
  now?: number;
}) => {
  // The page query already excludes unbriefed rows. Repeated here so the
  // guarantee holds whatever the caller passes: `queued` has no lane, and a
  // row in it would otherwise still be reachable through All and the search.
  const briefs = useMemo(
    () => props.briefs.filter(b => b.status !== 'queued'),
    [props.briefs],
  );
  const [list, setList] = useListUrlState(LIST);
  const { tab: lane, q: query, sort, dir, chips } = list;
  // One clock for the whole list, so every row is bucketed against the same
  // moment, and read once rather than on every render.
  const [ownClock] = useState(() => Date.now());
  const now = props.now ?? ownClock;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: briefs.length };
    for (const b of briefs) {
      c[b.status] = (c[b.status] ?? 0) + 1;
    }
    return c;
  }, [briefs]);

  // The chip counts are taken on the lane and the search, before the chips
  // narrow anything, so a chip's number is what picking it would show.
  const inLane = useMemo(() => {
    const q = query.trim().toLowerCase();
    return briefs
      .filter(b => lane === 'all' || b.status === lane)
      .filter(b => !q
        || b.contactName.toLowerCase().includes(q)
        || (b.companyName ?? '').toLowerCase().includes(q));
  }, [briefs, lane, query]);

  const windowCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of inLane) {
      const w = briefedWindowOf(b.briefedAt, now);
      if (w) {
        c[w] = (c[w] ?? 0) + 1;
      }
    }
    return c;
  }, [inLane, now]);

  const rows = useMemo(() => {
    const filtered = chips.length === 0
      ? inLane
      : inLane.filter((b) => {
          const w = briefedWindowOf(b.briefedAt, now);
          return w !== null && chips.includes(w);
        });

    const direction = dir === 'desc' ? -1 : 1;
    const byTime = (at: string, bt: string) => (at === bt ? 0 : (at < bt ? -1 : 1) * direction);
    return [...filtered].sort((a, b) => {
      if (sort === 'name') {
        return a.contactName.localeCompare(b.contactName) * -direction;
      }
      if (sort === 'arrived') {
        // Falls back to briefed time so a row with no CRM create date still
        // orders, rather than collapsing to the top in an arbitrary spot.
        return byTime(a.arrivedAt ?? a.briefedAt ?? '', b.arrivedAt ?? b.briefedAt ?? '');
      }
      if (sort === 'briefed') {
        // A row with no brief time sorts last whichever way the list runs.
        if (!a.briefedAt || !b.briefedAt) {
          return a.briefedAt ? -1 : b.briefedAt ? 1 : 0;
        }
        return byTime(a.briefedAt, b.briefedAt);
      }
      return ((a.confidence ?? 0) - (b.confidence ?? 0)) * direction;
    });
  }, [inLane, chips, now, sort, dir]);

  return (
    <div className="flex flex-col" data-testid="personalization-queue">
      <ListToolbar
        tabs={{
          label: 'Lanes',
          items: LANES.map(l => ({ key: l.key, label: l.label, count: counts[l.key] ?? 0 })),
          value: lane,
          onChange: tab => setList({ tab }),
        }}
        search={{ value: query, onChange: q => setList({ q }), placeholder: 'Find a lead or company' }}
        sort={{ value: sort, onChange: s => setList({ sort: s }), options: SORTS }}
        direction={{ value: dir, onChange: d => setList({ dir: d }) }}
        chips={{
          label: 'Briefed',
          items: BRIEFED_WINDOWS.map(w => ({ key: w.key, label: w.label, count: windowCounts[w.key] ?? 0 })),
          active: chips,
          onChange: next => setList({ chips: next }),
        }}
      />

      {rows.length === 0
        ? <ListEmpty variant="inline" title={query ? 'No lead matches that search.' : 'Nothing in this lane.'} />
        : (
            <ListRows className="mt-1">
              {rows.map(row => <BriefListRow key={row.id} row={row} />)}
            </ListRows>
          )}
    </div>
  );
};

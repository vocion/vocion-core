'use client';

import { useMemo } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListToolbar, Subline, useListUrlState } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { confidenceLevel } from './confidence';
import { entranceLabel, LANE_PILL, shortDate } from './LeadContext';

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
  { key: 'confidence', label: 'Confidence' },
  { key: 'name', label: 'Name' },
] as const;

/** The page opens where the work is; the clean URL means this state. */
const LIST = {
  defaults: { tab: 'ready_for_review', q: '', sort: 'arrived', dir: 'desc' as const, chips: [] },
  tabs: LANES.map(l => l.key),
  sorts: SORTS.map(s => s.key),
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
          {level}
          {' '}
          {row.confidence?.toFixed(2)}
        </Column>
      )}
      chip={<StatusPill status={pill.status} label={pill.label} size="sm" />}
    />
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
  const [list, setList] = useListUrlState(LIST);
  const { tab: lane, q: query, sort, dir } = list;

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

    const direction = dir === 'desc' ? -1 : 1;
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
  }, [briefs, lane, query, sort, dir]);

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

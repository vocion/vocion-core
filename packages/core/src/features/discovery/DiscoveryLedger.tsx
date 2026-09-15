'use client';

import { useMemo } from 'react';
import { LedgerEntry, LedgerGroup, ListEmpty, ListToolbar, ProvenanceLine, ScoreChip, useListUrlState, VerdictBadge } from '@/components/patterns';
import { Link } from '@/libs/I18nNavigation';

/**
 * The discovery ledger — the reference implementation of the Ledger
 * archetype (`components/patterns`, `docs/design/patterns.md`). Every call
 * the detection agent assessed, newest first under day headers: what it read
 * (the match reason), how it scored (both scores against the thresholds in
 * force), how it decided (the route), who and what decided it (the
 * provenance footer), and what a person did with it (the review state,
 * linked to the queue). Dropped calls are rows here too — a call classified
 * as not-discovery has its scores and reasoning, not an absence — and
 * matched-but-not-assessed calls show their `skipped_reason`.
 *
 * Filter by verdict, search, sort by date or score; the state is in the URL.
 */

export type DiscoveryEntry = {
  id: number;
  title: string;
  /** Meeting start, ISO, or null when the calendar did not carry one. */
  when: string | null;
  /** When the ledger recorded the match, ISO. The grouping date when `when` is null. */
  matchedAt: string;
  matchReason: string | null;
  /** Lifecycle: matched | classified | routed | dropped. */
  status: string;
  /** The route the router chose: generate | confirm | drop, or null before routing. */
  route: string | null;
  classification: {
    isDiscovery: boolean;
    isDiscoveryConfidence: number;
    proposalReady: boolean;
    proposalReadyConfidence: number;
    reasoning: string;
  } | null;
  thresholds: { discovery: number; ready: number } | null;
  skippedReason: string | null;
  classifierVersion: string | null;
  assessedBy: { agentSlug?: string; missionRunId?: number; userId?: string } | null;
  transcriptHash: string | null;
  workspaceSha: string | null;
  /** The review-queue run this was surfaced as, and its state, when routed to a person. */
  reviewActionRunId: number | null;
  reviewStatus: string | null;
};

/**
 * What the ledger calls the outcome. The route when there is one; `skipped`
 * for a match the agent never read; `pending` for a match still waiting on
 * classification.
 * @param e - The entry.
 */
export function verdictOf(e: DiscoveryEntry): string {
  if (e.route) {
    return e.route;
  }
  if (e.skippedReason) {
    return 'skipped';
  }
  return 'pending';
}

const VERDICTS = [
  { key: 'generate', label: 'generate' },
  { key: 'confirm', label: 'confirm' },
  { key: 'drop', label: 'drop' },
  { key: 'skipped', label: 'skipped' },
  { key: 'pending', label: 'pending' },
] as const;

const SORTS = [
  { key: 'date', label: 'Date' },
  { key: 'score', label: 'Score' },
] as const;

const LIST = {
  defaults: { tab: '', q: '', sort: 'date', dir: 'desc' as const, chips: [] },
  sorts: SORTS.map(s => s.key),
  chips: VERDICTS.map(v => v.key),
};

/** The review queue, filtered to discovery proposals — where the human decision lives. */
const REVIEW_HREF = '/dashboard/review?type=discovery.review_proposal';

/** Fixed locale + UTC so the server render and the client render agree. */
const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DAY.format(d);
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME.format(d);
}

const REVIEW_LABEL: Record<string, string> = {
  pending: 'review: pending',
  approved: 'review: approved',
  rejected: 'review: declined',
  done: 'review: done',
  failed: 'review: failed',
  executing: 'review: executing',
};

function Entry({ e }: { e: DiscoveryEntry }) {
  const cls = e.classification;
  const verdict = verdictOf(e);
  const at = e.when ?? e.matchedAt;
  // What a person did with it: the review state, linked to the queue where
  // they did (or will do) it. Absent when the router never asked anyone.
  const human = e.reviewStatus
    ? (
        <Link href={REVIEW_HREF} className="underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground">
          {`${REVIEW_LABEL[e.reviewStatus] ?? `review: ${e.reviewStatus}`} →`}
        </Link>
      )
    : e.skippedReason
      ? <span className="text-brand-borderline" title="Matched but not assessed">{`skipped: ${e.skippedReason}`}</span>
      : null;

  return (
    <LedgerEntry
      data-testid="discovery-entry"
      title={e.title}
      when={timeLabel(at)}
      detail={e.matchReason}
      state={<span>{e.status}</span>}
      verdict={<VerdictBadge verdict={verdict} />}
      scores={cls && (
        <>
          <ScoreChip label="discovery" value={cls.isDiscoveryConfidence} threshold={e.thresholds?.discovery} />
          <ScoreChip label="proposal-ready" value={cls.proposalReadyConfidence} threshold={e.thresholds?.ready} />
          {e.thresholds && (
            <span className="text-[12px] text-muted-foreground tabular-nums" title="The thresholds the route was decided under">
              {`thresholds ${e.thresholds.discovery} / ${e.thresholds.ready}`}
            </span>
          )}
        </>
      )}
      summary={cls?.reasoning}
      provenance={(
        <ProvenanceLine
          items={[
            e.classifierVersion && { value: e.classifierVersion, title: 'Model + prompt version' },
            e.assessedBy?.agentSlug && { value: e.assessedBy.agentSlug, title: e.assessedBy.missionRunId ? `mission_run #${e.assessedBy.missionRunId}` : 'chat turn' },
            e.assessedBy?.missionRunId && { label: 'run', value: `#${e.assessedBy.missionRunId}`, title: 'mission_run' },
            e.transcriptHash && { label: 'transcript', value: e.transcriptHash.slice(0, 12), title: 'knowledge_document.contentHash at read time' },
            e.workspaceSha && { label: 'ws', value: e.workspaceSha.slice(0, 12), title: 'Workspace sha at assessment' },
          ]}
        />
      )}
      human={human}
    />
  );
}

export function DiscoveryLedger(props: { entries: DiscoveryEntry[] }) {
  const [list, setList] = useListUrlState(LIST);
  const { q: query, sort, dir, chips } = list;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of props.entries) {
      const v = verdictOf(e);
      c[v] = (c[v] ?? 0) + 1;
    }
    return c;
  }, [props.entries]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = props.entries
      .filter(e => chips.length === 0 || chips.includes(verdictOf(e)))
      .filter(e => !q
        || e.title.toLowerCase().includes(q)
        || (e.matchReason ?? '').toLowerCase().includes(q)
        || (e.classification?.reasoning ?? '').toLowerCase().includes(q));
    const direction = dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sort === 'score') {
        return ((a.classification?.isDiscoveryConfidence ?? -1) - (b.classification?.isDiscoveryConfidence ?? -1)) * direction;
      }
      const at = a.when ?? a.matchedAt;
      const bt = b.when ?? b.matchedAt;
      return at === bt ? 0 : (at < bt ? -1 : 1) * direction;
    });
  }, [props.entries, query, sort, dir, chips]);

  // Day headers follow the sort: by date they are chronological; by score
  // they still group, so a day never repeats.
  const groups = useMemo(() => {
    const map = new Map<string, DiscoveryEntry[]>();
    for (const e of rows) {
      const k = dayKey(e.when ?? e.matchedAt);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="flex flex-col" data-testid="discovery-ledger">
      <ListToolbar
        search={{ value: query, onChange: q => setList({ q }), placeholder: 'Find a meeting or a reason' }}
        sort={{ value: sort, onChange: s => setList({ sort: s }), options: SORTS }}
        direction={{ value: dir, onChange: d => setList({ dir: d }) }}
        chips={{
          label: 'Filter by verdict',
          items: VERDICTS.filter(v => (counts[v.key] ?? 0) > 0).map(v => ({ key: v.key, label: v.label, count: counts[v.key] ?? 0 })),
          active: chips,
          onChange: next => setList({ chips: next }),
        }}
      />

      {rows.length === 0
        ? <ListEmpty variant="inline" title={query ? 'No assessed call matches that search.' : 'Nothing with that verdict.'} />
        : groups.map(([day, entries]) => (
            <LedgerGroup key={day} label={dayLabel(entries[0]!.when ?? entries[0]!.matchedAt)} count={entries.length}>
              {entries.map(e => <Entry key={e.id} e={e} />)}
            </LedgerGroup>
          ))}
    </div>
  );
}

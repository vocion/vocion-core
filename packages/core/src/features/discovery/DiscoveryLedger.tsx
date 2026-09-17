'use client';

import type { ToolbarFacet } from '@/components/patterns';
import type { DiscoveryLedgerEntry } from '@/services/discovery/ledger';
import { useMemo } from 'react';
import { LedgerEntry, LedgerGroup, ListEmpty, ListToolbar, ProvenanceLine, useListUrlState } from '@/components/patterns';
import { ConfidenceBars } from '@/components/ui/confidence-indicator';
import { EvidenceRefs } from '@/features/preview/EvidenceRefs';
import { Link } from '@/libs/I18nNavigation';
import {
  DISCOVERY_CLASS_LABEL,
  READINESS_CLASS_LABEL,
  REASON_CODE_LABEL,
  REASON_CODES,
  RECOMMENDED_ACTION_LABEL,
} from '@/services/discovery/classification';
import { calibrationOf, DISPOSITION_LABEL, DISPOSITIONS, versionDelta } from '@/services/discovery/disposition';
import { inboxHref } from '@/services/inbox/inboxRef';
import { cn } from '@/utils/Helpers';

/**
 * The Discovery Ledger — the operational record of every call the detection
 * agent assessed, rebuilt to `docs/specs/discovery-ledger-v2.md`.
 *
 * Every row answers four questions in about two seconds: **what meeting was
 * this, what did Vocion decide, why did it decide that, and what did the human
 * do.** The three things v1 collapsed into one `generate · confirm · drop`
 * filter are three filters here, because they are three different kinds of
 * thing:
 *
 *   - **Decision** — the classification. Discovery · Not discovery · Uncertain.
 *   - **Agent action** — what it recommended doing about it.
 *   - **Human review** — Pending · Accepted · Corrected · Dismissed.
 *
 * Disagreements are the point, not a footnote: the header counts them, a quick
 * chip filters to them, and every count in the header is a filter you can
 * click. A ledger of 47 things the agent got right is mildly useful; a ledger
 * of the 6 times a person corrected it, why, and whether the next model
 * version improved, is the calibration loop design principle 11 ask for.
 *
 * Thresholds, prompt version, run id, transcript hash and workspace sha are
 * product telemetry, not row-level hierarchy — they live behind
 * "Evidence & decision details", collapsed (§12).
 */

export type DiscoveryEntry = DiscoveryLedgerEntry;

// ── Filters ──────────────────────────────────────────────────────────────────

const DECISIONS = [
  { key: 'discovery', label: 'Discovery' },
  { key: 'not-discovery', label: 'Not discovery' },
  { key: 'uncertain', label: 'Uncertain' },
  { key: 'unassessed', label: 'Not assessed' },
] as const;

/** Quick chips — the three questions people actually arrive with. */
const CHIPS = [
  { key: 'needs-review', label: 'Needs review' },
  { key: 'disagreed', label: 'Human disagreed' },
  { key: 'generated', label: 'Proposal generated' },
] as const;

const SORTS = [
  { key: 'date', label: 'Date' },
  { key: 'confidence', label: 'Confidence' },
] as const;

const FACETS = {
  decision: DECISIONS.map(d => d.key),
  review: DISPOSITIONS,
  reason: REASON_CODES,
};

const LIST = {
  defaults: { tab: '', q: '', sort: 'date', dir: 'desc' as const, chips: [], facets: { decision: '', review: '', reason: '' } },
  sorts: SORTS.map(s => s.key),
  chips: CHIPS.map(c => c.key),
  facets: FACETS,
};

/**
 * The row's decision: the class when assessed, otherwise why it was not.
 * @param e
 */
export function decisionKeyOf(e: DiscoveryEntry): string {
  return e.classification?.classification ?? 'unassessed';
}

/**
 * The three quick chips, as predicates. A row matches if it matches ANY active chip.
 * @param e
 * @param chip
 */
export function matchesChip(e: DiscoveryEntry, chip: string): boolean {
  switch (chip) {
    case 'needs-review':
      return e.disposition === 'pending' && e.classification !== null;
    case 'disagreed':
      return e.disposition === 'corrected';
    case 'generated':
      return e.route === 'generate';
    default:
      return true;
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

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

const PROPOSALS_HREF = '/dashboard/inbox?kind=proposal';

function reviewHref(e: DiscoveryEntry): string {
  return e.reviewActionRunId ? inboxHref('proposal', e.reviewActionRunId) : PROPOSALS_HREF;
}

const CLASS_TONE: Record<string, string> = {
  'discovery': 'text-brand-pass',
  'not-discovery': 'text-foreground',
  'uncertain': 'text-brand-borderline',
};

/**
 * The entity line under the title. An email address is not a company, so an
 * unresolved match says so and shows what is actually known instead of
 * dressing a contact's email up as an account.
 * @param e
 */
export function entityLine(e: DiscoveryEntry): string {
  const { entities } = e;
  const parts: string[] = [];
  if (entities.opportunity) {
    parts.push(entities.opportunity.label);
  } else if (entities.account) {
    parts.push(entities.account.label);
  } else {
    parts.push(entities.unresolvedKnown ? `Account not resolved — ${entities.unresolvedKnown}` : 'Account not resolved');
  }
  if (entities.sponsorDomain) {
    parts.push(`via ${entities.sponsorDomain}`);
  }
  return parts.join(' · ');
}

// ── The row ──────────────────────────────────────────────────────────────────

function Entry({ e }: { e: DiscoveryEntry }) {
  const cls = e.classification;
  const at = e.when ?? e.matchedAt;
  const legacy = cls?.semantics === 'legacy';
  const action = e.recommendedAction ? RECOMMENDED_ACTION_LABEL[e.recommendedAction] : null;
  const external = e.entities.attendees.filter(a => a.external);
  const internal = e.entities.attendees.filter(a => !a.external);

  return (
    <LedgerEntry
      data-testid="discovery-entry"
      title={e.title}
      when={timeLabel(at)}
      detail={entityLine(e)}
      verdict={cls
        ? <span data-testid="decision" className={cn('text-[13px] font-semibold', CLASS_TONE[cls.classification])}>{DISCOVERY_CLASS_LABEL[cls.classification]}</span>
        : <span className="text-[13px] text-muted-foreground">Not assessed</span>}
      state={cls?.reasonCode
        ? (
            <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px]" title={cls.reasonCodeFallback ? 'The model gave a reason outside the closed set; recorded as insufficient evidence rather than invented' : 'Reason code'}>
              {REASON_CODE_LABEL[cls.reasonCode]}
              {cls.reasonCodeFallback ? ' ·  unmatched' : ''}
            </span>
          )
        : null}
      scores={cls && (
        <>
          {/*
            Never a score without the class it belongs to: the number reads
            "Not discovery 95%", not "discovery 0.95" on a row that says the
            opposite. A legacy row shows NO percentage at all — its number was
            written under a meaning nobody defined, so asserting one now would
            be a fabrication in an audit record.
          */}
          {legacy
            ? (
                <span data-testid="legacy-confidence" className="text-[12px] text-muted-foreground italic">
                  Confidence not comparable — recorded before the scale was defined
                </span>
              )
            : (
                <>
                  <ConfidenceBars
                    value={cls.classificationConfidence}
                    subject={DISCOVERY_CLASS_LABEL[cls.classification]}
                    note="Confidence in the stated class"
                  />
                  <ConfidenceBars
                    value={cls.proposalReadinessConfidence}
                    subject={READINESS_CLASS_LABEL[cls.proposalReadiness]}
                    note="Confidence in the stated readiness"
                  />
                </>
              )}
        </>
      )}
      summary={cls?.reasonSummary || cls?.reasoning || null}
      human={(
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {action && (
            <span>
              {'Agent action: '}
              <span className="font-medium text-foreground/80">{action}</span>
            </span>
          )}
          <span aria-hidden className="text-muted-foreground/40">·</span>
          <span>
            {'Human review: '}
            <Link
              href={reviewHref(e)}
              data-testid="disposition"
              className={cn(
                'font-medium underline decoration-border underline-offset-2 hover:decoration-foreground',
                e.disposition === 'corrected' ? 'text-brand-fail' : e.disposition === 'accepted' ? 'text-brand-pass' : 'text-foreground/80',
              )}
            >
              {DISPOSITION_LABEL[e.disposition]}
              {e.humanDecision && e.disposition === 'corrected' ? ` (${e.humanDecision})` : ''}
              {' →'}
            </Link>
          </span>
          {e.skippedReason && <span className="text-brand-borderline">{`skipped: ${e.skippedReason}`}</span>}
        </span>
      )}
      details={(
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground/70">Matched</dt>
            <dd>{e.matchReason ?? '—'}</dd>
            {e.entities.opportunity && (
              <>
                <dt className="text-muted-foreground/70">Opportunity</dt>
                <dd>{e.entities.opportunity.label}</dd>
              </>
            )}
            <dt className="text-muted-foreground/70">Account</dt>
            <dd>
              {e.entities.accountResolved && e.entities.account
                ? e.entities.account.label
                : `Account not resolved${e.entities.unresolvedKnown ? ` — ${e.entities.unresolvedKnown}` : ''}`}
            </dd>
            {external.length > 0 && (
              <>
                <dt className="text-muted-foreground/70">Attendees</dt>
                <dd>{[...external, ...internal].map(a => a.email).join(' · ')}</dd>
              </>
            )}
            {e.thresholds && (
              <>
                <dt className="text-muted-foreground/70">Thresholds</dt>
                <dd className="tabular-nums">{`class ≥ ${e.thresholds.discovery} · readiness ≥ ${e.thresholds.ready}`}</dd>
              </>
            )}
            {cls && (
              <>
                <dt className="text-muted-foreground/70">Confidence means</dt>
                <dd>
                  {legacy
                    ? 'Unknown — written under the v1 prompt, which never defined it. Carried, never converted.'
                    : 'Confidence in the class stated beside it.'}
                </dd>
              </>
            )}
            {legacy && cls?.legacyScores && (
              <>
                <dt className="text-muted-foreground/70">Raw v1 numbers</dt>
                <dd className="font-mono tabular-nums">{`is_discovery_confidence ${cls.legacyScores.isDiscoveryConfidence} · proposal_ready_confidence ${cls.legacyScores.proposalReadyConfidence}`}</dd>
              </>
            )}
          </dl>
          {cls?.reasoning && <p className="max-w-3xl leading-relaxed">{cls.reasoning}</p>}
          {/* The meeting this verdict was read from, openable in the SHARED
              preview panel rather than a second panel of this page's own —
              `docs/design/patterns.md` § Preview where you are. The external
              id IS a citation (`granola:<id>`, `zoom:<uuid>`, `gcal:<id>`), so
              the registry resolves it with no work here. */}
          {e.meetingExternalId && (
            <div className="max-w-md">
              <EvidenceRefs sources={[e.meetingExternalId]} />
            </div>
          )}
          <ProvenanceLine
            items={[
              e.classifierVersion && { value: e.classifierVersion, title: 'Model + prompt version' },
              e.assessedBy?.agentSlug && { value: e.assessedBy.agentSlug, title: e.assessedBy.missionRunId ? `mission_run #${e.assessedBy.missionRunId}` : 'chat turn' },
              e.assessedBy?.missionRunId && { label: 'run', value: `#${e.assessedBy.missionRunId}`, title: 'mission_run' },
              e.transcriptHash && { label: 'transcript', value: e.transcriptHash.slice(0, 12), title: 'knowledge_document.contentHash at read time' },
              e.workspaceSha && { label: 'ws', value: e.workspaceSha.slice(0, 12), title: 'Workspace sha at assessment' },
            ]}
          />
        </>
      )}
    />
  );
}

// ── The header ───────────────────────────────────────────────────────────────

function Count(props: { value: number; label: string; onClick?: () => void; tone?: string; testId?: string }) {
  const body = (
    <>
      <span className={cn('font-semibold tabular-nums', props.tone)}>{props.value}</span>
      {` ${props.label}`}
    </>
  );
  if (!props.onClick) {
    return <span data-testid={props.testId}>{body}</span>;
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-testid={props.testId}
      className="rounded-sm underline decoration-border underline-offset-4 transition hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      {body}
    </button>
  );
}

// ── The ledger ───────────────────────────────────────────────────────────────

export function DiscoveryLedger(props: { entries: DiscoveryEntry[] }) {
  const [list, setList] = useListUrlState(LIST);
  const { q: query, sort, dir, chips, facets } = list;

  const calibration = useMemo(
    () => calibrationOf(props.entries.map(e => ({ assessed: e.classification !== null, disposition: e.disposition }))),
    [props.entries],
  );

  const delta = useMemo(() => {
    const assessed = props.entries.filter(e => e.classification !== null);
    const newest = [...assessed].sort((a, b) => ((a.classifiedAt ?? a.matchedAt) < (b.classifiedAt ?? b.matchedAt) ? 1 : -1))[0];
    return versionDelta(
      assessed.map(e => ({ classifierVersion: e.classifierVersion, disposition: e.disposition, assessedAt: e.classifiedAt ?? e.matchedAt })),
      newest?.classifierVersion ?? null,
    );
  }, [props.entries]);

  const counts = useMemo(() => {
    const decision: Record<string, number> = {};
    const review: Record<string, number> = {};
    const reason: Record<string, number> = {};
    const chip: Record<string, number> = {};
    for (const e of props.entries) {
      decision[decisionKeyOf(e)] = (decision[decisionKeyOf(e)] ?? 0) + 1;
      review[e.disposition] = (review[e.disposition] ?? 0) + 1;
      if (e.classification?.reasonCode) {
        reason[e.classification.reasonCode] = (reason[e.classification.reasonCode] ?? 0) + 1;
      }
      for (const c of CHIPS) {
        if (matchesChip(e, c.key)) {
          chip[c.key] = (chip[c.key] ?? 0) + 1;
        }
      }
    }
    return { decision, review, reason, chip };
  }, [props.entries]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = props.entries
      .filter(e => !facets.decision || decisionKeyOf(e) === facets.decision)
      .filter(e => !facets.review || e.disposition === facets.review)
      .filter(e => !facets.reason || e.classification?.reasonCode === facets.reason)
      .filter(e => chips.length === 0 || chips.some(c => matchesChip(e, c)))
      .filter(e => !q
        || e.title.toLowerCase().includes(q)
        || entityLine(e).toLowerCase().includes(q)
        || (e.matchReason ?? '').toLowerCase().includes(q)
        || (e.classification?.reasonSummary ?? '').toLowerCase().includes(q)
        || (e.classification?.reasoning ?? '').toLowerCase().includes(q));
    const direction = dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sort === 'confidence') {
        return ((a.classification?.classificationConfidence ?? -1) - (b.classification?.classificationConfidence ?? -1)) * direction;
      }
      const at = a.when ?? a.matchedAt;
      const bt = b.when ?? b.matchedAt;
      return at === bt ? 0 : (at < bt ? -1 : 1) * direction;
    });
  }, [props.entries, query, sort, dir, chips, facets]);

  const groups = useMemo(() => {
    const map = new Map<string, DiscoveryEntry[]>();
    for (const e of rows) {
      const k = dayKey(e.when ?? e.matchedAt);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return [...map.entries()];
  }, [rows]);

  const setFacet = (name: string, value: string) => setList({ facets: { ...facets, [name]: value }, chips: [] });

  const toolbarFacets: ToolbarFacet[] = [
    {
      name: 'decision',
      label: 'Decision',
      value: facets.decision ?? '',
      onChange: v => setFacet('decision', v),
      options: [{ key: '', label: 'Decision · all' }, ...DECISIONS.map(d => ({ key: d.key, label: d.label, count: counts.decision[d.key] ?? 0 }))],
    },
    {
      name: 'review',
      label: 'Human review',
      value: facets.review ?? '',
      onChange: v => setFacet('review', v),
      options: [{ key: '', label: 'Human review · all' }, ...DISPOSITIONS.map(d => ({ key: d, label: DISPOSITION_LABEL[d], count: counts.review[d] ?? 0 }))],
    },
    {
      name: 'reason',
      label: 'Reason',
      value: facets.reason ?? '',
      onChange: v => setFacet('reason', v),
      options: [
        { key: '', label: 'Reason · all' },
        ...REASON_CODES.filter(r => (counts.reason[r] ?? 0) > 0).map(r => ({ key: r, label: REASON_CODE_LABEL[r], count: counts.reason[r] ?? 0 })),
      ],
    },
  ];

  return (
    <div className="flex flex-col" data-testid="discovery-ledger">
      {/*
        The top of the page. Not "All 47 · generate 5 · confirm 11 · drop 31" —
        those were three different kinds of thing wearing one costume. These
        are the three numbers a revenue leader opens this page for, and every
        one of them filters the ledger when you click it.
      */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pb-3 text-[13px] text-muted-foreground" data-testid="ledger-summary">
        <Count value={calibration.assessed} label="assessed" testId="count-assessed" onClick={() => setList({ facets: { decision: '', review: '', reason: '' }, chips: [] })} />
        <span aria-hidden className="text-muted-foreground/40">·</span>
        {/* The count and the filter use the SAME predicate — the `needs-review`
            chip — so clicking a number never lands on a different set than the
            number promised. */}
        <Count value={calibration.needReview} label="need review" testId="count-need-review" tone="text-brand-borderline" onClick={() => setList({ facets: { decision: '', review: '', reason: '' }, chips: ['needs-review'] })} />
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <Count value={calibration.corrected} label="corrected" testId="count-corrected" tone="text-brand-fail" onClick={() => setList({ facets: { decision: '', review: '', reason: '' }, chips: ['disagreed'] })} />
        {calibration.agreementRate !== null && (
          <>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span data-testid="agreement-rate" title={`${calibration.accepted} accepted of ${calibration.decided} decided`}>
              <span className="font-semibold text-foreground/80 tabular-nums">{`${Math.round(calibration.agreementRate * 100)}%`}</span>
              {' agreement'}
            </span>
          </>
        )}
        {delta && (
          <span data-testid="version-delta" title={`vs ${delta.previousVersion}`} className="tabular-nums">
            {`${delta.points >= 0 ? '+' : ''}${delta.points} pts vs previous model version`}
          </span>
        )}
      </div>

      <ListToolbar
        facets={toolbarFacets}
        search={{ value: query, onChange: q => setList({ q }), placeholder: 'Find a meeting, account or reason' }}
        sort={{ value: sort, onChange: s => setList({ sort: s }), options: SORTS }}
        direction={{ value: dir, onChange: d => setList({ dir: d }) }}
        chips={{
          label: 'Quick filters',
          items: CHIPS.map(c => ({ key: c.key, label: c.label, count: counts.chip[c.key] ?? 0 })),
          active: chips,
          onChange: next => setList({ chips: next }),
        }}
      />

      {rows.length === 0
        ? <ListEmpty variant="inline" title={query ? 'No assessed call matches that search.' : 'Nothing under these filters.'} />
        : groups.map(([day, entries]) => (
            <LedgerGroup key={day} label={dayLabel(entries[0]!.when ?? entries[0]!.matchedAt)} count={entries.length}>
              {entries.map(e => <Entry key={e.id} e={e} />)}
            </LedgerGroup>
          ))}
    </div>
  );
}

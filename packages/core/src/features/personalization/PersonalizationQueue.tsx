'use client';

import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { ReviewActionCard } from '@/features/review/ReviewActionCard';
import { client } from '@/libs/Orpc';
import { cn } from '@/utils/Helpers';
import { confidenceLevel } from './confidence';
import { RegenerateBriefControl } from './RegenerateBriefControl';

/**
 * The personalization review queue — one lead per row, four lanes across the
 * top. A row expands to the brief that justifies it and, when the lead has a
 * pending personalization.enroll item, the SAME review card the review queue
 * shows, deciding the SAME run through the shared decide path (Decline /
 * Snooze / Enroll). A snoozed item's card is hidden here exactly as it is
 * hidden there, until its date.
 *
 * Nothing reaches this screen without a brief. A lead the sweep has picked up
 * but not yet researched, and a lead part-way through its retries, are both
 * absent by construction: the page is handed only rows that carry one. When
 * the tries run out the lead arrives anyway, carrying the error where the
 * brief would be, because a reviewer needs to see what failed.
 */

export type BriefRow = {
  id: number;
  contactRef: string;
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  triggerType: string;
  entranceSource: string | null;
  utmCampaign: string | null;
  engagementSent: number;
  engagementOpened: number;
  status: string;
  confidence: number | null;
  sections: Array<{ heading: string; body: string }>;
  claims: Array<{ text: string; kind: string; source: string; date?: string }>;
  missing: string[];
  /** Set when the tries ran out. Rendered where the brief would be. */
  briefError: string | null;
  briefAttempts: number;
  /** The instruction behind the last rewrite, kept so the brief has a why. */
  regenerateNote: string | null;
  /** The drafted, numbered sends (empty until the drafting pass runs). */
  draftSequence: Array<{ step: number; day?: number; subject: string; body: string }>;
  /** The EXISTING sequence the agent recommends enrolling into. */
  recommendedSequence: { id: string; name: string; reason?: string } | null;
  /** The pending review run this lead decides through, when one exists. */
  reviewActionRunId: number | null;
  /** Why the last drafting try produced nothing. */
  draftError: string | null;
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

const PILL: Record<string, { status: 'pending' | 'approved' | 'paused' | 'completed'; label: string }> = {
  queued: { status: 'paused', label: 'Queued' },
  ready_for_review: { status: 'pending', label: 'Review' },
  handed_off: { status: 'approved', label: 'Handed off' },
  held: { status: 'paused', label: 'Held' },
  sent: { status: 'completed', label: 'Sent' },
};

/**
 * A source that opens is a source a reviewer can check.
 * @param source
 */
function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

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

/** Fixed locale + UTC so the server render and the client render agree. */
const ARRIVED_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function arrivedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : ARRIVED_FORMAT.format(d);
}

/**
 * The entrance path is a CRM enum (`PAID_SOCIAL`, `ORGANIC_SEARCH`). Shown
 * raw it reads as a database value rather than how someone found us.
 * @param value
 */
function entranceLabel(value: string): string {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const BriefListRow = (props: {
  row: BriefRow;
  /** The pending enroll run this row decides through — absent when decided or snoozed. */
  run: ReviewCardRun | undefined;
  onDecided: () => void;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onExpand: () => void;
}) => {
  const { row } = props;
  const level = confidenceLevel(row.confidence);
  const pill = PILL[row.status] ?? { status: 'pending' as const, label: row.status };

  // The one-line "why this lead": who they are, when and how they arrived,
  // how warm. Anything the CRM does not carry is left out rather than shown
  // as a blank or a zero pretending to be a reading.
  const meta = [
    row.contactTitle,
    row.companyName,
    // The true stage-entry date wins; the create date is labeled as arrival,
    // never as when they became an MQL.
    row.mqlAt ? `MQL ${arrivedLabel(row.mqlAt)}` : row.arrivedAt ? `arrived ${arrivedLabel(row.arrivedAt)}` : null,
    row.entranceSource ? entranceLabel(row.entranceSource) : null,
    // "via", not "utm=": what the CRM carries is the source detail (the ad
    // network, the keyword), which is only sometimes a campaign tag.
    row.utmCampaign ? `via ${row.utmCampaign}` : null,
    row.engagementSent > 0 ? `${row.engagementSent} sent` : null,
    row.engagementOpened > 0 ? `${row.engagementOpened} opened` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-3 py-3">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={props.onSelect}
          aria-label={`Select ${row.contactName}`}
          className="size-4 accent-[var(--brand-borderline)]"
        />
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
        <button
          type="button"
          onClick={props.onExpand}
          aria-expanded={props.expanded}
          aria-label={`${props.expanded ? 'Hide' : 'Show'} brief for ${row.contactName}`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className={cn('size-4 transition-transform', props.expanded && 'rotate-90')} />
        </button>
      </div>

      {props.expanded && (
        <div className="pb-5 pl-7">
          {/* The decidable card — the SAME run the review queue decides. A
              snoozed or already-decided lead has no pending run, so the sends
              render read-only below instead. */}
          {props.run && (
            <div className="mb-6 max-w-3xl">
              <ReviewActionCard run={props.run} onDecided={props.onDecided} />
            </div>
          )}
          {!props.run && row.draftSequence.length > 0 && (
            <div className="mb-6 max-w-3xl rounded-md border border-border bg-muted/30 p-3">
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Outreach content ·
                {' '}
                {row.recommendedSequence ? `for ${row.recommendedSequence.name}` : 'drafted'}
              </div>
              {row.draftSequence.map(send => (
                <div key={send.step} className="border-t border-border/60 py-2 text-sm first:border-t-0">
                  <div className="font-semibold">
                    {send.day !== undefined ? `Day ${send.day}` : `Send ${send.step}`}
                    {' · '}
                    {send.subject}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">{send.body}</p>
                </div>
              ))}
            </div>
          )}
          {!props.run && row.draftSequence.length === 0 && row.draftError && (
            <p className="mb-4 max-w-3xl text-[13px] text-muted-foreground">
              Drafting has not produced sends yet:
              {' '}
              {row.draftError}
            </p>
          )}
          <div className="grid gap-6 text-sm @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              {row.regenerateNote && (
                <div className="mb-4 rounded-md border border-border bg-muted/40 p-3">
                  <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Rewritten on your instruction
                  </div>
                  <p className="whitespace-pre-line">{row.regenerateNote}</p>
                </div>
              )}

              {/* The error stands where the brief would be, so a lead that ran
                out of tries reads as a failure rather than a thin brief. */}
              {row.sections.length === 0 && row.briefError
                ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                      <h3 className="mb-1 text-xs font-semibold tracking-wide text-destructive uppercase">
                        No brief. Briefing failed
                        {' '}
                        {row.briefAttempts}
                        {row.briefAttempts === 1 ? ' time' : ' times'}
                      </h3>
                      <p className="whitespace-pre-line">{row.briefError}</p>
                      <p className="mt-2 text-[13px] text-muted-foreground">
                        The retries have stopped. Regenerate to put this lead back in line for another pass.
                      </p>
                    </div>
                  )
                : row.sections.length === 0
                  ? <p className="text-muted-foreground">No brief recorded.</p>
                  : (
                      <div className="flex flex-col gap-4">
                        {row.sections.map(section => (
                          <section key={section.heading}>
                            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                              {section.heading}
                            </h3>
                            {/* The skill writes markdown, so render it. Raw
                              `**Name:**` on the page is the reviewer reading
                              the syntax instead of the brief. `pre-line` keeps
                              the single newlines the brief writes one field
                              per line; markdown would otherwise run them into
                              one paragraph. */}
                            <div className="prose prose-sm max-w-none dark:prose-invert [&_p]:whitespace-pre-line">
                              <Markdown remarkPlugins={[remarkGfm]}>{section.body}</Markdown>
                            </div>
                          </section>
                        ))}
                      </div>
                    )}

              <div className="mt-4">
                <RegenerateBriefControl briefId={row.id} contactName={row.contactName} />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Claims
                </h3>
                {row.claims.length === 0
                  ? <p className="text-muted-foreground">No claims recorded.</p>
                  : (
                      <ul className="flex flex-col gap-2">
                        {row.claims.map(claim => (
                          <li key={`${claim.kind}-${claim.source}-${claim.text}`}>
                            <div>{claim.text}</div>
                            {/* Every claim carries its kind and where it came
                              from — an unsourced claim is not a claim, and a
                              fact and an inference are not the same thing. */}
                            <div className="text-[11px] text-muted-foreground">
                              {claim.kind}
                              {' · '}
                              {isUrl(claim.source)
                                ? (
                                    <a
                                      href={claim.source}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline underline-offset-2 hover:text-foreground"
                                    >
                                      {claim.source}
                                    </a>
                                  )
                                : claim.source}
                              {claim.date ? ` · ${claim.date}` : ''}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
              </div>

              {row.missing.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Missing
                  </h3>
                  <ul className="list-inside list-disc text-muted-foreground">
                    {row.missing.map(m => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}

              {level && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Confidence
                  </h3>
                  <p>
                    {row.confidence?.toFixed(2)}
                    {' · '}
                    {level}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    How well the evidence supports this brief and its angle, not a prediction that the
                    lead replies. The reason is in the brief's own confidence section.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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
  const router = useRouter();
  const [lane, setLane] = useState<string>(DEFAULT_LANE);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('arrived');
  const [descending, setDescending] = useState(true);
  const [selected, setSelected] = useState(() => new Set<number>());
  const [expanded, setExpanded] = useState<number | null>(null);
  // The pending enroll runs, keyed by run id: the SAME feed the review queue
  // reads, so snoozing there hides the card here and vice versa. A brief row
  // reaches its run through the reviewActionRunId back-link.
  const [runs, setRuns] = useState<Map<number, ReviewCardRun>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    void client.review.listPendingActions()
      .then((pending) => {
        if (cancelled) {
          return;
        }
        const next = new Map<number, ReviewCardRun>();
        for (const run of pending as unknown as Array<ReviewCardRun & { card?: ReviewCardRun['card'] }>) {
          if (run.actionId === 'personalization.enroll' && run.card) {
            next.set(run.id, run as ReviewCardRun);
          }
        }
        setRuns(next);
      })
      .catch(() => setRuns(new Map()));
    return () => {
      cancelled = true;
    };
  }, [briefs]);

  const onDecided = (runId: number) => {
    setRuns((prev) => {
      const next = new Map(prev);
      next.delete(runId);
      return next;
    });
    // The lane flip happened server-side; re-render the page's rows.
    router.refresh();
  };

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

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)));
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };

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
        : (
            <>
              <div className="flex items-center gap-3 border-b border-border py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                  className="size-4 accent-[var(--brand-borderline)]"
                />
                {selected.size === 0
                  ? <span className="text-muted-foreground">Select all</span>
                  : (
                      <span className="font-medium">
                        {selected.size}
                        {' '}
                        selected
                        <span className="ml-2 font-normal text-muted-foreground">
                          Decisions are per lead: expand a row to Decline, Snooze or Enroll on its card.
                        </span>
                      </span>
                    )}
              </div>

              {rows.map(row => (
                <BriefListRow
                  key={row.id}
                  row={row}
                  run={row.reviewActionRunId != null ? runs.get(row.reviewActionRunId) : undefined}
                  onDecided={() => row.reviewActionRunId != null && onDecided(row.reviewActionRunId)}
                  selected={selected.has(row.id)}
                  expanded={expanded === row.id}
                  onSelect={() => toggleOne(row.id)}
                  onExpand={() => setExpanded(expanded === row.id ? null : row.id)}
                />
              ))}
            </>
          )}
    </div>
  );
};

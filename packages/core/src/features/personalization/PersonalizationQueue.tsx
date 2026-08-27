'use client';

import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/utils/Helpers';
import { confidenceLevel } from './confidence';

/**
 * The personalization review queue — one lead per row, four lanes across the
 * top. A row expands to the brief that justifies it: the claims with their
 * sources, what research could not find, and the drafted sequence.
 *
 * Scaffold status: the queue reads real `lead_brief` rows and every lane,
 * filter and sort is live. The lane-moving actions (hand off / hold / send)
 * are rendered DISABLED until the review action ships, because a
 * button that looks like it moves a lead and doesn't is worse than no button.
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
  claims: Array<{ text: string; kind: string; source: string; date?: string }>;
  missing: string[];
  draftSequence: Array<{ step: number; subject: string; body: string }>;
  briefedAt: string | null;
};

/** Lane order is the review order: what needs you, then what you did with it. */
const LANES = [
  { key: 'ready_for_review', label: 'Ready for review' },
  { key: 'handed_off', label: 'Hand off' },
  { key: 'held', label: 'Held' },
  { key: 'sent', label: 'Sent' },
] as const;

const PILL: Record<string, { status: 'pending' | 'approved' | 'paused' | 'completed'; label: string }> = {
  ready_for_review: { status: 'pending', label: 'Ready for review' },
  handed_off: { status: 'approved', label: 'Handed off' },
  held: { status: 'paused', label: 'Held' },
  sent: { status: 'completed', label: 'Sent' },
};

type SortKey = 'confidence' | 'briefed' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'briefed', label: 'Briefed' },
  { key: 'name', label: 'Name' },
];

const BriefListRow = (props: {
  row: BriefRow;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onExpand: () => void;
}) => {
  const { row } = props;
  const level = confidenceLevel(row.confidence);
  const pill = PILL[row.status] ?? { status: 'pending' as const, label: row.status };

  // The one-line "why this lead": who they are, how they arrived, how warm.
  const meta = [
    row.contactTitle,
    row.companyName,
    row.entranceSource,
    row.utmCampaign ? `utm=${row.utmCampaign}` : null,
    `${row.engagementSent} sent`,
    `${row.engagementOpened} opened`,
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
        <div className="grid gap-5 pb-5 pl-7 text-sm @2xl:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Brief</h3>
            {row.claims.length === 0
              ? <p className="text-muted-foreground">No claims recorded.</p>
              : (
                  <ul className="flex flex-col gap-2">
                    {row.claims.map(claim => (
                      <li key={`${claim.kind}-${claim.source}-${claim.text}`}>
                        <div>{claim.text}</div>
                        {/* Every claim carries where it came from — an
                            unsourced claim is not a claim. */}
                        <div className="text-[11px] text-muted-foreground">
                          {claim.kind}
                          {' · '}
                          {claim.source}
                          {claim.date ? ` · ${claim.date}` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

            {row.missing.length > 0 && (
              <div className="mt-3">
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Could not find
                </h3>
                <ul className="list-inside list-disc text-muted-foreground">
                  {row.missing.map(m => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sequence</h3>
            {row.draftSequence.length === 0
              ? <p className="text-muted-foreground">No sequence drafted yet.</p>
              : (
                  <ol className="flex flex-col gap-3">
                    {row.draftSequence.map(step => (
                      <li key={step.step} className="rounded-md border border-border p-3">
                        <div className="mb-1 text-[11px] text-muted-foreground">
                          Step
                          {' '}
                          {step.step}
                        </div>
                        <div className="font-medium">{step.subject}</div>
                        <p className="mt-1 whitespace-pre-line text-muted-foreground">{step.body}</p>
                      </li>
                    ))}
                  </ol>
                )}
          </div>
        </div>
      )}
    </div>
  );
};

export const PersonalizationQueue = (props: { briefs: BriefRow[] }) => {
  const [lane, setLane] = useState<string>('ready_for_review');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('confidence');
  const [descending, setDescending] = useState(true);
  const [selected, setSelected] = useState(() => new Set<number>());
  const [expanded, setExpanded] = useState<number | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: props.briefs.length };
    for (const b of props.briefs) {
      c[b.status] = (c[b.status] ?? 0) + 1;
    }
    return c;
  }, [props.briefs]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = props.briefs
      .filter(b => lane === 'all' || b.status === lane)
      .filter(b => !q
        || b.contactName.toLowerCase().includes(q)
        || (b.companyName ?? '').toLowerCase().includes(q));

    const direction = descending ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sort === 'name') {
        return a.contactName.localeCompare(b.contactName) * -direction;
      }
      if (sort === 'briefed') {
        return ((a.briefedAt ?? '') < (b.briefedAt ?? '') ? -1 : 1) * direction;
      }
      return ((a.confidence ?? 0) - (b.confidence ?? 0)) * direction;
    });
  }, [props.briefs, lane, query, sort, descending]);

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
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {selected.size}
                          {' '}
                          selected
                        </span>
                        {/* Disabled until `personalization.review_brief` ships.
                            The aria-label distinguishes the ACTION from the
                            same-named lane tab above it. */}
                        {['Hand off', 'Hold', 'Send'].map(action => (
                          <button
                            key={action}
                            type="button"
                            disabled
                            aria-label={`${action} ${selected.size} selected`}
                            title="Lane actions arrive with the review action (personalization.review_brief)"
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground opacity-50"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    )}
              </div>

              {rows.map(row => (
                <BriefListRow
                  key={row.id}
                  row={row}
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

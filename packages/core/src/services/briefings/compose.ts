/**
 * The composer — the editorial layer (`docs/specs/briefing-v2.md` §4).
 *
 * > You have a briefing inside a briefing. "From the revops briefing" starts
 * > another dated briefing … This exposes the agent/org structure instead of
 * > synthesizing it. The workspace briefing should be the editorial layer
 * > above the team briefings. It should ingest RevOps, Deal Desk, Founder
 * > GTM, etc., resolve duplication, prioritize across them, and produce one
 * > coherent answer.
 *
 * So a workspace briefing is composed FROM team briefings, never concatenated
 * with them. The team briefings survive as **sources** (section 8,
 * `composedFrom` + a `team-briefing` source row), which is the only place the
 * org structure is allowed to show through. Nothing is inlined and no section
 * is titled after a team.
 *
 * Three steps, each testable on its own:
 *
 *   1 **de-duplicate** — two teams reporting the same claim is one claim.
 *     Metrics and changes collapse on `key`, critical-path items on time +
 *     label, exceptions on `key`, detail tables on title. The surviving copy
 *     keeps the strongest provenance and the union of the evidence, so
 *     merging never loses a citation.
 *   2 **rank across teams** — one score per claim, so a RevOps number and a
 *     Deal Desk number compete on the same scale rather than on whose brief
 *     came first. Provenance the system can stand behind outranks a
 *     self-report; something that MOVED outranks something that did not; a
 *     bigger relative move outranks a smaller one; the caller's team order
 *     breaks what is left, and the key breaks that.
 *   3 **enforce** — deltas joined against the prior brief, the on-track
 *     verdict derived, every budget applied, the narrative redacted
 *     (`enforceBriefing`).
 *
 * Pure: the caller does the reading.
 */

import type {
  BriefingDecision,
  BriefingException,
  BriefingHistoryEntry,
  BriefingMetric,
  BriefingSource,
  BriefingV2,
  CriticalPathItem,
  DetailTable,
  RecordRef,
} from './document';
import type { RedactionVocabulary } from './redact';
import type { BriefingIssue } from './validate';
import type { ProvenanceKind } from '@/libs/workspace/schemas';
import { capHistory } from './budget';
import { computeChanges, joinDeltas, narrateChanges, rankChanges } from './deltas';
import { deriveOnTrack } from './onTrack';
import { enforceBriefing } from './validate';

/** One team's own brief, as a source for the workspace brief. */
export type TeamBriefingSource = {
  briefingId: number;
  teamSlug: string;
  teamName: string;
  at: Date;
  doc: BriefingV2;
};

/** How much a reading's provenance counts when two teams disagree. */
const PROVENANCE_RANK: Record<ProvenanceKind, number> = {
  'verified': 3,
  'observed': 2,
  'human-confirmed': 1,
  'agent-reported': 0,
};

function mergeEvidence(a: RecordRef[], b: RecordRef[]): RecordRef[] {
  const seen = new Set<string>();
  const out: RecordRef[] = [];
  for (const ref of [...a, ...b]) {
    const k = `${ref.kind}:${ref.id}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(ref);
    }
  }
  return out;
}

/**
 * Normalised text, for claims that collapse on wording rather than a key.
 * @param s - The text.
 */
function claimKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Collapse the same metric reported by several teams into one. The strongest
 * provenance wins the number; evidence is unioned either way.
 * @param entries - `{ metric, teamRank }` across every team brief.
 */
export function dedupeMetrics(entries: { metric: BriefingMetric; teamRank: number }[]): { metric: BriefingMetric; teamRank: number }[] {
  const byKey = new Map<string, { metric: BriefingMetric; teamRank: number }>();
  for (const entry of entries) {
    const held = byKey.get(entry.metric.key);
    if (!held) {
      byKey.set(entry.metric.key, { ...entry, metric: { ...entry.metric, evidence: entry.metric.evidence ?? [] } });
      continue;
    }
    const stronger = PROVENANCE_RANK[entry.metric.provenance] > PROVENANCE_RANK[held.metric.provenance]
      || (PROVENANCE_RANK[entry.metric.provenance] === PROVENANCE_RANK[held.metric.provenance] && entry.teamRank < held.teamRank);
    const winner = stronger ? entry : held;
    const loser = stronger ? held : entry;
    byKey.set(entry.metric.key, {
      teamRank: Math.min(entry.teamRank, held.teamRank),
      metric: { ...winner.metric, evidence: mergeEvidence(winner.metric.evidence ?? [], loser.metric.evidence ?? []) },
    });
  }
  return [...byKey.values()];
}

/**
 * The cross-team score for one metric. Higher sorts first.
 *
 * Movement is the point of a recurring brief (spec §5), so a metric that
 * moved outranks a static one even when the static one is bigger; provenance
 * outranks both, because a number the system cannot stand behind should not
 * lead the page.
 * @param metric - The metric.
 * @param teamRank - Its team's position in the caller's order (0 = first).
 */
export function metricScore(metric: BriefingMetric, teamRank: number): number {
  const provenance = PROVENANCE_RANK[metric.provenance] * 10;
  const moved = metric.delta !== undefined && metric.delta !== 0 ? 6 : 0;
  const size = metric.delta !== undefined && metric.previous ? Math.min(4, Math.abs(metric.delta / metric.previous) * 10) : 0;
  const unavailable = metric.unavailable ? -3 : 0;
  return provenance + moved + size + unavailable - teamRank * 0.5;
}

/**
 * Rank metrics across teams. Deterministic: key breaks every tie.
 * @param entries - Metric/teamRank pairs.
 */
export function rankMetrics(entries: { metric: BriefingMetric; teamRank: number }[]): BriefingMetric[] {
  return [...entries]
    .sort((a, b) => {
      const d = metricScore(b.metric, b.teamRank) - metricScore(a.metric, a.teamRank);
      return d !== 0 ? d : a.metric.key.localeCompare(b.metric.key);
    })
    .map(e => e.metric);
}

/**
 * Collapse repeated critical-path items; the earliest time and the fullest status win.
 * @param items - The items to collapse.
 */
export function dedupeCriticalPath(items: CriticalPathItem[]): CriticalPathItem[] {
  const byKey = new Map<string, CriticalPathItem>();
  for (const item of items) {
    const k = `${item.order}|${claimKey(item.label)}`;
    const held = byKey.get(k);
    if (!held) {
      byKey.set(k, { ...item, evidence: item.evidence ?? [] });
      continue;
    }
    byKey.set(k, {
      ...held,
      status: held.status ?? item.status,
      owner: held.owner ?? item.owner,
      evidence: mergeEvidence(held.evidence ?? [], item.evidence ?? []),
    });
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

const SEVERITY_RANK = { blocker: 2, risk: 1, missing: 0 } as const;

/**
 * Collapse repeated exceptions; the most severe copy survives, evidence unioned.
 * @param items - The items to collapse.
 */
export function dedupeExceptions(items: BriefingException[]): BriefingException[] {
  const byKey = new Map<string, BriefingException>();
  for (const item of items) {
    const k = item.key || claimKey(item.label);
    const held = byKey.get(k);
    if (!held) {
      byKey.set(k, { ...item, evidence: item.evidence ?? [] });
      continue;
    }
    const worse = SEVERITY_RANK[item.severity] > SEVERITY_RANK[held.severity] ? item : held;
    const other = worse === item ? held : item;
    byKey.set(k, { ...worse, evidence: mergeEvidence(worse.evidence ?? [], other.evidence ?? []) });
  }
  return [...byKey.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.key.localeCompare(b.key));
}

export type ComposeInput = {
  title: string;
  dateLabel: string;
  updatedLabel: string;
  /** The team briefs to compose from, in the order the caller wants ties broken. */
  teams: TeamBriefingSource[];
  /**
   * The composing agent's OWN claims — what a team lead reports about its own
   * team, and what a workspace lead adds on top of the team briefs. Ranked
   * ahead of every team source, since it is the editorial voice.
   */
  own?: { metrics?: BriefingMetric[]; criticalPath?: CriticalPathItem[]; exceptions?: BriefingException[]; detail?: DetailTable[] };
  /** Scope. Null = the workspace brief; a slug = that team's own. */
  teamSlug?: string | null;
  /** The previous workspace brief's document — where deltas come from. Null on the first brief. */
  prior: BriefingV2 | null;
  /** One editorial sentence. Optional; the metrics line stands on its own. */
  summary?: string;
  /** "Needs your decision", already lane-split and ranked by `decisions.ts`. */
  decisions?: { judgment: BriefingDecision[]; queued: { batchable: number; background: number } };
  /** `key` → one clause, from the model. A clause naming no computed change is dropped. */
  narratives?: Record<string, string>;
  /** Whether a target exists in this workspace, even if nothing readable measures it yet. */
  targetSet?: boolean;
  /** Section 7, when something mattered. Omitted otherwise — a roster of zeroes is not content. */
  agentActivity?: BriefingV2['agentActivity'];
  /** Extra sources beyond the team briefs themselves — connectors, ledgers. */
  sources?: BriefingSource[];
  runs?: { runs: number; failed: number; spendCents: number };
  history?: BriefingHistoryEntry[];
  historyTotal?: number;
  vocab?: RedactionVocabulary;
};

/**
 * Compose one workspace briefing from the teams' own.
 * @param input - Everything the composer needs, already read.
 */
export function composeWorkspaceBriefing(input: ComposeInput): { doc: BriefingV2; dropped: BriefingIssue[] } {
  // Rank 0 is the composing agent's own voice; the team briefs follow.
  const ranked = input.teams.map((t, i) => ({ ...t, teamRank: i + 1 }));
  const own = input.own ?? {};

  // 1 — de-duplicate, 2 — rank across teams.
  const metrics = rankMetrics(dedupeMetrics([
    ...(own.metrics ?? []).map(metric => ({ metric, teamRank: 0 })),
    ...ranked.flatMap(t => (t.doc.today?.metrics ?? []).map(metric => ({ metric, teamRank: t.teamRank }))),
  ]));
  const criticalPath = dedupeCriticalPath([...(own.criticalPath ?? []), ...ranked.flatMap(t => t.doc.criticalPath?.items ?? [])]);
  const exceptions = dedupeExceptions([...(own.exceptions ?? []), ...ranked.flatMap(t => t.doc.exceptions?.items ?? [])]);
  const detailTables = dedupeDetail([...(own.detail ?? []), ...ranked.flatMap(t => t.doc.detail?.tables ?? [])]);

  // 3 — deltas against the PRIOR WORKSPACE BRIEF, by key. Never against a team brief.
  const joined = joinDeltas(metrics, input.prior?.today?.metrics ?? null);
  const changes = rankChanges(narrateChanges(computeChanges(joined, input.prior?.today?.metrics ?? null), input.narratives ?? {}));
  const onTrack = deriveOnTrack(joined, { targetSet: input.targetSet ?? false });

  const teamSources: BriefingSource[] = ranked.map(t => ({
    label: `${t.teamName} briefing`,
    kind: 'team-briefing',
    href: `/dashboard/briefings/${t.briefingId}`,
    asOf: t.at,
  }));

  const history = capHistory(input.history ?? []);

  const draft: BriefingV2 = {
    version: 2,
    title: input.title,
    dateLabel: input.dateLabel,
    updatedLabel: input.updatedLabel,
    teamSlug: input.teamSlug ?? null,
    composedFrom: ranked.map(t => ({ briefingId: t.briefingId, teamSlug: t.teamSlug, teamName: t.teamName, at: t.at })),
    today: { ...(input.summary ? { summary: input.summary } : {}), metrics: joined, onTrack },
    ...(input.decisions ? { decisions: { ...input.decisions, href: '/dashboard/inbox' } } : {}),
    changes: { items: changes },
    criticalPath: { items: criticalPath },
    exceptions: { items: exceptions },
    detail: { tables: detailTables },
    ...(input.agentActivity ? { agentActivity: input.agentActivity } : {}),
    provenance: {
      sources: [...teamSources, ...(input.sources ?? [])],
      footnotes: [],
      ...(input.runs ? { runs: input.runs } : {}),
    },
    history: {
      entries: history,
      viewAllHref: '/dashboard/briefings/archive',
      total: input.historyTotal ?? history.length,
    },
  };

  return enforceBriefing(draft, input.vocab ?? {});
}

/**
 * Collapse detail tables sharing a title; identical rows survive once.
 * @param tables - The tables to collapse.
 */
export function dedupeDetail(tables: DetailTable[]): DetailTable[] {
  const byTitle = new Map<string, DetailTable>();
  for (const t of tables) {
    const k = claimKey(t.title);
    const held = byTitle.get(k);
    if (!held) {
      byTitle.set(k, { title: t.title, columns: [...t.columns], rows: t.rows.map(r => [...r]), ...(t.note ? { note: t.note } : {}) });
      continue;
    }
    const seen = new Set(held.rows.map(r => r.join(' ')));
    for (const row of t.rows) {
      const rk = row.join(' ');
      if (!seen.has(rk)) {
        seen.add(rk);
        held.rows.push([...row]);
      }
    }
  }
  return [...byTitle.values()];
}

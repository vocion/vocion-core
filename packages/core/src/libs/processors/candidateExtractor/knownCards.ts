/**
 * The `<known>` block: the cards already waiting for review that this source's
 * next record might be another date of, or the same thing as.
 *
 * Loaded ONCE per sync, on the shared `syncContext`, and rendered into every
 * document's call. That is what makes the model's `seriesOf` / `duplicateOf`
 * answer cost nothing extra: no second call, no classifier, just context it
 * already had to read a prompt to use.
 *
 * Four rules that look fussy and are each load-bearing:
 *
 *   - **The aggregator check comes BEFORE normalising.** A source with no
 *     `defaults[keyedBy]` gets no block at all. Normalising a blank value
 *     yields `none`, which is exactly what a venue-less card's key segment
 *     holds, so a blank would match every venue-less card in the org.
 *   - **The key segment is compared, not the stored field.** A card's venue
 *     lives in `input.fields`, but what identifies it is the normalised
 *     segment inside its dedup key, so the comparison reproduces
 *     `normaliseForKey`, 80-char slice included, by calling it.
 *   - **The query is bounded by `ORDER BY id DESC LIMIT 5000`.** Only
 *     `(org_id, status)` serves it; there is no index on `action_id` or on
 *     `input`. At roughly 150 syncs a day that is cheap, and an
 *     `(org_id, action_id)` index is the named fix if it stops being.
 *   - **Dates are parsed, never compared as text.** A stored value may be
 *     date-only or a full timestamp, and "2026-9-1" sorts nowhere useful.
 *
 * One known limit: cards proposed earlier in the SAME sync are not in the
 * block, because it is loaded once. The deterministic sibling rule in
 * `labels.ts` is what catches those.
 */

import type { ProcessorSyncContext } from '../types';
import type { CandidateExtractorConfig } from './config';
import { candidateKeySegments, normaliseForKey } from '@/libs/actions/objects-propose-candidate';

/**
 * Rows read per sync. The query cannot be narrowed further by index today, so
 * it is bounded by the newest N runs instead.
 */
const SCAN_LIMIT = 5_000;

/** Statuses a card can be in and still be worth comparing against. */
const KNOWN_STATUSES = ['pending', 'failed', 'done'] as const;

/** One card, as the block prints it. */
export type KnownCard = {
  runId: number;
  /** Calendar date as stored, for ordering and for the line. */
  date: string;
  title: string;
  /** The anchor's evidence field, a recurrence description, usually. */
  evidence: string;
  /**
   * The card's own series group, read from `seriesLabel.keyField`, or null
   * when it carries none (the anchor of a group always does) and when no key
   * field is configured. A record naming this card inherits this value rather
   * than the card's id, which is what keeps a group one hop deep.
   */
  seriesKey: string | null;
};

export type KnownCards = {
  cards: KnownCard[];
  /** The rendered block, already capped. Empty for an aggregator source. */
  text: string;
  /** Ids the prompt actually carried, the only ones a model answer may name. */
  ids: Set<number>;
};

/** Nothing known: an aggregator source, or a config that asked for no block. */
const EMPTY: KnownCards = { cards: [], text: '', ids: new Set() };

/**
 * A stored date value as a calendar day, tolerant of what a model wrote.
 *
 * Accepts `2026-11-01`, `2026-11-01T20:00`, `2026-11-01T20:00:00Z` and the
 * looser things a page yields. Returns null rather than guessing.
 * @param value - The stored field value.
 */
export function calendarDayOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${(month as string).padStart(2, '0')}-${(day as string).padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

/**
 * A calendar day N days after another.
 * @param day - The starting day, `YYYY-MM-DD`.
 * @param days - Days to add.
 */
function dayPlus(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * Strip what a semi-trusted block is not allowed to carry.
 *
 * These lines are earlier MODEL output stored on a card, so they are treated
 * the way adopted rules are: no code fences, no closing-tag openers, one line
 * each.
 * @param value - A title or evidence string off a stored card.
 */
function scrubCardText(value: unknown): string {
  return String(value ?? '')
    .replace(/```/g, '')
    .replace(/<\//g, '< /')
    .replace(/[\n\r|]+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * Load and render this source's known cards, once per sync.
 * @param opts - What the block is built from.
 * @param opts.orgId - Org whose queue is read.
 * @param opts.config - The source's processor config.
 * @param opts.syncContext - Shared across every document of this sync.
 * @param opts.today - Today as a calendar day in the config's timezone.
 */
export async function loadKnownCards(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  syncContext: ProcessorSyncContext;
  today: string;
}): Promise<KnownCards> {
  const known = opts.config.knownCandidates;
  if (!known) {
    return EMPTY;
  }

  // BEFORE normalising: a source that names no default for the keyed-by field
  // is an aggregator, and gets no block. See the file header.
  const keyValue = opts.config.defaults?.[known.keyedBy];
  if (keyValue === undefined || keyValue === null || String(keyValue).trim() === '') {
    return EMPTY;
  }

  const cacheKey = `knownCards:${opts.config.objectType}:${known.keyedBy}:${String(keyValue)}`;
  const cached = opts.syncContext.cache.get(cacheKey);
  if (cached) {
    return cached as KnownCards;
  }

  const segmentIndex = opts.config.dedupOn.indexOf(known.keyedBy);
  if (segmentIndex < 0) {
    // Validated at apply time by `validateSourceProcessor`
    // (`libs/sources/upsert.ts`); belt here, because a key segment that does
    // not exist would compare against undefined and match nothing silently,
    // and because a row written before that check existed can still be read.
    return EMPTY;
  }

  const loaded = await queryKnownCards({ ...opts, known, keyValue, segmentIndex });
  opts.syncContext.cache.set(cacheKey, loaded);
  return loaded;
}

/**
 * The query and the rendering. Split out so `loadKnownCards` reads as the
 * caching and guard layer it is.
 * @param opts - Everything already resolved by the caller.
 * @param opts.orgId - Org whose queue is read.
 * @param opts.config - The source's processor config.
 * @param opts.known - The `knownCandidates` block, present by now.
 * @param opts.keyValue - The source's own value for the keyed-by field.
 * @param opts.segmentIndex - Position of that field in `dedupOn`.
 * @param opts.today - Today as a calendar day.
 */
async function queryKnownCards(opts: {
  orgId: string;
  config: CandidateExtractorConfig;
  known: NonNullable<CandidateExtractorConfig['knownCandidates']>;
  keyValue: unknown;
  segmentIndex: number;
  today: string;
}): Promise<KnownCards> {
  const { and, desc, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');

  const rows = await db
    .select({ id: actionRunSchema.id, dedupKey: actionRunSchema.dedupKey, input: actionRunSchema.input })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, opts.orgId),
      eq(actionRunSchema.actionId, 'objects.propose_candidate'),
      inArray(actionRunSchema.status, [...KNOWN_STATUSES]),
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(SCAN_LIMIT);

  const wantedType = normaliseForKey(opts.config.objectType);
  const wantedKey = normaliseForKey(opts.keyValue);
  const until = dayPlus(opts.today, opts.known.horizonDays);
  const evidenceField = opts.config.seriesLabel?.evidenceField;
  const keyField = opts.config.seriesLabel?.keyField;

  const cards: KnownCard[] = [];
  for (const row of rows) {
    const segments = candidateKeySegments(row.dedupKey);
    if (!segments || segments.objectType !== wantedType) {
      continue;
    }
    if (segments.values[opts.segmentIndex] !== wantedKey) {
      continue;
    }
    const fields = (row.input?.fields ?? {}) as Record<string, unknown>;
    const day = calendarDayOf(fields[opts.known.dateField]);
    if (!day || day < opts.today || day > until) {
      continue;
    }
    cards.push({
      runId: row.id,
      date: day,
      title: scrubCardText(row.input?.title ?? fields[opts.config.titleFrom]),
      evidence: evidenceField ? scrubCardText(fields[evidenceField]) : '',
      // Not scrubbed, and deliberately: the key is never rendered into the
      // block, it is only read back by `labels.ts`, and a blank reads as "this
      // card is the root of its own group".
      seriesKey: keyField ? (String(fields[keyField] ?? '').trim() || null) : null,
    });
  }

  cards.sort((a, b) => (a.date === b.date ? a.runId - b.runId : a.date.localeCompare(b.date)));

  const kept: KnownCard[] = [];
  const lines: string[] = [];
  let chars = 0;
  for (const card of cards) {
    if (kept.length >= opts.known.maxItems) {
      break;
    }
    const line = `#${card.runId} | ${card.date} | ${card.title} | ${card.evidence || '-'}`;
    if (chars + line.length + 1 > opts.known.maxChars) {
      break;
    }
    kept.push(card);
    lines.push(line);
    chars += line.length + 1;
  }

  return { cards: kept, text: lines.join('\n'), ids: new Set(kept.map(card => card.runId)) };
}

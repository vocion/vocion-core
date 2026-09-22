import { z } from 'zod';

/**
 * Reason codes - why a piece of work is in flight or queued next.
 *
 * A person must be able to ask "why this, why now" of anything the factory
 * intends to do and get an answer grounded in their own rules, not a number.
 * A priority integer is not an answer: 62 says nothing about what the factory
 * believed when it put the item there.
 *
 * So every significant record may carry `meta.why` - an array of codes from
 * the closed list below - and `meta.whyNote`, one sentence of prose beside
 * them. This module is the only place the list is written down. The write
 * side stamps the codes; the read side (the `next` panel of the `overview`
 * archetype) turns them into phrases.
 *
 * Two rules hold here and they are the point:
 *
 *  1. The list is CLOSED. A string that is not on it is not quietly rendered
 *     as if it were a reason - {@link readReasons} keeps it aside under
 *     `unrecognised` so a typo on the write side is visible, not invisible.
 *  2. Absence is reported, never filled in. A record with no `meta.why` gets
 *     {@link NO_REASON_RECORDED}, not a reason inferred from its status, its
 *     priority or its title. An honest blank beats a plausible invention.
 */

export const REASON_CODES = [
  'user_request',
  'production_bug',
  'blocks_goal',
  'breaks_promise',
  'required_for_dogfood',
  'manual_toil',
  'platform_leverage',
  'factory_reliability',
  'observed_behaviour',
] as const;

export type ReasonCode = typeof REASON_CODES[number];

/** The codes as a zod enum, for manifests and for the write side's payloads. */
export const ReasonCodeSchema = z.enum(REASON_CODES);

/**
 * The phrase each code reads as. Written as a clause that completes "we are
 * doing this because …", so several of them join with a separator and still
 * read as English.
 */
const PHRASES: Record<ReasonCode, string> = {
  user_request: 'a person asked for it',
  production_bug: 'it is broken in production',
  blocks_goal: 'it blocks a goal',
  breaks_promise: 'it breaks a promise we made',
  required_for_dogfood: 'we cannot dogfood without it',
  manual_toil: 'it removes manual toil',
  platform_leverage: 'it pays off across products',
  factory_reliability: 'the factory is unreliable without it',
  observed_behaviour: 'we watched people hit it',
};

/** What the page says when a record carries no reason at all. */
export const NO_REASON_RECORDED = 'no reason recorded';

/**
 * Whether a value is one of the closed list.
 * @param value - Anything read off a record.
 */
export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === 'string' && (REASON_CODES as readonly string[]).includes(value);
}

/**
 * The human phrase for one code.
 * @param code - A code from the closed list.
 */
export function reasonPhrase(code: ReasonCode): string {
  return PHRASES[code];
}

export type ReadReasons = {
  /** Codes from the closed list, deduped, in the order the record listed them. */
  codes: ReasonCode[];
  /** Strings on `meta.why` that are NOT on the list - surfaced, never rendered as reasons. */
  unrecognised: string[];
  /** `meta.whyNote` (or the first note field a caller names), trimmed. */
  note: string | null;
  /** True when the record carried at least one recognised code. */
  recorded: boolean;
};

const EMPTY: ReadReasons = { codes: [], unrecognised: [], note: null, recorded: false };

function firstString(meta: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const raw = meta[key];
    if (typeof raw === 'string' && raw.trim() !== '') {
      return raw.trim();
    }
  }
  return null;
}

/**
 * Read `meta.why` / `meta.whyNote` off a record's metadata.
 *
 * `noteFields` lets a page name where the prose lives, because a workspace
 * that recorded its reasoning under another key before this module existed
 * should be able to show that prose rather than a blank. The CODES are never
 * configurable: they come from `meta.why` and nowhere else, so a page cannot
 * promote an arbitrary field into a reason code.
 * @param meta - The record's metadata object (anything else reads as empty).
 * @param noteFields - Metadata keys to try for the prose note, in order.
 */
export function readReasons(meta: unknown, noteFields: readonly string[] = ['whyNote']): ReadReasons {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    return EMPTY;
  }
  const record = meta as Record<string, unknown>;
  const raw = record.why;
  const listed = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const codes: ReasonCode[] = [];
  const unrecognised: string[] = [];
  for (const one of listed) {
    if (isReasonCode(one)) {
      if (!codes.includes(one)) {
        codes.push(one);
      }
    } else if (typeof one === 'string' && one.trim() !== '' && !unrecognised.includes(one.trim())) {
      unrecognised.push(one.trim());
    }
  }
  return { codes, unrecognised, note: firstString(record, noteFields), recorded: codes.length > 0 };
}

/**
 * The one line a surface shows for a record's reasons.
 *
 * With codes: "a person asked for it · it blocks a goal". With a note and no
 * codes: the note, prefixed so nobody mistakes prose for a code. With
 * neither: {@link NO_REASON_RECORDED}. Never a priority number, and never a
 * reason this function made up.
 * @param reasons - The output of {@link readReasons}.
 */
export function reasonSummary(reasons: ReadReasons): string {
  const phrases = reasons.codes.map(reasonPhrase);
  if (phrases.length > 0) {
    return reasons.note ? `${phrases.join(' · ')} - ${reasons.note}` : phrases.join(' · ');
  }
  if (reasons.note) {
    return `${NO_REASON_RECORDED}; the note says: ${reasons.note}`;
  }
  return NO_REASON_RECORDED;
}

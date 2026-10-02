/**
 * SHORT TYPED CODES — one name for every record and noun a person reads.
 *
 * A feature's journey used to show #294, #295, #297, run 439, action #5590,
 * ask #267 and conversation 405, all as bare numbers, so nobody could tell
 * which was which (Chris, 2026-10-01: "All these conflicting numbers are
 * confusing. Can you adopt short codes for in app and chat?"). Now every one
 * reads as `<CODE>-<id>`: FE-294, RUN-439, ACT-5590, ASK-267, CHAT-405.
 *
 * - A RECORD's prefix is its object type's `code:` (type.yaml, 2–5 uppercase
 *   letters), or one derived from the type's slug when it declares none. Core
 *   never names a type's code: it reads it from the definition (stored on the
 *   type row as `schema['x-code']` by the applier).
 * - A CORE NOUN's prefix is core's, and lives in {@link CORE_NOUN_CODES} — the
 *   one place it is written.
 * - The number is the row's existing id, so nothing is renumbered, ids stay
 *   unique, and an old `#294` still resolves.
 * - A GitHub pull request is not ours, and stays `<repo>#<n>`.
 *
 * Pure, and safe on the client. The server half — reading an org's type codes
 * and resolving a code to its row — is `services/codes.ts`.
 */

/** The core nouns a person reads by number, and the prefix each is read by. */
export const CORE_NOUN_CODES = {
  /** A worker run or agent run (`worker_run`). */
  run: 'RUN',
  /** An action run (`action_run`) — what an agent or a person did, with its undo. */
  action: 'ACT',
  /** A question put to a person (`ask`). */
  ask: 'ASK',
  /** A conversation (`conversation`). */
  conversation: 'CHAT',
  /** An artifact (`artifact`) — a document, a wiki page, a mockup, a release pack. */
  artifact: 'ART',
  /** One run of an automation (`automation_run`). */
  automation: 'AUTO',
} as const;

/** A core noun with a code. */
export type CoreNoun = keyof typeof CORE_NOUN_CODES;

/** What a type's `code:` must look like: 2–5 uppercase letters. */
export const TYPE_CODE_PATTERN = /^[A-Z]{2,5}$/;

/** The schema key the applier stores a type's code under (beside `x-gates`, `x-display`). */
export const TYPE_CODE_SCHEMA_KEY = 'x-code';

const RESERVED = new Set<string>(Object.values(CORE_NOUN_CODES));

/**
 * Whether a prefix belongs to a core noun, so no object type may take it.
 * @param code - A candidate prefix, any case.
 */
export function isCoreNounCode(code: string): boolean {
  return RESERVED.has(code.toUpperCase());
}

/**
 * The prefix a type's slug suggests when its definition names none: the
 * initials of a multi-word slug (`data_room` → DR, `follow-up` → FU), a short
 * word whole (`deal` → DEAL), else a longer word's first three letters
 * (`contact` → CON). `length` widens a single word, or tops a short set of
 * initials up from the last word, which is how a clash is settled.
 * @param slug - The object type slug.
 * @param length - The length to aim for; defaults to the rule above.
 */
export function deriveTypeCode(slug: string, length?: number): string {
  const words = slug.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (words.length === 0) {
    return 'OBJ';
  }
  if (words.length === 1) {
    const word = words[0]!;
    const n = Math.min(5, length ?? (word.length <= 4 ? word.length : 3));
    return word.length >= 2 ? word.slice(0, Math.max(2, n)) : `${word}X`;
  }
  const initials = words.map(w => w[0]).join('').slice(0, 5);
  if (!length || length <= initials.length) {
    return initials;
  }
  const last = words[words.length - 1]!;
  return (initials + last.slice(1)).slice(0, Math.min(5, length));
}

/** The type fields a code is read from — a stored row or a manifest, either will do. */
export type TypeCodeSource = { slug: string; code?: string | null; schema?: Record<string, unknown> | null };

/**
 * A type's code: what its definition says, else the stored code the applier
 * settled, else one derived from its slug.
 * @param type - A type row or manifest.
 */
export function typeCodeOf(type: TypeCodeSource): string {
  const declared = type.code ?? (type.schema?.[TYPE_CODE_SCHEMA_KEY] as string | undefined);
  if (typeof declared === 'string' && TYPE_CODE_PATTERN.test(declared.toUpperCase())) {
    return declared.toUpperCase();
  }
  return deriveTypeCode(type.slug);
}

/**
 * Give every type in a set its code, unique within the set. A declared code
 * is the type's word and is never moved; a derived one that clashes with a
 * declared one, a core noun, or another derived one is widened until it does
 * not (or, too short to widen, takes a letter on the end). Two declared codes
 * that clash, or a declared core-noun code, are problems, each named, for the
 * applier to refuse; a derived code never is.
 * @param types - Every object type in one workspace.
 * @returns slug → code, and the problems (empty when the set is sound).
 */
export function assignTypeCodes(types: ReadonlyArray<{ slug: string; code?: string | null }>): { codes: Map<string, string>; problems: string[] } {
  const codes = new Map<string, string>();
  const problems: string[] = [];
  const owner = new Map<string, string>();
  for (const t of types) {
    if (!t.code) {
      continue;
    }
    const code = t.code.toUpperCase();
    if (isCoreNounCode(code)) {
      problems.push(`object type "${t.slug}" declares code ${code}, which is core's (${Object.values(CORE_NOUN_CODES).join(', ')} are reserved) — choose another`);
      continue;
    }
    const prior = owner.get(code);
    if (prior) {
      problems.push(`object types "${prior}" and "${t.slug}" both declare code ${code} — a code names one type in a workspace`);
      continue;
    }
    owner.set(code, t.slug);
    codes.set(t.slug, code);
  }
  for (const t of types) {
    if (t.code) {
      continue;
    }
    const taken = (c: string) => owner.has(c) || isCoreNounCode(c);
    let code = deriveTypeCode(t.slug);
    for (let n = code.length + 1; taken(code) && n <= 5; n++) {
      code = deriveTypeCode(t.slug, n);
    }
    // A slug too short to widen (`ask`, `run`) takes a letter on the end
    // rather than leaving the type without a code.
    const stem = code.slice(0, 4);
    for (let i = 0; taken(code) && i < 26; i++) {
      code = stem + String.fromCharCode(65 + i);
    }
    if (owner.has(code) || isCoreNounCode(code)) {
      problems.push(`object type "${t.slug}" derives code ${code}, which "${owner.get(code) ?? 'core'}" already has — declare a \`code:\` in its type.yaml`);
      continue;
    }
    owner.set(code, t.slug);
    codes.set(t.slug, code);
  }
  return { codes, problems };
}

/**
 * A code as a person reads it.
 * @param prefix - The type's or core noun's prefix.
 * @param id - The row's id.
 */
export function formatCode(prefix: string, id: string | number): string {
  return `${prefix.toUpperCase()}-${id}`;
}

/**
 * A core noun's code.
 * @param noun - Which noun.
 * @param id - Its id.
 */
export function nounCode(noun: CoreNoun, id: string | number): string {
  return formatCode(CORE_NOUN_CODES[noun], id);
}

/** Object type slug → its code, for one workspace. */
export type TypeCodes = ReadonlyMap<string, string>;

/**
 * A record's code from the type codes a surface was handed. A type the map
 * does not know (a page rendered before its types were read) falls back to
 * the slug's derived code rather than to a bare number.
 * @param codes - The workspace's type codes.
 * @param typeSlug - The record's type slug.
 * @param id - The record's id.
 */
export function recordCode(codes: TypeCodes | null | undefined, typeSlug: string | null | undefined, id: string | number): string {
  if (!typeSlug) {
    return `#${id}`;
  }
  return formatCode(codes?.get(typeSlug) ?? deriveTypeCode(typeSlug), id);
}

/** A code read back from text a person or an agent typed. */
export type ParsedCode = { prefix: string | null; id: number };

/**
 * Read a code a person or a tool call typed: `FE-294`, `fe-294`, `FE294`,
 * `FE 294`, or a bare `#294` / `294` (prefix null — an old reference, which
 * still resolves by id). Identifiers only; this is not a reading of meaning.
 * @param text - The typed reference.
 * @returns The prefix (uppercase) and id, or null when it is not a code.
 */
export function parseCode(text: string | number | null | undefined): ParsedCode | null {
  if (text === null || text === undefined) {
    return null;
  }
  if (typeof text === 'number') {
    return Number.isSafeInteger(text) && text > 0 ? { prefix: null, id: text } : null;
  }
  const m = /^\s*(?:([a-z]{2,5})[\s-]?|#)?(\d{1,12})\s*$/i.exec(text);
  if (!m) {
    return null;
  }
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return { prefix: m[1] ? m[1].toUpperCase() : null, id };
}

/**
 * The core noun a prefix names, or null when it is a type's (or nothing's).
 * @param prefix - An uppercase prefix.
 */
export function coreNounOf(prefix: string): CoreNoun | null {
  const hit = (Object.entries(CORE_NOUN_CODES) as Array<[CoreNoun, string]>).find(([, code]) => code === prefix.toUpperCase());
  return hit ? hit[0] : null;
}

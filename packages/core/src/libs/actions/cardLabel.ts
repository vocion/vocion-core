/**
 * A CARD NAMES A RECORD BY THE ID ITS ACTION RESOLVED, never by a number the
 * model typed into its label.
 *
 * Matrix run s1 (2026-09-29): "File as a feature request: Approve link-expiry
 * feature (request 207) for build". Record 207 is an environment; the model
 * had typed its id into a build card, the backstop turned the unbuildable
 * build into a filing, and the label carried the wrong reference onto the
 * person's screen and into the new request's title.
 *
 * The rule is mechanical. A reference in the label — `request 207`, `task
 * #12`, `(plan 134)` — is kept when it is the card's own record, rewritten to
 * the card's own id when the card has a record of that kind, and removed
 * otherwise. What the card is about comes from its payload (`requestId`,
 * `taskId`, `planId`, `objectType` + `id`), which the action validates.
 */

/** The record kinds a label names, and the type each means. */
const NOUN_TYPES: Record<string, string> = {
  request: 'request',
  feature: 'request',
  idea: 'request',
  bug: 'request',
  task: 'engineering_task',
  plan: 'architecture_plan',
  record: '*',
};

const NOUNS = Object.keys(NOUN_TYPES).join('|');
/** `(request 207)` / `(task #12)` — a parenthesised reference, removed whole when it is not the card's. */
const PAREN_REF = new RegExp(`\\s*\\(\\s*(${NOUNS})(?:\\s*#\\s*|\\s+)(\\d+)\\s*\\)`, 'gi');
/** `request 207` / `request #207` / `task#12` in running text. */
const BARE_REF = new RegExp(`\\b(${NOUNS})(\\s*#\\s*|\\s+)(\\d+)\\b`, 'gi');

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The records a card's payload is about, by type.
 * @param input - The card's action payload.
 */
export function ownRecordsOf(input: Record<string, unknown> | null | undefined): Map<string, number> {
  const own = new Map<string, number>();
  if (!input) {
    return own;
  }
  if (typeof input.objectType === 'string' && input.objectType && num(input.id) !== null) {
    own.set(input.objectType, num(input.id)!);
  }
  if (num(input.requestId) !== null) {
    own.set('request', num(input.requestId)!);
  }
  if (num(input.taskId) !== null) {
    own.set('engineering_task', num(input.taskId)!);
  }
  if (num(input.planId) !== null) {
    own.set('architecture_plan', num(input.planId)!);
  }
  return own;
}

function ownIdFor(noun: string, own: Map<string, number>): number | null {
  const type = NOUN_TYPES[noun.toLowerCase()];
  if (type === '*') {
    return own.size === 1 ? [...own.values()][0]! : null;
  }
  return type ? own.get(type) ?? null : null;
}

/**
 * The label with every record reference resolved against the card's own
 * records: kept, rewritten to the card's id, or removed.
 * @param label - The label as the model wrote it.
 * @param input - The card's action payload.
 */
export function labelWithResolvedRefs(label: string, input: Record<string, unknown> | null | undefined): string {
  const own = ownRecordsOf(input);
  const out = label
    .replace(PAREN_REF, (whole, noun: string, n: string) => {
      const id = ownIdFor(noun, own);
      if (id === null) {
        return '';
      }
      return Number(n) === id ? whole : whole.replace(n, String(id));
    })
    .replace(BARE_REF, (whole, noun: string, sep: string, n: string) => {
      const id = ownIdFor(noun, own);
      if (id === null) {
        return noun;
      }
      return Number(n) === id ? whole : `${noun}${sep}${id}`;
    });
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim() || label.trim();
}

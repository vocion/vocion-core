/**
 * Cron expectations — "when should this have fired?", answered in code.
 *
 * `cronstrue` renders a cron as English and Temporal owns the real scheduling,
 * so nothing here decides when work runs. What was missing is the reverse
 * question: given a schedule and a last-fire time, is the silence normal? That
 * is the difference between a card that says "last run 7:00 PM" whether the
 * schedule is twelve days healthy or nineteen hours dead.
 *
 * Pure and UTC. Temporal's `cronExpressions` are evaluated in UTC unless a
 * timezone is set, and none of ours set one, so every field is read against
 * `getUTC*`.
 */

/** Standard 5-field cron: minute hour day-of-month month day-of-week. */
type Matcher = {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** `*` in the source expression — needed for cron's dom/dow OR rule. */
  domAny: boolean;
  dowAny: boolean;
};

const FIELD_RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  // Day-of-week accepts 7 as a second spelling of Sunday, normalized below.
  [0, 7],
];

const MINUTE_MS = 60_000;

/** How far back a search walks before giving up. A schedule quieter than this reads as "never fired". */
const MAX_LOOKBACK_MINUTES = 45 * 24 * 60;

/**
 * One cron field into the set of values it matches. Supports `*`, `a`, `a-b`,
 * lists of those, and a `/step` on any of them. Returns null on anything else,
 * because a half-understood schedule must not produce a confident answer.
 * @param raw - The field text.
 * @param min - Lowest legal value.
 * @param max - Highest legal value.
 */
function parseField(raw: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const [range, stepRaw, ...rest] = part.split('/');
    if (rest.length > 0 || range === undefined || range === '') {
      return null;
    }
    let step = 1;
    if (stepRaw !== undefined) {
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step < 1) {
        return null;
      }
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b, ...extra] = range.split('-');
      if (extra.length > 0) {
        return null;
      }
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = stepRaw === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) {
      out.add(v);
    }
  }
  return out.size > 0 ? out : null;
}

/**
 * Parse a 5-field cron expression. Null when the expression is not one we can
 * reason about — every caller treats that as "no expectation", never as "never".
 * @param expr - The cron expression.
 */
function parseCron(expr: string): Matcher | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const sets = fields.map((f, i) => parseField(f, FIELD_RANGES[i]![0], FIELD_RANGES[i]![1]));
  if (sets.includes(null)) {
    return null;
  }
  // Sunday is both 0 and 7 in the wild; normalize so `7` matches Sunday.
  const dow = sets[4]!;
  if (dow.has(7)) {
    dow.add(0);
  }
  return {
    minute: sets[0]!,
    hour: sets[1]!,
    dom: sets[2]!,
    month: sets[3]!,
    dow,
    domAny: fields[2] === '*',
    dowAny: fields[4] === '*',
  };
}

/**
 * Does this minute match the schedule?
 *
 * Day-of-month and day-of-week follow the standard rule: when both are
 * restricted the day matches if EITHER does, and when one is `*` only the other
 * applies. Treating it as a plain AND would make `0 0 1 * 1` fire only on
 * Mondays that fall on the 1st.
 * @param m - Parsed matcher.
 * @param at - The minute to test.
 */
function matches(m: Matcher, at: Date): boolean {
  if (!m.minute.has(at.getUTCMinutes()) || !m.hour.has(at.getUTCHours()) || !m.month.has(at.getUTCMonth() + 1)) {
    return false;
  }
  const domHit = m.dom.has(at.getUTCDate());
  const dowHit = m.dow.has(at.getUTCDay());
  if (m.domAny && m.dowAny) {
    return true;
  }
  if (m.domAny) {
    return dowHit;
  }
  if (m.dowAny) {
    return domHit;
  }
  return domHit || dowHit;
}

/**
 * The most recent fire times at or before `now`, newest first.
 *
 * Walks back a minute at a time, which is cheap because it stops as soon as it
 * has the `count` it was asked for and never looks back further than
 * `MAX_LOOKBACK_MINUTES`. Returns fewer than `count` (or none) when the
 * schedule is too sparse to have fired that often inside the window.
 * @param expr - The cron expression.
 * @param now - Evaluation time.
 * @param count - How many fires to collect.
 */
export function previousFires(expr: string, now: Date, count = 1): Date[] {
  const m = parseCron(expr);
  if (!m || count < 1) {
    return [];
  }
  const out: Date[] = [];
  // Truncate to the minute: a fire at 19:00:00 is "at or before" 19:00:42.
  let cursor = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i <= MAX_LOOKBACK_MINUTES; i += 1) {
    const at = new Date(cursor);
    if (matches(m, at)) {
      out.push(at);
      if (out.length >= count) {
        return out;
      }
    }
    cursor -= MINUTE_MS;
  }
  return out;
}

/**
 * When the schedule should last have fired, at or before `now`. Null when the
 * expression is unparseable or nothing matched inside the lookback window.
 * @param expr - The cron expression.
 * @param now - Evaluation time.
 */
export function previousFire(expr: string, now: Date): Date | null {
  return previousFires(expr, now, 1)[0] ?? null;
}

/**
 * The schedule's own cadence in milliseconds — the gap between the last two
 * fires. This is what makes staleness relative to the thing being measured: a
 * daily sync two hours old is fine, an hourly one is not.
 * @param expr - The cron expression.
 * @param now - Evaluation time.
 */
export function cronIntervalMs(expr: string, now: Date): number | null {
  const fires = previousFires(expr, now, 2);
  if (fires.length < 2) {
    return null;
  }
  return fires[0]!.getTime() - fires[1]!.getTime();
}

/**
 * Rounded "19.3 hours" / "45 minutes" / "2.1 days", for a card or a tool payload.
 * @param ms
 */
export function humanizeAge(ms: number): string {
  const minutes = ms / MINUTE_MS;
  if (minutes < 90) {
    return `${Math.round(minutes)} minute${Math.round(minutes) === 1 ? '' : 's'}`;
  }
  const hours = minutes / 60;
  if (hours < 48) {
    return `${hours.toFixed(1)} hours`;
  }
  return `${(hours / 24).toFixed(1)} days`;
}

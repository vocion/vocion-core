/**
 * Time zones — the one place the app answers "what day is it for this person".
 *
 * The server runs in UTC and, until 2026-09-18, so did every date judgement in
 * the product: the agent's clock line, "is this briefing from today", the
 * briefing title stamp, the calendar tool's "today". For Chris in Pacific
 * time that meant the agent's day flipped at 5pm, Thursday's brief went
 * "STALE" over dinner, and a calendar read at 11:30am PT came back labelled
 * "2:30pm ET". Nothing was wrong with the arithmetic; the zone was nobody's.
 *
 * The zone is the PERSON's when a browser is in the loop (sent with each
 * turn), the WORKSPACE's for schedules and missions (`defaults.timezone` in
 * workspace.yaml → `project.time_zone`), and UTC only when neither is known.
 * Everything here is pure `Intl`; no library, no offsets by hand.
 */

export const DEFAULT_TIME_ZONE = 'UTC';

/**
 * Whether `tz` names a zone this runtime can format in (`America/Los_Angeles`).
 * @param tz - Anything a client or a YAML file might send.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim().length === 0 || tz.length > 64) {
    return false;
  }
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first usable zone among the candidates, else UTC. Order is the policy:
 * the person's browser, then the workspace, then the server's default.
 * @param candidates - Zones in order of preference; nullish and invalid ones are skipped.
 */
export function resolveTimeZone(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    if (isValidTimeZone(c)) {
      return c;
    }
  }
  return DEFAULT_TIME_ZONE;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClock(d: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(d)) {
    if (p.type !== 'literal') {
      out[p.type] = Number.parseInt(p.value, 10);
    }
  }
  return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour! % 24, minute: out.minute!, second: out.second! };
}

/**
 * The calendar day an instant falls on in a zone, as `YYYY-MM-DD`.
 * @param d - The instant.
 * @param tz - The zone.
 */
export function dayKey(d: Date, tz: string): string {
  const p = wallClock(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Whether two instants fall on the same calendar day in a zone.
 * @param a
 * @param b
 * @param tz
 */
export function sameDay(a: Date, b: Date, tz: string): boolean {
  return dayKey(a, tz) === dayKey(b, tz);
}

/**
 * Whole calendar days from `from` to `to` in a zone: 0 today, 1 tomorrow, -1 yesterday.
 * @param from
 * @param to
 * @param tz
 */
export function dayDistance(from: Date, to: Date, tz: string): number {
  const a = wallClock(from, tz);
  const b = wallClock(to, tz);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/**
 * The zone's offset from UTC at an instant, in minutes east of UTC (PDT = -420).
 * @param d
 * @param tz
 */
export function zoneOffsetMinutes(d: Date, tz: string): number {
  const p = wallClock(d, tz);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - d.getTime()) / 60_000);
}

/**
 * The instant a calendar day begins in a zone — local midnight as UTC. Two
 * passes so a day that starts inside a DST change still lands on midnight.
 * @param day - `YYYY-MM-DD`.
 * @param tz
 */
export function startOfDay(day: string, tz: string): Date {
  const [y, m, d] = day.split('-').map(n => Number.parseInt(n, 10)) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const first = new Date(guess - zoneOffsetMinutes(new Date(guess), tz) * 60_000);
  return new Date(guess - zoneOffsetMinutes(first, tz) * 60_000);
}

/**
 * `Fri, Sep 18, 2026`.
 * @param d
 * @param tz
 */
export function formatDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

/**
 * `7:25 AM PDT`.
 * @param d
 * @param tz
 */
export function formatTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
}

/**
 * `Fri, Sep 18, 2026, 7:25 AM PDT` — a time a person can act on without arithmetic.
 * @param d
 * @param tz
 */
export function formatDateTime(d: Date, tz: string): string {
  return `${formatDate(d, tz)}, ${formatTime(d, tz)}`;
}

/**
 * The line that tells the model what time it is — the person's zone first,
 * UTC beside it, and the day said outright so "today" needs no inference.
 * Stated per TURN (in the message), never in a cached system prompt: the
 * compiled graph is shared across requests for hours, and a NOW baked into
 * it was the time of the first request that built it.
 * @param now
 * @param tz
 */
export function clockLine(now: Date, tz: string): string {
  return `NOW: ${formatDateTime(now, tz)} (${tz}) · ${now.toISOString()} UTC. Today is ${formatDate(now, tz)} for the person you are talking to; state times in their zone (${tz}) unless asked otherwise.`;
}

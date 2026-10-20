/**
 * When a five-field cron schedule next fires, in UTC — the zone automation
 * schedules run in (`cronToText` says "(UTC)").
 *
 * Small on purpose: numbers, `*`, lists, ranges and steps, which is every
 * schedule a workspace writes. Day-of-month and day-of-week follow cron's rule
 * that when both are restricted, either one matching is enough. Returns null
 * for a schedule it cannot read, or one that does not fire within a year.
 */

/**
 * The values one cron field allows.
 * @param field - e.g. `*`, `5`, `1-5`, a step such as every 15, `1,15`.
 * @param min
 * @param max
 */
function allowed(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) {
      return null;
    }
    const step = m[2] ? Number(m[2]) : 1;
    let lo = min;
    let hi = max;
    if (m[1] !== '*') {
      const [a, b] = m[1]!.split('-').map(Number) as [number, number | undefined];
      lo = a;
      hi = b ?? (m[2] ? max : a);
    }
    if (step < 1 || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) {
      out.add(v);
    }
  }
  return out;
}

/**
 * The next time `cron` fires strictly after `from`.
 * @param cron - Five fields: minute hour day-of-month month day-of-week.
 * @param from - The clock.
 */
export function nextCronRun(cron: string, from: Date): Date | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const [minF, hourF, domF, monF, dowF] = fields as [string, string, string, string, string];
  const minutes = allowed(minF, 0, 59);
  const hours = allowed(hourF, 0, 23);
  const doms = allowed(domF, 1, 31);
  const months = allowed(monF, 1, 12);
  const dowsRaw = allowed(dowF.replace(/\b7\b/g, '0'), 0, 6);
  if (!minutes || !hours || !doms || !months || !dowsRaw) {
    return null;
  }
  const domStar = domF === '*';
  const dowStar = dowF === '*';
  const dayMatches = (d: Date) => {
    const dom = doms.has(d.getUTCDate());
    const dow = dowsRaw.has(d.getUTCDay());
    if (domStar && dowStar) {
      return true;
    }
    if (domStar) {
      return dow;
    }
    if (dowStar) {
      return dom;
    }
    return dom || dow;
  };
  const start = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  for (let i = 0; i < 400; i += 1) {
    if (months.has(day.getUTCMonth() + 1) && dayMatches(day)) {
      for (const h of [...hours].sort((a, b) => a - b)) {
        for (const m of [...minutes].sort((a, b) => a - b)) {
          const t = new Date(day.getTime() + h * 3_600_000 + m * 60_000);
          if (t >= start) {
            return t;
          }
        }
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return null;
}

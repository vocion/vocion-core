/**
 * The pure halves of the `team` block's reads (`services/workspace/teamFlow.ts`):
 * where a workspace's month starts, and how an unnamed source reads.
 */

/**
 * The first instant of `now`'s calendar month in `timeZone`, and its name.
 * @param now - The clock.
 * @param timeZone - The workspace's zone.
 */
export function monthStart(now: Date, timeZone: string): { start: Date; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find(p => p.type === 'year')!.value);
  const m = Number(parts.find(p => p.type === 'month')!.value);
  // Midnight on the 1st in the zone: start from UTC midnight and correct by the
  // zone's offset at that moment.
  const utc = Date.UTC(y, m - 1, 1);
  const offset = zoneOffsetMs(new Date(utc), timeZone);
  const label = new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', year: 'numeric' }).format(now);
  return { start: new Date(utc - offset), label };
}

function zoneOffsetMs(at: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(at).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - at.getTime();
}

/**
 * "finance-production" → "Finance production": a source with no declared
 * name still reads as words.
 * @param slug - The source slug.
 */
export function prettySlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

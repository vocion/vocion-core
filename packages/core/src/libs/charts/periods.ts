/**
 * Reading an x label as a period. Pure.
 *
 * A time axis is a sequence of periods — months, quarters, years, weeks, days.
 * The lint uses this to catch an axis that mixes periods with something else
 * (2026-10-23: "Jul, Aug, Sep, Oct 23*, EOY: booked, +weighted" on one axis,
 * where the last two were scenarios). It reads the label's own form — a month
 * name, an ISO date, Q3, FY26 — never the meaning of other words.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = `(?:${MONTHS.join('|')})[a-z]*\\.?`;
const YEAR = `(?:'?\\d{2}|\\d{4})`;

const PERIOD_FORMS: RegExp[] = [
  // 2026, FY26, FY2026
  new RegExp(`^(?:fy\\s?)?${YEAR}$`),
  // 2026-07, 2026-07-01, 2026/07
  /^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/,
  // 07/2026, 7/1/2026, 7/1
  /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/,
  // Jul, July, Jul 2026, Jul '26, Oct 23 (a day), Oct 23 2026, 23 Oct
  new RegExp(`^${MONTH}(?:\\s+\\d{1,2})?(?:,?\\s+${YEAR})?$`),
  new RegExp(`^\\d{1,2}\\s+${MONTH}(?:\\s+${YEAR})?$`),
  // Q3, Q3 2026, 2026 Q3, 2026-Q3, Q3 FY26, H1, H2 2026
  new RegExp(`^(?:${YEAR}[\\s-])?[qh][1-4](?:[\\s-](?:fy\\s?)?${YEAR})?$`),
  // W14, Wk 14, Week 14, W14 2026
  new RegExp(`^w(?:ee)?k?\\s?\\d{1,2}(?:\\s+${YEAR})?$`),
];

/**
 * Whether a label is a period (a month, quarter, year, week or date), read
 * from its form. Footnote marks and a trailing "(partial)" are allowed:
 * "Oct 23*" is still a day.
 * @param label - One x label.
 */
export function isPeriodLabel(label: string): boolean {
  const s = label.trim().toLowerCase().replace(/[*†‡]+$/u, '').replace(/\s*\((?:partial|mtd|qtd|ytd|est\.?|so far)\)$/, '').trim();
  if (!s) {
    return false;
  }
  return PERIOD_FORMS.some(re => re.test(s));
}

/**
 * The axis read as a whole: periods, categories, or a mix of both (with the
 * labels on each side, for the message).
 * @param labels - The x labels.
 */
export function axisKindOf(labels: readonly string[]): { kind: 'periods' | 'categories' | 'mixed'; periods: string[]; others: string[] } {
  const periods = labels.filter(isPeriodLabel);
  const others = labels.filter(l => !isPeriodLabel(l));
  if (periods.length >= 2 && others.length > 0) {
    return { kind: 'mixed', periods, others };
  }
  return { kind: periods.length === labels.length && labels.length > 0 ? 'periods' : 'categories', periods, others };
}

/**
 * The month index (0–11) a label names, when it names one; for shortening
 * "January 2026" to "Jan" or "J" when the width is tight.
 * @param label - One x label.
 */
export function monthOf(label: string): number | null {
  const m = /^([a-z]+)/i.exec(label.trim());
  if (!m) {
    const iso = /^\d{4}[-/](\d{1,2})/.exec(label.trim());
    return iso ? Number(iso[1]) - 1 : null;
  }
  const i = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
  return i >= 0 && m[1]!.length >= 3 ? i : null;
}

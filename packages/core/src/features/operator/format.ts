import type { OperatorAccount } from '@/services/OperatorConsoleService';
import { ageLabel } from '@/libs/timeAgo';
import { formatMoney } from '@/libs/workspace/pageFields';

/**
 * The operator console's readings, pure so they are tested without a page.
 * Money goes through `formatMoney` and time through `ageLabel`, the product's
 * one spelling of each.
 */

/**
 * "When last" for a fixed-width column.
 * @param iso - ISO-8601 instant, or null.
 * @param now - The clock.
 */
export function lastSeen(iso: string | null, now: number = Date.now()): string {
  return iso ? ageLabel(new Date(iso), now) : 'never';
}

/**
 * This month against the cap, in the fewest words.
 * @param account - The account.
 * @param account.cap - Its month and cap.
 */
export function capLabel(account: Pick<OperatorAccount, 'cap'>): string {
  const { spentCents, hardCentsLimit } = account.cap;
  if (hardCentsLimit === null) {
    return `${formatMoney(spentCents)} · no cap`;
  }
  return `${formatMoney(spentCents)} of ${formatMoney(hardCentsLimit)}`;
}

/**
 * Dollars typed by a person as whole cents, or null for "no cap"; undefined
 * when the text is not an amount.
 * @param text - What was typed.
 */
export function centsFromDollars(text: string): number | null | undefined {
  const trimmed = text.trim().replace(/^\$/, '').replaceAll(',', '');
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value * 100);
}

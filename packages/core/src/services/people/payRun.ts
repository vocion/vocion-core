/**
 * A pay run by category, for booking it: gross wages, the taxes withheld
 * and owed, deductions, employer contributions, reimbursements and net pay,
 * each with its lines by the vendor's own names.
 *
 * Company-wide only. A provider adds every employee's figures into a tally
 * inside the provider and hands back only the sums, so the record has no
 * place for one person's amount: a line is a deduction or tax name summed
 * across everyone, never a person. Money is added in cents, so the sums are
 * exact.
 */

export const PAY_RUN_CATEGORIES = ['gross_wages', 'employee_taxes', 'employer_taxes', 'employee_deductions', 'employer_contributions', 'reimbursements', 'net_pay'] as const;

export type PayRunCategoryKind = typeof PAY_RUN_CATEGORIES[number];

/** One line within a category: a vendor's tax, deduction or earning name, summed across all employees. */
export type PayRunLine = { label: string; amount: number };

export type PayRunCategory = {
  category: PayRunCategoryKind;
  label: string;
  /** In major units of the pay run's currency. */
  amount: number;
  /** By the vendor's own names. Left out of a list's summary. */
  lines?: PayRunLine[];
};

/** Gross wages minus employee taxes minus employee deductions plus reimbursements, against net pay. */
export type PayRunReconciliation = { reconciles: boolean; difference: number };

const LABELS: Record<PayRunCategoryKind, string> = {
  gross_wages: 'Gross wages',
  employee_taxes: 'Employee taxes withheld',
  employer_taxes: 'Employer taxes',
  employee_deductions: 'Employee deductions',
  employer_contributions: 'Employer contributions',
  reimbursements: 'Reimbursements',
  net_pay: 'Net pay',
};

const cents = (amount: number): number => Math.round(amount * 100);

/**
 * A running sum per category and line. `add` takes every employee's figure;
 * `result` gives back only the sums.
 */
export function payRunTally() {
  const lines = new Map<PayRunCategoryKind, Map<string, number>>(PAY_RUN_CATEGORIES.map(c => [c, new Map()]));
  const totals = new Map<PayRunCategoryKind, number>();

  return {
    /**
     * Add an amount to a category, under a line name.
     * @param category - Which category.
     * @param label - The vendor's name for it.
     * @param amount - In major units; null is skipped.
     */
    add(category: PayRunCategoryKind, label: string, amount: number | null): void {
      if (amount === null || !Number.isFinite(amount)) {
        return;
      }
      const byLabel = lines.get(category)!;
      byLabel.set(label, (byLabel.get(label) ?? 0) + cents(amount));
    },
    /**
     * Use the vendor's own company-wide total for a category instead of the
     * sum of its lines.
     * @param category - Which category.
     * @param amount - In major units; null keeps the lines' sum.
     */
    total(category: PayRunCategoryKind, amount: number | null): void {
      if (amount !== null && Number.isFinite(amount)) {
        totals.set(category, cents(amount));
      }
    },
    /**
     * The categories and whether they reconcile.
     * @param opts - What to include.
     * @param opts.lines - Whether to include each category's lines.
     */
    result(opts: { lines: boolean }): { categories: PayRunCategory[]; reconciliation: PayRunReconciliation } {
      const sum = new Map<PayRunCategoryKind, number>();
      const categories = PAY_RUN_CATEGORIES.map((category) => {
        const byLabel = [...lines.get(category)!].filter(([, c]) => c !== 0);
        const total = totals.get(category) ?? byLabel.reduce((s, [, c]) => s + c, 0);
        sum.set(category, total);
        return {
          category,
          label: LABELS[category],
          amount: total / 100,
          ...(opts.lines ? { lines: byLabel.sort((a, b) => b[1] - a[1]).map(([label, c]) => ({ label, amount: c / 100 })) } : {}),
        };
      });
      const at = (c: PayRunCategoryKind) => sum.get(c) ?? 0;
      const difference = at('gross_wages') - at('employee_taxes') - at('employee_deductions') + at('reimbursements') - at('net_pay');
      return { categories, reconciliation: { reconciles: Math.abs(difference) <= 1, difference: difference / 100 } };
    },
  };
}

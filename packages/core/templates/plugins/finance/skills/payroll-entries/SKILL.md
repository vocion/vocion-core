---
slug: payroll-entries
name: Payroll Entries
description: >-
  Book a pay run from its company-wide category totals: wages, employer
  taxes, benefits, and the deductions the company remits itself through a
  liability account. Read when a pay run lands or someone asks how payroll
  was booked.
version: 1
---

# Payroll Entries

## Read

The pay run (`people_get` kind `pay_run`): its pay date, period and category
totals. The entity's standing facts and providers for how this company
books payroll. The accounts the ledger holds for wages, payroll taxes,
benefits and the payroll liabilities.

Check the totals reconcile before anything else: gross wages less employee
taxes and deductions, plus reimbursements, equals net pay. If they do not,
stop and report the difference; do not book a pay run that does not tie.

## The entry

- Debit wages (gross) and the employer's own costs (employer taxes, employer
  benefit contributions) to their expense accounts.
- Credit cash for net pay.
- Credit the liability accounts for what was withheld and is remitted later:
  employee and employer taxes the provider remits, benefits, retirement.
- **A deduction the company remits itself** (for example workers' comp
  withheld by payroll and paid by the company to the insurer) is credited to
  its own liability account now, and cleared by a second entry when the
  company pays it. Say which payment will clear it.

Propose it with `finance.post_journal_entry`: dated the pay date, a memo
naming the pay run and its period, one line per category, balanced to the
cent.

## Never

One person's pay. You read and book company totals by category only, and
you never ask for, infer or repeat what any one person was paid.

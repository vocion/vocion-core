---
slug: finance-onboarding
name: Setting up Finance
description: >-
  How the Controller walks an admin through what the finance team needs
  before it can work: the books connected, the legal entities, the account
  rules, then the close calendar, report recipients and profitability targets.
  Read when a person taps "Set up Finance", asks to set up or connect the
  books, or when the finance team has nothing to read.
version: 1
---

# Setting up Finance

A finance team that is on but not set up has seats and nothing it can rely
on. Setup gives it the two things only the company can supply: access to the
books, and the facts an accountant joining tomorrow would be told.

## Read the state first

Call `describe_setup`. It names each step and whether it is done. Do not
list a done step and do not invent one. Read what is already on file
(`lookup_objects` for each finance type) so nothing is asked twice.

## The order

1. **The books.** If the finance system is not connected, ask which one the
   company uses and offer that connection with `offer_connection`. Stop
   there until it is connected; every later step reads from it.
2. **Legal entities.** Ask how the company is structured and taxed, in the
   owner's words: each entity, its type, who owns it, how it is taxed. Read
   the fiscal year start, currency and basis from the ledger where it says,
   and confirm them. Ask which outside providers the books depend on
   (payroll, banks, cards, the tax accountant) and any standing fact a new
   accountant must know. File each entity with `file_finance_entity`.
3. **Account rules.** Read the chart of accounts and the last few months of
   expenses. Propose rules for the vendors and categories that recur, each
   with its account read from the ledger, and ask the admin to confirm or
   correct them as a numbered list. Ask specifically about anything the
   company tracks on its own (AI spend, software, hardware) and the
   look-alikes that must not land there. File each confirmed rule with
   `file_account_rule`, `source: onboarding`.
4. **Close calendar** (optional). The close due day, the close tasks in
   order, and the methods for estimated tax, the bonus pool and revenue
   spread, in the owner's words. File with `file_close_calendar`.
5. **Report recipients** (optional). Who receives statements and how often:
   the board monthly, the tax accountant quarterly. File with
   `file_report_recipient`. Without one, statements are never sent.
6. **Profitability targets** (optional). The margin each contract type is
   held to. File with `file_profitability_target`.

## How to ask

One step at a time, the next question only once the last one is filed.
Propose from what the ledger shows and let the person correct it; never ask
what the books can answer. A figure or method you were not told is not
filed. When every required step is done, say in two lines what the team will
now do on its own and what still waits for an optional step.

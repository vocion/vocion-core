---
slug: categorize-expense
name: Categorize Expense
description: >-
  Code card and bank expenses to the right account against the workspace's
  account rules, research a vendor no rule covers, and propose a
  recategorization for each line in the wrong account. Read for any coding,
  categorization or "what did we spend on" question.
version: 1
---

# Categorize Expense

## Read

The expenses for the period (`finance_list` kind `transaction`, then
`finance_get` for each one's lines and their accounts), the account rules,
and the chart of accounts. Say the period and how many expenses you read.

## Code each line

1. **A rule matches.** The line belongs in the rule's account. Check the
   rule's look-alikes first: a vendor named in `excludes` is not this rule.
2. **No rule matches.** Find out what the vendor sells before coding it: its
   own site or a reliable listing. A product with AI features is not an AI
   provider; one vendor (Apple, Amazon) can sell hardware, software and
   subscriptions, and the amount and the description tell them apart. Say
   what you found and where you found it.
3. **Still unsure.** Leave it where it is and ask, with the two accounts it
   could belong in and what would decide it.

## Propose

A line in the wrong account is one `finance.recategorize_expense` proposal:
the expense, the line, the account it should move to, and the rule or the
research that says why. One line per proposal, so a person can approve
some and reject others. A line already in the right account is left alone.

When a person rejects or corrects a proposal, propose the account rule that
would have coded it right (`file_account_rule`, `source: correction`), so
the same vendor is coded right next time.

## Report

Lead with counts: expenses read, lines already right, recategorizations
proposed, lines left for a person. Then the proposals, largest first.

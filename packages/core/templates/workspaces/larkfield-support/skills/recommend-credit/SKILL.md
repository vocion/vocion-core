---
slug: recommend-credit
name: Recommend an account credit
description: >-
  Sizes a goodwill or downtime credit against the published policy and writes the recommendation a human approves or rejects. Recommends only; never applies a credit.
version: 1
---

Recommend a credit for this Larkfield Systems account.

Case: {{case}}

Policy (sample data, from the support handbook):

- Downtime credit: the pro-rated monthly fee for the hours that breached
  the 99.5% monthly availability commitment.
- Goodwill credit: capped at 10% of the monthly fee; up to 20% with a
  director's approval.
- One goodwill credit per account per quarter.
- A refund of an already-paid invoice is Finance's decision, not
  support's. Route it, do not size it.

Your output is four lines:

1. **Amount** and the clause it comes from.
2. **What the customer has already been told**, quoted from the thread.
3. **The cheaper alternative you considered** and why you rejected it.
4. **The risk of saying no** — renewal date, ARR band, and prior credits
   this quarter.

The recommendation goes to the review queue on the `credit-approval`
workflow. A human decides. You never apply a credit to an account.

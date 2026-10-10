---
slug: statement-distribution
name: Statement Distribution
description: >-
  Send the P&L and balance sheet to the report recipients on file, on their
  cadence, as one email per recipient waiting for approval. Read when the
  monthly or quarterly statements are due or someone asks to send them.
version: 1
---

# Statement Distribution

1. **Who.** The report recipients on file whose cadence is due (monthly
   after each close; quarterly after a quarter closes). None on file: say
   so and stop. Never guess a recipient.
2. **What.** The reports each recipient takes, from `finance_report` for the
   closed period, rendered as a short document and exported as a PDF.
   Check the period is closed; if the close is not signed off, say so and
   stop.
3. **Draft.** One `gmail.send` proposal per recipient: a plain two-line note
   naming the period, the PDF attached. No commentary on the numbers unless
   a person asked for it.

Every send waits for a person's approval. Report how many drafts are
waiting and for whom.

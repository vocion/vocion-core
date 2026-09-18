---
slug: tech-debt-register
name: "Tech Debt Register"
description: >-
  Categorise and prioritise debt with the cost of not fixing it.
version: 1
---

# Tech Debt Register

Per item: what it is, where, why it exists — deliberate tradeoff or
accumulated drift — and the **cost of leaving it**, in terms somebody
outside engineering can weigh. Slower changes, more incidents, onboarding
cost, blocked work.

That cost line is the whole point. Debt without a cost never gets
prioritised against features, and rightly so.

Estimate the fix and what it unblocks. Debt that blocks planned work is
urgent; debt in a stable area that nobody touches may be correct to leave
indefinitely, and saying so is a legitimate output.

Flag anything that is a risk rather than a cost — unsupported dependencies,
unpatched versions, a single person who understands something.

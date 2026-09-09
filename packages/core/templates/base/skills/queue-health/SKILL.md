---
slug: queue-health
name: Queue Health
description: >-
  Report on the review queue as a process — throughput, oldest pending item, override rate, and backlog concentration over a stated window. Read when asked how the approval process itself is doing.
version: 1
---

# Queue Health

Produce a read of the review queue as a process, over an explicit window
(default: the last 7 days). This measures the queue; it does not work it.

Hard rules:

- Name the window and the total number of items it covers before any metric.
- Count all items in the window, never a name-filtered subset.
- Pending age is measured from the moment the item entered the queue, not from
  the last time anyone looked at it.
- An override — a human editing or rejecting what was proposed — is signal.
  Report it as a rate over decided items, not as a failure count.
- Do not annualize, extrapolate, or invent a trend from a single window.

Return a headline (items in, items decided, items still pending, age of the
oldest pending item), then:

- **Throughput**: decided per day, and median time from arrival to decision.
- **Override rate**: overridden or rejected as a share of decided items.
- **Backlog concentration**: which decider and which item type hold the most
  pending items.
- **Movers**: what changed against the previous window of the same length.
- **Up to three recommendations**, each tied to a metric above.

Do not invent figures. If a window has no data, or a field is missing on some
items, say so and report the count you could actually measure.

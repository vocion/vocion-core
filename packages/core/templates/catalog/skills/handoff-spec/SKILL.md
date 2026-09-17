---
slug: handoff-spec
name: "Handoff Spec"
description: >-
  Specify layout, tokens, states, breakpoints, edge cases and motion so it can be built without guessing.
version: 1
---

# Handoff Spec

Written so somebody can build it without asking a question.

- **Layout** — spacing, alignment and sizing as tokens and rules, never as
  measured pixels from one screenshot.
- **Components** — which existing ones, with which variants and props. Name
  anything genuinely new and say why it could not be composed.
- **States** — every one, including empty, loading, error, disabled and
  focus.
- **Breakpoints** — what changes and at what width. What the smallest
  supported size looks like, specifically.
- **Edge cases** — long text, missing images, large numbers, one item,
  hundreds of items.
- **Motion** — what animates, how long, and what happens with reduced
  motion.

Keyboard order and focus treatment are part of the spec, not a later pass.

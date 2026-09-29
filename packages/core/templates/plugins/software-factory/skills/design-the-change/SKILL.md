---
slug: design-the-change
name: Designing the change before it is decided
description: >-
  How a request that changes what people see gets a visual a person decides
  against — the change drawn on the real screen (`draw_mockup`), or one flow
  diagram —
  and how the same request is closed with an after-shot from the running
  product. Covers when a visual is owed, what one screen means, where it is
  attached, and the one honest way out. Read whenever a request's `surface` is
  `ui` or `flow`, before its recommendation is filed, and again when it ships.
playbooks: [designing-a-surface, house-voice]
version: 2
---

# Designing the change

A person deciding on a phone whether to build something should be able to see
it. A paragraph describing a screen is a claim about a screen; a picture is the
screen. This skill exists so that no `ui` or `flow` request reaches a decision
card without one, and none closes without the shot that shows it shipped.

## When a visual is owed

- **`surface: ui`** — the change is to what a person sees on a page: a control,
  a row, a layout, a state. Owes a **mockup**.
- **`surface: flow`** — the change is to what a person does across screens: a
  new step, a removed step, a different order. Owes a **flow diagram**.
- **Anything else** (`api`, `data`, `infra`, `docs`, `copy` with no preview)
  owes nothing — and says so in `visuals.noVisualReason`, one sentence, written
  on the request. An unrecorded skip is a gap nobody noticed; a recorded one is
  a decision.

The PM does not file the recommendation for a `ui` or `flow` request until the
before visual or the reason is on the record. That gate is the PM's; this skill
is what satisfies it.

## The before

**The outcome design on top of the real screen; no labels, no rules, no
cards.**

1. `draw_mockup` with the request and no `mockups`: the tool picks the newest
   real screenshot of the surface (the before, used as it is) and returns its
   size and a pixel map. No screenshot → it refuses; say so in one line.
2. `draw_mockup` again with `mockups`: one image per state worth seeing — the
   change at rest, and hover or a confirmation only when it helps. Each change
   is the new UI as plain HTML over the region it lands on, in the screen's own
   style. Nothing else on the image: no callout, anatomy table, rule box,
   caption or arrow. Nothing the request did not ask for.
3. The tool files the images on the request and writes
   `visuals.beforeArtifactIds` (the screenshot) and `visuals.mockupArtifactIds`
   (the states) as a new version; the feature page shows them. Never type
   those ids yourself. Set `visuals.surfaceUrl` to the live page if it is
   missing.
4. Say one line: what a person will see that they cannot today.

**Drawing found a criterion wrong?** Change `acceptance` with `update_object`
— a new version, on the person's page — and say so in one line. Ask only when
two readings are equally good and the choice is the person's.

A **flow** change is a `mermaid` fence in a document artifact, five to nine
nodes, the changed step marked. A **bug**'s before is the broken state.

The platform's thumbnail (`visuals.drawnArtifactId`) never satisfies the gate.

## The after

When the request's state reaches `shipped`, open `visuals.surfaceUrl` on the
running product and capture it (`find_screenshots` for a shot the deploy
already took; otherwise the workspace's screenshot path). Attach the artifact id
to `visuals.afterArtifactIds`. One still is enough to close; a recording comes
later.

If the surface cannot be reached, attach nothing and say so. A screenshot of a
staging page, a local build or the wrong state closes a loop that is still
open, and QA will read it as evidence it is not.

## What fails this skill

- A mockup not drawn on a real screenshot of the surface.
- Labels, callouts, rules or cards on a mockup.
- A mockup that adds a control, a page or a promise the request did not name.
- An ask where an edit to the request would do.
- A `ui` request decided with neither a before visual nor a `noVisualReason`.
- An after-shot from anywhere but `visuals.surfaceUrl` on the live product.
- Prose where a picture was owed.

## The receipt

One line per request: id, before or after, the artifact id, the surface URL,
and what a person now sees. Anything dated carries its date.

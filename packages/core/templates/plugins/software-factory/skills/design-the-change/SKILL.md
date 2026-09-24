---
slug: design-the-change
name: Designing the change before it is decided
description: >-
  How a request that changes what people see gets a visual a person decides
  against — one mockup or one flow diagram, as an artifact on the request —
  and how the same request is closed with an after-shot from the running
  product. Covers when a visual is owed, what one screen means, where it is
  attached, and the one honest way out. Read whenever a request's `surface` is
  `ui` or `flow`, before its recommendation is filed, and again when it ships.
playbooks: [designing-a-surface, house-voice]
version: 1
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

**Read first.** The request in the asker's words (`title`, `body`, `story`);
the product's own surface (`product.urls`, and a screenshot of the live page
when the workspace can take one); the product's `promises`, so the mockup never
draws something the product has promised not to do.

**Draw one recommendation — and the alternative when a real tradeoff needs a
decision.** One picture is the default, because two pictures with no
recommendation hand the person your job. But when the ask genuinely turns on
a tradeoff a person should weigh (a control in the toolbar or in a menu, a
wizard or one screen), draw both, mark which you recommend and say in one line
what the other buys and costs. Never two options as a way to avoid choosing.

**Match the evidence to the work** (review, 2026-09-24):

| Work | Useful evidence |
|---|---|
| UI change | the proposed screen, with the current one beside it when the difference is the point |
| Flow change | the steps and decision points that change |
| Bug | a reproduction or failure capture — the broken state, not a mockup of the fixed one |
| API / infrastructure | a behaviour, interface or dependency diagram only when it decides something |
| Question / small docs fix | usually nothing; write `noVisualReason` |

**An honest text card beats an empty frame.** The platform draws a diagram of
the record's shape (`visuals.drawnArtifactId`) so a card is never blank; that
drawing never satisfies the gate — `no mock` stays on the row until you file
a real visual or record why there is none — and it must never be presented as
a proposed experience.

**Draw one thing.**

- A mockup is **one screen**, the change obvious, everything else as it is
  today. Not a redesign of the page. Not three variants. Not a screen from a
  different product. An image artifact (`generate_image` where the workspace
  has it, or a rendered HTML artifact via `create_artifact` when the change is
  structural), titled with the request's title.
- A flow diagram is the steps a person takes, as a `mermaid` fence in a
  document artifact, the changed step marked. Five to nine nodes; more is two
  flows.

**Attach it.** `update_object` on the request: append the artifact id to
`visuals.beforeArtifactIds`, and set `visuals.surfaceUrl` to the live URL of
the page the change lands on — the place a person can open to compare. One URL,
because before and after are the same place.

**Say one line.** What the mockup shows that the page does not today. If the
request could honestly be read two ways, name the other reading in the same
line; do not draw it.

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

- A visual attached to the wrong request, or to a task instead of the request.
- Two mockups for one ask.
- A mockup that adds a control, a page or a promise the request did not name.
- A `ui` request decided with neither a before visual nor a `noVisualReason`.
- An after-shot from anywhere but `visuals.surfaceUrl` on the live product.
- Prose where a picture was owed.

## The receipt

One line per request: id, before or after, the artifact id, the surface URL,
and what a person now sees. Anything dated carries its date.

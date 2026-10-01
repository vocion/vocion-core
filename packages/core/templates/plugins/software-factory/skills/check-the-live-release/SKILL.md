---
slug: check-the-live-release
name: Check the live release
description: >-
  How QA checks a shipped release on the live product as the product's QA
  account: derive the live flow from the acceptance criteria and the live app,
  prepare its own state, check each criterion with a picture, clean up, and
  record what was seen with check_live.
version: 1
---

# Check the live release

A release is not verified because the deploy answered 200. It is verified when
somebody saw the change on the live product. You are that somebody, signed in
as the product's QA account.

## 1. Read what shipped

- The release (`lookup_objects`): `requestIds`, `taskIds`, `product`.
- Each request: its **acceptance criteria** (what you prove), and
  `liveCheck.flows` when it was checked before: start from that flow.
- Each shipped task's `qaFlows` are **hints only**. They ran against the mock
  build: a record, a name or a time in them ("2 hours ago by maya@…") does not
  exist on production. Never wait for mock data on the live product.
- `product_access` for the product: each environment's URL, the QA sign-in's
  email, and `liveSetup` — how this product's QA account prepares state, or
  a standing fixture it keeps. Follow it when it is there.

## 2. Look before you write

When you do not know a live page, run `check_live` with `explore: true` and a
flow that opens it and shoots. Read `pageText`: the real labels, buttons and
empty states. Nothing is written on an exploring run, and cleanup still runs.

## 3. Write the flows

Three phases, run in this order. Values carry from one flow to the next.

- **setup** — make the state the change needs, as the QA account. Upload a
  small test record (`upload` sends a real one-page PDF; name it so a person
  can tell it is QA's, e.g. "Vocion live check"), `remember` the page it landed
  on (`{name: recordUrl}`) and anything it shares (`{name: shareUrl, from: href,
  selector: "<the link's text>"}`). Something only a visitor can do — open a
  shared link — is its own setup flow with `signed_in: false` and `path:
  "{{shareUrl}}"`, with a `pause` of a few seconds when the product counts a
  visit by time.
  After an `upload`, `click` or `fill`, `remember` the page only once the
  product has moved to the record (a `wait_for` on something only the record's
  page shows, e.g. its title): if the page never leaves where the flow
  started, the remember fails with that reason instead of keeping the upload
  page as the record. Read the setup run's `pageText`: an error the product
  shows there ("Something went wrong") means nothing was made.
- **check** — one flow per acceptance line a person can see: `request_id`, the
  `criterion` in the request's own words, `path` naming what setup made:
  `{{recordUrl}}` (or any name setup remembered), or `{{setupPage}}`, the page
  the last finished setup flow ended on. Never the setup's own start page.
  `wait_for` the state, and a `shoot` naming what the picture shows. Prove what
  the live product can show. When a criterion depends on something production
  cannot have (a paid plan, a named viewer), shoot what it does show and say
  so in the shoot's words; do not fake it.
- **cleanup** — remove everything setup made (open the record at the same
  `{{recordUrl}}` or `{{setupPage}}`, delete it, confirm). It always runs,
  even when the check failed. Prefer one standing fixture over creating anew
  when `liveSetup` names one.

Only the product's own addresses open. Never type a password: signing in is
the check's, with the stored QA sign-in.

## 4. Run it, and once more if it missed

Run `check_live` without `explore`. If the change was not seen, read each
run's first failure and `pageText`, fix the flows (a selector, the state setup
makes, the path), and run it once more. Two real attempts; then stop. The
release and each feature then say what was seen, or "Live check could not
reach the change: <reason>" — the honest answer, not a pass.

Report in one line what was seen live. `check_live` writes the release and the
features; do not write them yourself.

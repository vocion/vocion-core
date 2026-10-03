---
slug: check-the-live-release
name: Check the live release
description: >-
  How QA checks a shipped release on the live product as the product's QA
  account: open it in the run's browser, look, act, screenshot what proves
  each acceptance line, and record every line with record_live_check.
version: 3
---

# Check the live release

A release is not verified because the deploy answered 200. It is verified when
somebody saw the change on the live product. You are that somebody, signed in
as the product's QA account.

1. **Open.** `browser_open` with the release id and a path. It signs in with
   the product's stored QA sign-in (you never see the password; `signed_in:
   false` looks as a visitor) and lists each shipped request's acceptance
   lines, numbered. Only the product's own addresses open.
2. **Look.** Every answer is the page's accessibility snapshot: each element's
   role, name and state (`[disabled]`, `[checked]`, `[expanded]`) and a ref.
   Judge what it shows. A Save that is `[disabled]` for a blank name is the
   line "a blank name is not saved", seen.
3. **Act.** `browser_click`, `browser_type`, `browser_press` by ref, the way a
   person would. A click on a disabled control answers "disabled" at once. If
   a line needs something made (a record, a share link), make it as the QA
   account, name it so a person can tell it is QA's, and remove it after.
   The shipped tasks' QA flows ran on the mock build: their records do not
   exist on production.
4. **Screenshot** what proves each line (`browser_screenshot`, captioned with
   what it shows). For a line about an API, `browser_responses` lists what the
   page received, each with an id.
5. **Record** with `record_live_check`, once, every line of every request:
   `seen` or `not_seen` citing the ids your browser calls returned, or
   `not_observable` with why production cannot show it (a CI run, an image's
   contents, a pre-merge guarantee) — it reads "proven before merge by QA's
   verdict" when the verdict proved it. A refusal lists what to fix; fix it
   and record again.

Report in one line what was seen live. `record_live_check` writes the release
and the features; do not write them yourself.

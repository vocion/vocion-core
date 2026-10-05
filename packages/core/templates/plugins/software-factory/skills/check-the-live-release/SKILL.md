---
slug: check-the-live-release
name: Check the live release
description: >-
  How QA checks a shipped release on the live product as the product's QA
  account: open it in the run's browser, look, act, screenshot what proves
  each acceptance line, record every line with record_live_check, then show
  each feature seen as a demo a product manager can watch.
version: 7
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
   line "a blank name is not saved", seen. A long page is cut at 12,000
   characters from the top and says so; a section past the cut is not
   "cannot show": call `browser_snapshot` with `find` set to words written on
   it (its heading, a label) and the snapshot shows the page around them.
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
   `not_observable` with why production cannot show it and its `cause`:
   `proven_before_merge` (a CI run, an image's contents, a pre-merge
   guarantee the verdict proved), `not_a_live_behaviour`, or
   `environment_cannot_show` when your QA account or its data cannot reach
   the feature (no team library, no plan, nothing to act on). Say exactly
   what the environment needs in `why`: that cause makes the release read
   not checked with your fix named, so a person can give the account what it
   needs and check again. A refusal lists what to fix; fix it and record
   again.

6. **Show it.** For each shipped request the live product can show you
   (any line seen, or the feature reachable as the QA account), record its
   feature demo — whether or not its lines were proven before merge: a video a product manager or product owner watches to see what the
   feature does, not QA's check. Open the demo with `browser_open` carrying
   `demo_for_request` (its own tab and its own recording, filed on that
   request). Then ENACT the whole story the way a user would, start to
   payoff, on screen (Chris, 2026-10-04, on the expiry demo: "the demo video
   doesn't quite show it all happening. Like there's no pdf upload and no
   view of user trying to open an expired link"):
   - Start where the user starts and MAKE what the feature needs in the
     demo tab itself: a feature about files begins with `browser_upload`
     (a sample PDF, named like a real one); a feature about a setting sets
     it there and then; a feature about a link copies or opens that link.
     Nothing is assumed to exist already, and nothing is described that is
     not on screen.
   - Do the one thing the feature is for, then show its payoff from the
     side it lands on: open the link as the recipient (`browser_open` with
     `signed_in: false` in the same demo), count the opens down, see the
     expired page; read the reminder; find the row where the feature put it.
     The payoff is the part a product owner is waiting for.
   - Six to twelve steps. Say what you do as you do it: `say` on each
     `browser_open`, `browser_click`, `browser_type`, `browser_upload` and
     `browser_press`, and `browser_say` for the opening line and the closing
     line. One plain sentence each, present tense, first person, for someone
     who has never seen the feature ("I upload the board deck and set it to
     stop after two opens"). The screen holds while each line is said, so a
     viewer sees the state you describe; you never need to wait.
   - A visible change per line: a line said over a screen that did not
     change for it is cut from the demo. No edge cases, no second viewport.
     Anything you made for the demo, remove after it in a check tab
     (`browser_open` without `demo_for_request`), so the removal is not in
     the video.

Report in one line what was seen live, and that the demo was recorded.
`record_live_check` writes the release and the features; do not write them
yourself.

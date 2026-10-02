---
slug: draw-from-the-ask
name: Drawing from what the asker showed
description: >-
  What the designer reads before drawing a mockup for a request that came
  from chat or from the tracker: the asker's own screenshots and files, then
  the live screen, then the component's source on the code host. What is
  copied from each and what is ignored. Read before `draw_mockup` on any
  request whose `evidence.urls` points at a thread or an issue.
playbooks: [designing-a-surface, house-voice]
version: 1
---

# Drawing from what the asker showed

A mockup drawn from the request's title is a guess at a screen. The asker
usually showed the screen: a screenshot in the thread, an attachment on the
issue, a line that names the page. Read those first; `design-the-change` says
how the drawing itself is done.

## In this order

1. **The asker's files.** `chat_read_file` for each file on the thread
   (`chat_read_thread` lists them with their ids), `tracker_read_attachment`
   for each attachment on the issue (`tracker_read_issue` lists them). An
   image comes back as an artifact; a text file as text. Save nothing
   twice — the artifact ids go on `evidence.screenshotArtifactIds` if the
   request does not carry them yet.
2. **The live screen.** `find_screenshots` and the survey, as
   `design-the-change` says. The asker's screenshot says what they saw; the
   live screen says what is there now, and the two differ more often than
   anyone expects.
3. **The component's source**, only when the change touches a control you
   need to draw faithfully: `repo_read_file` on the file that renders it, in
   the repository the product names. Read it for the states the control has
   and the words it uses; never to decide what to build.

## What is copied, what is ignored

- **Copied**: the page the asker was on, the control they pointed at, the
  words they used for it, the state they were in when it went wrong.
- **Ignored**: their suggested fix when it is a design ("make the button
  red"), their annotations' style, anything the thread said about who should
  do it or when. The mockup is the outcome drawn as the product's own UI,
  not a tracing of their picture.
- **Named, not drawn**: a screen the asker described that you could not
  reach (no screenshot, no live URL) — say so in `visuals.noVisualReason`
  with what would unblock it, rather than drawing from imagination.

## Reference, not decoration

The asker's screenshot is a *reference* for `draw_mockup` only when the
request's `visuals.surfaceUrl` has no live screenshot of its own. The
drawing stays the product's real screen with the change laid over it; the
asker's image is what you looked at, kept on the request as evidence so the
reviewer looks at the same thing.

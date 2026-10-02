---
slug: close-with-the-after-shot
name: Closing with the after-shot, where they asked
description: >-
  Once a request that changes what people see has shipped: the after-shot
  taken from the live product, attached to the request, attached to the issue
  the asker filed, and offered to the thread they asked in with the live URL
  and one line of what changed. Read when a `ui` or `flow` request's
  `releaseId` is set and its `visuals.afterArtifactIds` is still empty.
playbooks: [designing-a-surface, house-voice]
version: 1
---

# Closing with the after-shot, where they asked

The after-shot is the proof a person can look at: the running product, the
change visible, the URL it was taken from. `design-the-change` says how it is
taken and attached to the request. This skill says where else it goes, so the
person who asked sees it without opening Vocion.

## On the issue

When the request's `evidence.urls` carries an issue URL: propose
`tracker.attach_file` with the after-shot's artifact id, the issue key, and a
`caption` of one line in the product's terms ("The warranty report, loaded on
a Monday"). Done for you; Undo deletes the attachment. The comment that
explains it is the PM's reply (`tell-the-requester`), not a second comment
from you: one voice on the issue.

## In the thread

When the request came from chat: the after-shot rides the PM's reply
(`chat.reply_in_thread` carries images in the post, like every announcement).
Put the artifact id and the one-line caption on the request
(`visuals.afterArtifactIds`, the caption in the request's `answer` draft) so
the reply is written from them. Do not post in the thread yourself.

## What the line says

One sentence, in the asker's words where they fit, naming what a person now
sees that they did not before, and the live URL. Not the task, not the
release's internals, not "as requested".

## When there is no after-shot

A change that shipped but cannot be seen live (behind a sign-in you do not
hold, a flow that needs data the QA account lacks) is said so in
`visuals.noVisualReason` with what would unblock it. Never a screenshot of a
different state offered as the after-shot: the reviewer and the asker will
read it as proof.

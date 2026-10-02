---
slug: tell-the-requester
name: Telling the requester where they asked
description: >-
  Where a reply to the person who asked goes (the thread they asked in, the
  issue they filed, the mailbox or store it came from), the three kinds of
  message and what each must carry, the one piece of evidence every reply
  links, and why a person releases every one of them. Read before any reply to
  an asker is drafted — a completion, a decline, a deferral, an incident update
  — and when the two-hourly reply pass finds a request with an outcome and no
  `told`.
playbooks: [house-voice, naming-the-work]
version: 1
---

# Telling the requester where they asked

A reply lands where the ask came from, or it did not land. The request's
`channel` says which door; the `evidence.urls` say which thread or which
issue. The reply is drafted by the factory and sent by a person, every time,
because it is read by someone who did not choose to talk to a machine.

## Where it goes

| `channel` | The move | Recorded as |
|---|---|---|
| `chat` | `chat.reply_in_thread` in the thread whose permalink is first in `evidence.urls` | `told.channel: chat` |
| `tracker` | `tracker.comment` on the issue whose URL is first in `evidence.urls` | `told.channel: tracker` |
| `email`, `store_review`, `site` | `notify.requester` as before: the words for a person to send on that channel | `told.channel` as the channel |
| `dogfood`, `internal` | the request's own page is the reply; a line in chat if they asked there | `told.channel: internal` |

A request with several askers (`duplicateOf` pointing at it) is answered on
each asker's channel, from the same words.

## The three kinds

Every reply names its `kind`, because the ladder reads them apart
(`chat.reply_in_thread.<kind>`, `tracker.comment.<kind>`, `notify.requester.<kind>`):

- **`completion`** — it shipped. Carries the release's short name, what the
  person can now do in their own words, and the link that proves it (the
  release page, or the live URL from the after-shot). Routine and evidenced:
  the one kind a product owner may one day let go out on its own.
- **`update`** — it is happening or it is waiting. A plan approved, a build
  started, a deferral with its date and its reason. Carries the request link.
- **`sensitive`** — a decline, an incident, anything that touches a promise
  or a cost. Carries the reason in full, the alternative when there is one,
  and who decided. Read by a person, every time, with no exceptions.

## What every reply carries

One sentence of what happened, one of what they can do about it, one link.
Nothing about workers, attempts, models or tasks. The asker's words where
they fit ("the warranty report now loads on Monday mornings" beats "the
pipeline's cron was corrected"). The house voice.

## Then write it down

When the person releases the reply, write `told: { at, channel, what, status }`
on the request — the `at` is when it was sent, `what` is the one-line
summary, `status: sent`. A request is closed when `told` says sent, not when
the release says announced. On a chat request, a `white_check_mark` reaction
(`chat.add_reaction`) on the original message is the receipt beside the reply.

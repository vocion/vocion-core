---
slug: unblock-a-ticket
name: 'The factory is waiting: answer it or ask the thread'
description: >-
  What to do when a factory ticket waits on a person: read what it waits on,
  answer it yourself only when the thread or the record already settled it,
  otherwise ask the people in the thread; and how a person's answer, yes or
  change is passed on in their name (`mcp.act` on the `factory` source). Read
  when the factory says a ticket needs someone, and when a person in the
  thread answers or decides something about a ticket.
version: 1
---

# The factory is waiting: answer it or ask the thread

A ticket that waits costs a day every time nobody notices. Your job is that
the wait is as short as the answer is easy.

## Read what it waits on

`mcp_read` on `factory`, `ticket_status` for the ticket. It says what the
ticket waits on, what replies it will take (an answer, an approval, changes),
and the page it is waiting on. Read the page. Do not answer from the update's
one line.

## Three kinds of wait

1. **A question the record settles.** The factory asks which device, which
   page, what the expected behaviour is, and the thread or the recording
   already said. Answer it: `propose_action`, `action_id: mcp.act`,
   `sourceSlug: factory`, the reply tool (`reply_ticket`) with
   `decision: answer` and a note that quotes where the answer comes from
   ("Jamie, in the thread: 'mic on, system audio off'"). Then tell the thread
   in two lines what was asked and what you answered, so anybody can correct
   it.
2. **A person's decision.** A yes to spend, an approval of a Brief or a
   Design, a choice between options nobody chose. Never yours. Tell the
   thread what is needed in the plainest words: what the decision is, the one
   fact that matters most for it (the forecast, the scope, the open point),
   the link, and that a reply here that mentions you will be passed on.
   Address the person who asked.
3. **Something the factory keeps for its own app.** Review of finished work
   and the merge. Say it waits there, with the link. Do not try to decide it.

When you are not sure which kind it is, it is the second.

## Passing on what a person said

A person replies in the thread with an answer, a yes or a change. Pass it on
in this turn with the reply tool: `decision: answer` for answers,
`decision: approve` with `person` set to their name for a yes,
`decision: changes` with their words in `note` for a change. Their words, not
your summary of them: quote them in the note. They asked, so it runs at once.

Then say what happened in one or two lines, from the factory's answer: what
was recorded and what the ticket is doing now. If the factory refused it
(this step is decided in its own app), say that and give the link.

A reply that is not clearly a decision ("looks fine I guess, but what about
tablets?") is a question. Answer or ask; do not record it as a yes.

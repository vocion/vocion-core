---
slug: unblock-a-ticket
name: 'The factory is waiting: answer it or ask the thread'
description: >-
  What to do when a factory ticket waits on a person: read what it waits on,
  answer it yourself only when the thread or the record already settled it,
  otherwise ask the people in the thread; and how a person's answer, yes or
  change is passed on in their name (`mcp_act` on the `factory` source). Read
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

## Two kinds of wait

1. **A question the record settles.** The factory asks which device, which
   page, what the expected behaviour is, and the thread or the recording
   already said. Answer it: `mcp_act` with `sourceSlug: factory`,
   `name: reply_ticket`, `input: { ticket, decision: "answer", note }` and a
   one-line `summary`; the note quotes where the answer comes from
   ("Jamie, in the thread: 'mic on, system audio off'"). Then tell the thread
   in two lines what was asked and what you answered, so anybody can correct
   it.
2. **A person's decision.** A yes to spend, an approval of a Brief, a
   Design, the finished work or the merge, a choice between options nobody
   chose. Not yours to make unasked. Tell the thread what is needed in the
   plainest words: what the decision is, the one fact that matters most for
   it (the forecast, the scope, the open point), your own read of it in one
   line ("I would approve: every check passes; the one gap is…"), the link,
   and that a reply here that mentions you decides it. Address the person
   who asked. Every step can be decided from the thread, to the merge.

When you are not sure which kind it is, it is the second.

## Passing on what a person said

A person replies in the thread with an answer, a yes or a change. Pass it on
in this turn with `mcp_act` (`sourceSlug: factory`, `name: reply_ticket`,
`input: { ticket, decision, note, person }`, a one-line `summary`): `decision: answer` for answers,
`decision: approve` with `person` set to their name for a yes,
`decision: changes` with their words in `note` for a change. Their words, not
your summary of them: quote them in the note. They asked, so it runs at once.

Then say what happened in one or two lines, from the factory's answer: what
was recorded and what the ticket is doing now. A yes at the merge approves
the pull request and merges it; if GitHub would not merge yet, the factory
says why: pass that on and say you will tell the thread when it merges.

## "You decide" is a decision

A person who does not know how to answer may hand it to you: "answer it for
me", "you decide", "what would you do? do that". That is their word, and it
runs. Do the work they are trusting you with:

1. Read what it waits on in full (`ticket_status`, its page), the thread,
   and what the factory's wiki says the product is for.
2. Form your own view and decide. Approve when the work does what was asked
   and the open points do not change that. Ask for changes when something
   asked for is missing or wrong, and say exactly what. Answer a question
   with the answer you would defend.
3. Send it with the reply tool, with `person` set to their name and "decided
   by the desk at their request" (so the record shows who asked and who
   judged), and your reasoning in `note`: what you checked, what you
   decided, and the one thing you would watch.
4. Tell the thread in three lines: what you decided, why, and what happens
   next. They can overrule you with one reply.

Do not hand the decision back with a list of considerations. If you truly
cannot decide (the page is missing, two readings would build different
things), say the one thing you need, once.

A yes that spends money or merges code is still theirs to hand over: do it
only when they said so in this thread, never because an earlier ticket was
delegated.

A reply that is not clearly a decision ("looks fine I guess, but what about
tablets?") is a question. Answer or ask; do not record it as a yes.

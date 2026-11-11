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

Then look where the answer may already be: the thread, and the recording
the request came with (`get_video`, `get_transcript`, `get_activity`,
`get_screenshot` on the recordings source). A question about which app,
which device or which setting is usually answered there.

## Two kinds of wait

1. **A question the record settles.** The factory asks which device, which
   page, what the expected behaviour is, and the thread or the recording
   already said. Answer it: `mcp_act` with `sourceSlug: factory`,
   `name: answer_ticket`, `input: { ticket, note }` and a one-line `summary`;
   the note quotes where the answer comes from
   ("Jamie, in the thread: 'mic on, system audio off'"). Then tell the thread
   in two lines what was asked and what you answered, so anybody can correct
   it.
2. **A person's decision.** A yes to spend, an approval of a Brief, a
   Design, the finished work or the merge, a choice between options nobody
   chose. Not yours to make unasked. Ask for it so a busy person can answer
   from a phone in ten seconds: at most four short lines, about 50 words.

   - The ticket key as a link, who is needed and the decision, in one line.
   - Your recommendation and the single reason that matters most
     ("I'd ask for a change: the checks never open the shared link").
   - Only if somebody else must answer something first: that one question,
     to them by name.

   Everything else stays on the ticket: do not retell the page, list the
   reviewer's findings or quote the cost unless the decision is about cost.
   Never say how to reply or what they can say: they know, and a reply in
   the thread reaches you. If they want more they will ask.

When you are not sure which kind it is, it is the second.

## A question is not a decision

"Should we approve?", "what do you think?", "is this ready?" are questions.
Answer them: your recommendation and the one reason, in two lines. Then
stop. Do not approve, do not send anything back, do not "take it from
here". You act on a ticket for a person only when they decided: "approve",
"yes, ship it", "send it back and ask for X", or handed it to you in so many
words ("you decide", "answer it for me"). If you are not sure which it was,
it was a question.

Never write that a person decided or handed you a decision unless they did,
in this thread. The factory records the name you give.

## Passing on what a person said

A person replies in the thread with a decision. Pass it on in this turn with
`mcp_act` (`sourceSlug: factory`, `name: decide_ticket`,
`input: { ticket, decision, note, person }`, a one-line `summary`):
`decision: approve` for a yes, `decision: changes` with their words in
`note` for a change, `decision: confirm` when they tried what the factory
could not check. `person` is their name. Their words, not your summary of
them: quote them in the note. An answer to a factory question, with no
decision in it, goes through `answer_ticket` instead.

Then say what happened in one or two lines, from the factory's answer: what
was recorded and what the ticket is doing now. A yes at the merge approves
the pull request and merges it; if GitHub would not merge yet, the factory
says why: pass that on.

A reply that is not clearly a decision ("looks fine I guess, but what about
tablets?") is a question. Answer or ask; do not record it as a yes.

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
3. Send it with `decide_ticket`, with `person` set to their name and "decided
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

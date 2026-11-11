---
slug: take-a-request
name: A request in a thread becomes a factory ticket
description: >-
  How a request to build, fix or change software, asked in a thread or in
  chat, becomes a ticket in the delivery factory in the same turn (one per independent piece of work when a thread holds several):
  what to read first (the thread, and any linked recording), the one round of questions that is allowed, what the
  ticket must say, how it is filed (`mcp.act` on the `factory` source), and
  what the thread is told. Read whenever somebody asks for software work, and
  before anything is filed with the factory.
version: 1
---

# A request in a thread becomes a factory ticket

The thread is where people say what they need, in the order they think of it.
The ticket is what the factory builds from. This skill is the one move from
the first to the second, and it ends with a ticket link in the thread.

## Read before you write

Read the whole thread, oldest first, with its files (`page_context`, then
`chat_read_thread` and `chat_read_file` when there is a link, a picture or a
recording). The ask is rarely the mention alone: the first message shows the
problem, a reply says what somebody thinks causes it, the mention says "can we
fix this". A linked recording or screenshot is evidence: name it in the
ticket.

## A linked recording is read before anything else

A request that points at a recording (a Slate link, a Loom, a video in the
thread) is not understood until the recording is. When a source that reads
recordings is connected, read it first, every time, before you file and
before you ask anybody anything:

1. The recording itself (`get_video`): its title, what kind it is, its size
   and length, who made it, and whether it has a transcript. These are facts:
   a title that says "mobile" and a tall, narrow picture is the phone app; a
   transcript that failed on a recording somebody talked through is evidence
   the audio is missing.
2. What was said (`get_transcript`) and what was on screen
   (`get_activity`), when there is any.
3. A frame at the start and at the moment that matters (`get_screenshot`):
   the screen shows the app, the setting and the state better than words.

Put what you learned in the ticket as facts, with the time where there is
one. **Never ask a person something the recording answers**: which app,
which device, which setting was on, what they did. If the recording cannot
be read, say so in the ticket and in the thread, and only then ask.

Then check the factory does not already have it: `mcp_read` on `factory`,
`list_tickets`. If an open ticket is the same ask, do not file a second one.
Say so with its link and what it waits on.

## A thread with several requests

People pile things into one thread: two people, three asks, one of them a
numbered list, one of them a single vague line. Sort it before you file.

- **One ticket per independent piece of work.** Two things are independent
  when one could ship without the other: a different product (the Mac app,
  the video editor), a different person's problem, a different part of the
  screen. A numbered list about one behaviour (how trimming a clip should
  work) is ONE ticket whose points become its done-when lines; split a point
  out only when it stands alone ("and let me delete a clip").
- **Each ticket carries its own reporter**, in `origin.by`, and the link to
  that person's message in `origin.url`, not the thread's first message. The
  reporter is the author of the message that asked, as the thread context
  names them, never the person it was addressed to.
- **File the clear ones now.** A detailed ask is filed in this turn. Do not
  hold it for the vague one.
- **A thin one gets one question, to its reporter by name**, in the same
  reply, and is filed when they answer. If the factory can start without the
  answer, file it and put the question in the ticket instead.
- **Say what you did in one reply, one line per request**: the ticket as a
  link and five or six words, or the question with the person's name. Three
  requests are three lines, not three messages.
- **Later, a reply names its ticket.** When more than one ticket from a
  thread waits on a person and a reply does not say which ("approve",
  "yes"), read which message it answers and who wrote it. If that settles
  it, act; if it does not, ask "SL-17 or SL-18?" and nothing else.

## Answer what you can

If the thread asks a question you can settle (how something works, whether
it already shipped, what a ticket waits on), answer it. Not everything is a
ticket. A question that turns out to be a defect or a missing feature becomes
one: say which and file it.

## Ask only for what the ticket cannot start without

File on what you have. Ask first only when the ticket would be a guess
without it: which of two readings of the ask is meant, or what "done" looks
like when the thread never said. One message, at most three questions, each
answerable in a word or a line, and say you will file as soon as they are
answered. Never ask for what the thread or the recording already shows, and
never ask twice: after one round, file with what you have and put the open
point in the ticket as a question for the Brief.

## What the ticket says

- **title**: what a person will be able to do or see when it is done, at most
  twelve words. Not the complaint ("Phone recordings keep the microphone
  audio", not "audio bug").
- **description**: the problem in the asker's words, quoted; who has it and
  where (device, page, setting); what done looks like, as one or two lines a
  person could check; links to the thread, the recording and any picture; and
  what somebody in the thread believes the cause is, marked as their belief.
- **origin**: `by` is who asked, as the thread names them; `url` is the
  permalink of the message that asked. The conversation is filled in for you.

## File it

Call `mcp_act` once, with exactly these four arguments:

- `sourceSlug`: `factory`
- `name`: the filing tool, `request_ticket`
- `input`: `{ "title": …, "description": …, "origin": { "by": …, "url": … } }`
- `summary`: one line, what is being filed

A person asked for it, so it runs at once and the factory's answer comes back
with the ticket's key and link. Do not look the schema up first unless the
call is refused; if it is, the refusal names the field: fix that field and
call once more.

If the factory answers that it needs answers before it can start, ask the
thread those questions, word for word where they are clear, and say the
ticket exists and waits on them.

## Tell the thread

Two lines: the ticket as a link on its key with its title, and what happens
next in a few words. Nothing else: do not restate the request, and do not
say how to reply.

If you could not file it, say so in one plain line and what you need. Never
describe tools, formats or what you are about to try: the thread is people.

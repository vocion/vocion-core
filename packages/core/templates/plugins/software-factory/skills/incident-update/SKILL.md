---
slug: incident-update
name: The incident update a person sends
description: >-
  The status post for an environment that is down or a deploy that failed:
  what is down, since when, what the recovery has tried, the next move, and
  when the next update comes. Drafted by the Release engineer as a
  `chat.post_message` card to the bound channel, released by a person, and
  updated on a cadence until the environment is healthy. Read when an incident
  request is filed, when a recovery step runs out, and when someone asks "is it
  back?".
playbooks: [house-voice, verify-against-reality]
version: 1
---

# The incident update a person sends

The recovery runs itself: re-run, redeploy, roll back, each on the
environment's Activity with its Undo. The people waiting on the product do
not read Activity. They read the channel. An incident has an update there the
moment it is an incident, and every time something changes after that.

## What one update says

Five lines, in this order, in the house voice:

1. **What is down**: the product and the environment by name, as a person
   knows them ("the warranty report, production"), and what a person sees
   ("the Monday report does not load").
2. **Since when**: the time of the first failed health read or failed deploy,
   dated with its date, not "this morning".
3. **What was tried**: the recovery steps so far by name — re-ran the deploy,
   redeployed the merged release, rolled back release 1.8 — each with its
   result, read from the environment's `pipelineLog`.
4. **The next move**, and who makes it: the next recovery step, or the ask
   to the person who holds what is missing, named.
5. **When the next update comes**: a time, not "soon". Thirty minutes while
   down; on the hour once degraded; a closing update when healthy.

## How it goes out

`propose_action` `chat.post_message` with `kind: sensitive` implied by the
trust rule — an incident update is read by a person before it posts, every
time — `title` "Incident — <product> <environment>", `about` the environment
record's reference so a second update refreshes the pending card rather than
stacking a new one, and `text` the five lines. Each later update is a new
post in the same channel; the first post's thread is the place for them when
the chat supports threads (`chat.reply_in_thread`, same `about`).

## When the asker is a client

A request of kind `incident` has an asker and a channel like any request.
The update to the channel is the team's; the update to the asker is the PM's
reply (`tell-the-requester`, kind `sensitive`). Two posts, same facts, one
written once.

## The closing update

Healthy again: one post saying it is back, since when, what the cause was in
one sentence, and what changes so it does not recur, or that this is still
being worked out. Never "resolved" without the time it was healthy from.

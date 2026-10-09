---
slug: workspace-setup
name: Set up this workspace
description: >-
  Set up a new or nearly empty workspace with a person — a short interview
  (what the team does, one job done every week, which systems the work lives
  in), then one setup plan as one-click cards with propose_setup. Use it when a
  person asks to set the workspace up, to connect a system, to start from a
  template or an app, to brand the workspace from their website ("make it
  ours", "add our logo and colours"), or when the workspace has nothing in it yet.
version: 1
---

# Set up this workspace

The outcome is a workspace that does one real job for this team by the end of
the conversation. Not a tour, not a settings page: a plan the person accepts
card by card.

## 1. Look before you ask

Call `setup_options` first. It says what this workspace already has (systems
connected, apps added, agents on the team, people invited) and what this
installation offers: apps and templates, catalog roles, systems to connect.
Never offer something it does not list, and never offer something already done.

## 2. Interview — three questions at most, one at a time

Ask only what you still need, in this order, each in one short line with an
example answer the person can copy:

1. **What does this team do?** ("We run customer support for a software product.")
2. **Name one job you do every week.** ("Every Friday we report on open tickets.")
3. **Which systems does the work live in?** ("Our helpdesk, our team chat and a folder of shared documents.")

Skip a question the person already answered. When they came in through a
starter:

- "Connect a system", "connect my tools", "what should I connect?" — call
  `connect_system` straight away, with the connector slugs of any systems they
  named (none if they named none). It ranks what to connect from what this
  workspace already has, asks at most one question itself, and walks them
  through each system above the composer, verifying each as it goes. Do not
  interview first and do not list systems in prose: the walk-through is the
  answer. One line before it at most. These are team connectors, the shared
  systems the workspace's agents use; a person's own accounts for their
  personal assistant are personal connectors, connected in Personal.
- "Start from a template" — ask question 1, then offer the apps and templates
  that fit.

If they say "you pick", "skip" or "just set it up", stop asking and plan from
what you have. Never ask a fourth question.

## 3. Propose the plan — one `propose_setup` call

Say first, in one or two sentences, what the plan gets them — then make the
call. The cards end your turn: nothing you would write after them is shown.

Three to six steps, each with one line of *why* in the team's own words
(the weekly job, the system they named):

- **A template or an app** that fits what the team does — one, two at most. A
  template stands a whole function up (teams, measures, missions); when one
  fits and `setup_options` says this workspace can take it, prefer it, and
  fill its `answers` from what the person told you in the interview. Otherwise
  offer the app.
- **Connect** each system they named that `setup_options` lists. Two or more
  become one "Connect your systems" step that walks them one at a time. A
  system it does not list: say so in one line; do not invent a way to connect it.
- **Hire** one or two catalog roles that would own the weekly job.
- **Invite** teammates when the person named who else should be here (their
  email addresses). Without addresses, end by asking who should join.

Order the steps the way the work would happen: the app, then the systems it
reads, then the people and agents who use it.

## Make it yours — "brand this workspace from <site>"

When the person asks to brand the workspace, add their logo or colours, or
make it look like theirs, make one `propose_brand` call with their website
(or their business name when they gave no site). It reads the logo, colours and
fonts off their own site and shows a preview of the app wearing them — the
sidebar and the sign-in page — with three choices: **Use this brand**,
**Adjust** (Brand settings, with the draft in it) and **Skip**. Say in one
line what it will show before the call; the card ends your turn.

- Never describe their brand from memory, and never invent a colour or a
  logo URL: the card is the answer, and its notes say what the site did not
  give.
- Only an Org admin can brand the Org. If the result says this person is not
  one, say so in one line and name who can.
- In a full setup plan, `{kind:"brand", id:"<their site>"}` is the last step:
  the work first, then how it looks. Offer it only when you know their site
  and `setup_options` says the Org has no brand yet.

## 4. After the cards

The person presses each card themselves; every one can be undone. On their
next message, read what became of each step before you answer (a card is not
done until its run says so — never claim it is), and carry on from where the
workspace now stands: the next useful step, or the weekly job itself.

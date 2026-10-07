---
slug: set-up-the-factory
name: Setting up the factory
description: >-
  How the PM walks a person through what the software factory still needs
  before it can work — the GitHub connection, the product, the repositories —
  one connect card per remaining step, the login as the approval, and the records
  proposed from what the installation actually grants. Read when a person
  taps "Set up your software factory", asks to set up or connect anything,
  or when a source has nothing to read; and when `source.connected` fires
  for GitHub.
version: 1
---

# Setting up the factory

A factory that is on but not set up has seats, missions and pages, and
nothing it can read. Setup is the shortest path from that to the first map:
the person does the one thing only a person can do (log in to GitHub), and
the factory does the rest from what the login grants.

## Read the state first, never assume it

Call `describe_setup`. It names every step the plugin declares, whether it is
done, and the exact link for each. That is the whole agenda. Do not list a
step it says is done, do not invent a step it does not name, and do not ask
the person anything `describe_setup` or `describe_sources` can answer.

Then call `describe_sources` for the github source. It says whether a
credential is stored, whose account it is on, which repositories the
installation grants (asked of GitHub live) and which the source lists — and
names each mismatch.

## The card is the answer

Lead with it. After `describe_setup` (and `describe_sources`, when a
connector is up and the grant matters), call `offer_connection` at once —
one sentence before it at most, naming what is missing, and nothing after
it. The turn ends at the card: the platform stops the model there, so
anything you meant to say after it is never read. Say it before, in one
line, or not at all.

For a connector step that is not done, call `offer_connection` with the
connector slug and one sentence on what connecting it lets the factory do
("read pull requests, checks and deploy runs on the repositories you
grant"). That puts a one-tap card in the conversation: the person taps it,
connects at the vendor or pastes a key on the Connectors page, and comes back
to this conversation connected. One card per connector, never two for the
same one, and nothing described in prose that the card already says.

Only admins can connect a source; the card says so to anyone else. Say in
one line that a workspace admin is the one who finishes it.

## When GitHub is connected, the records follow

The product and its repositories are records a person accepts, because a
repository record is the contract QA verifies against. Propose them; do not
wait to be asked.

- **One product**, with `file_product`, unless the repositories plainly
  belong to different products — then say so and file one per product. Its
  slug is the key every request names it by; its name is what it is called
  in prose. Read what the repositories are from their names and READMEs
  (`repo_read_tree` on each, when the source lists it); never from memory.
- **One repository record per granted repository**, with `file_repo`: the
  URL and the default branch as GitHub reports them, the product's slug, and
  the checks the repository runs if its workflows are visible. A repository
  the installation grants but the source does not list cannot be read, and
  the reverse cannot be written to — name the mismatch and the fix on each
  side (add it to the source's list; grant it on GitHub).
- A record that already exists is left alone. `describe_setup` says whether
  the record steps are done.

Mapping is not yours: once a repository record lands, the Release seat reads
it and files the product's architecture on its own (`map-the-codebase`). Say
that it will, in one line, so the person knows what happens next without
doing anything.

## When every step is done

The setup chip disappears on its own. Say what the factory can now do, in two
lines, and stop: the loop's first request is the person's to file, from the
tracker, from chat or from GitHub.

## What never happens here

- No step is described in prose when it can be a card the person taps.
- No credential is asked for in chat, pasted, or stored by you; the login
  stores it, or a person pastes it on the Connectors page.
- Nothing is guessed to fill a gap a connection would answer: an unconnected
  GitHub means "connect it", never a product filed from the workspace's name.
  The platform refuses the record while GitHub is unconnected ("Not filed: a
  product is read from github…"); when you see that, offer the connection
  and stop — do not file it another way.

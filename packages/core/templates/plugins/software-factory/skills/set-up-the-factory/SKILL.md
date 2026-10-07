---
slug: set-up-the-factory
name: Setting up the factory
description: >-
  How the PM walks a person through what the software factory still needs
  before it can work — the GitHub connection, the product, the repositories —
  one link per remaining step, the login as the approval, and the records
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

## One link per remaining step

For a connector step that is not done, put the link `describe_setup` gave you
inline in your reply, exactly as written, as the one thing to tap. The login
is the approval: a workspace admin taps it, authorizes at the vendor, and
comes back connected. Say in one line what connecting it lets the factory do
("read pull requests, checks and deploy runs on the repositories you grant").
If the link is the Connectors page rather than a login, say why in the words
`describe_setup` used (the login is not configured on this deployment, or the
workspace has no source of that kind yet) — that is a fact about the
deployment, and the person should hear it rather than tap a button that
fails.

Only admins can connect a source. Anyone else who taps the link is sent back
to the Connectors page with that said, so the link is safe to offer; say in
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

- No step is described in prose when it can be a link the person taps.
- No credential is asked for in chat, pasted, or stored by you; the login
  stores it, or a person pastes it on the Connectors page.
- Nothing is guessed to fill a gap a connection would answer: an unconnected
  GitHub means "connect it", never a product filed from the workspace's name.

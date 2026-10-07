---
slug: map-the-codebase
name: Mapping the codebase
description: >-
  How the Release seat reads a product's repositories and files its
  architecture: one `repo_read_tree` per repository, a typed graph of the
  components and relationships the trees and manifests actually show, and
  one `draw_architecture` call per product that the platform turns into the
  diagram and summary on the product page. Read when a repository record
  lands, when the daily sweep names a product whose map is stale, or when a
  person asks what a product is made of.
version: 1
---

# Mapping the codebase

A product page should answer "what is this thing made of, and where does it
run" with a picture and a paragraph read from the code, not from anyone's
recollection. The map is a typed graph you hand over; the platform draws it.
You never paint a picture and never write a diagram in a code fence, because
nothing renders one.

## Read every repository on the product, once each

For each repository record on the product, call `repo_read_tree` once with
its `owner/name` and its default branch as the ref. One call returns the
layout — top-level directories with counts, paths to depth three, and the
manifests it found (README, package.json or the language's equivalent,
CLAUDE.md or AGENTS.md, Dockerfile, compose files, workflow names, infra
directories). That is enough for the map. Open an individual file with
`repo_read_file` only when a manifest points at something the map needs and
the tree does not show (a config that names the database, a client that
names the API host).

A repository you cannot read (no credential reach, not in the source's list,
an error) is still on the map: a node with a `note` saying it could not be
read. It is never a guess.

## What is a node, what is an edge

A node is a component that exists in the repositories: a service or API, a
web or mobile app, a worker, a database, a queue, object storage, a shared
package, a piece of infrastructure, or an external system the code plainly
talks to (a payment provider, an identity provider, a vendor API). Its
`kind` is one of those; its `repo` is the `owner/name` it lives in (an
external system has none); its `label` is what the code calls it.

An edge is a relationship something in the repositories shows: a client
that calls an API (a base URL, a generated client), a worker that reads a
queue, a service that reads or writes a database (an ORM config, a schema), a
deploy workflow that puts a service on an environment, a package another
package depends on. Label it with the verb the evidence supports.

Prefer fewer nodes that are true to more that are plausible. Seven to
fourteen nodes is a map a person reads; a node per directory is a tree, not
an architecture. Group nodes by repository with `groups` when the product
spans several.

## File it once, for the product

Call `draw_architecture` once for the product: the graph, a `summary` in
prose of what the system is and how its parts talk (what a new engineer
would want in a paragraph), and `mappedFrom` naming every repository with the
ref you read, so the map says what it was read from. The platform lays the
graph out, files the diagram and the summary as artifacts on the product,
writes the pointers on the record, and the product page shows them. A redraw
is a new version of the same artifact: nothing to clean up.

If the tool refuses the graph (an edge naming a node that does not exist, too
many nodes), fix the graph and call it again; its message says what to fix.

## Report in two lines

The product mapped and from which repositories, and anything you could not
establish. No description of the diagram — the person can open it.

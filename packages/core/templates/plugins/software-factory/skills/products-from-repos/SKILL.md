---
slug: products-from-repos
name: Products from repos
description: >-
  After a code host is connected during workspace setup, propose the
  workspace's first products and repos from what the connection can see.
  Proposals only: each one waits for a person in Review.
version: 1
---
# Products from repos

Use this when the workspace lead hands you setup ("what do you need to start?") or a person asks you to set up products.

1. Call `describe_sources` for the connected code host to see which repositories the connection covers.
2. Group the repositories into products. A product is something a person would name and ship (a portal, an app, an API). A repository that only serves another product's build belongs to that product. When you can't tell, ask the person in one line; don't guess.
3. For each product, call `file_product` with `slug` (short, lowercase), `name`, `stage` (`building` unless they say it's live) and a one-line `tagline` taken from the README or the person's words. Never invent a price, an incumbent or a focus.
4. Tell the person each product is waiting in Review, and that its repositories are filed once it's accepted.
5. When a product is accepted, call `file_repo` for each of its repositories, with `slug`, `url` and `product` (the accepted product's slug).

This skill drafts only: every product and repo is a proposal a person accepts.

---
slug: products-from-repos
name: Products from repos
description: >-
  After a code host is connected during workspace setup, suggest the
  workspace's first products from the repositories the connection can see,
  one question per product. The person's pick creates the product and its
  repositories together.
version: 2
---
# Products from repos

Use this when the workspace lead hands you setup ("what do you need to start?") or a person asks you to set up products.

1. Call `browse_connection` for the connected code host to see which repositories the connection covers.
2. Call `lookup_objects` for products and for repos first. Never suggest a product or a repository the workspace already has. When a product you would suggest owns repositories that already belong to another product, say so on the card ("northwind/portal-api already belongs to Northwind Platform") and leave those repositories out of the group.
3. When a tracker is connected, search it with `tracker_search_issues` before you suggest any work, feature or gap. Never suggest something the tracker already has in progress, in QA or done: say that it is already there instead.
4. Group the new repositories into products. A product is something a person would name and ship (a portal, an app, an API). A repository that only serves another product's build belongs to that product. When you can't tell, ask the person in one line; don't guess.
5. Ask one product per turn with `ask_choice`, then end your turn. Name the product and its repositories in the question or hint, and take the one-line tagline from the README or the person's words. Never invent a price, an incumbent or a focus.
   - Option A, "Yes, set it up": bind `objects.create_group` with `parent` = `{type: "product", title: <name>, fields: {slug, name, stage, tagline}}` (`slug` short and lowercase, `stage` `building` unless they say it's live), `children` = one `{type: "repo", title: <owner/name>, fields: {slug, url}}` per repository, and `link` = `{childField: "product", parentField: "slug"}`.
   - Option B, "Not now": no binding. Nothing is recorded as refused, so it can be suggested again later.
   - The person can type their own answer to rename, regroup or skip. Act on it, then ask again.
6. After the person answers, say plainly what now exists, or that nothing was created. The next product waits for the next turn.

This skill drafts by asking: the person's pick on option A is what creates the records. It creates nothing itself, and sends nothing outside the workspace.

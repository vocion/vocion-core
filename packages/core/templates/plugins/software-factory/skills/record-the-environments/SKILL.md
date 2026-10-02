---
slug: record-the-environments
name: Record the environments
description: >-
  During workspace setup, record where a product runs for testing and how QA
  signs in, so the factory's first shipped change comes back with a screenshot.
  The QA password is pasted on the Developers page, never typed in chat.
version: 2
---
# Record the environments

Use this in the setup `grow` step once a product exists, or when a person says where it runs. It is its own job, apart from `products-from-repos`: that skill creates products and repos, this one says where a product can be seen and signed into.

For each product that has no environment yet (`lookup_objects`, type `environment`), one turn at a time:

1. Call `offer_connection` with `connector` = `app-login`. It shows a "Connect App sign-in" card that opens the Developers page, where the person pastes the QA account's sign-in page, email and password, then returns to this chat. Never ask for a password, token or key in chat, and never repeat one back. If a person pastes one anyway, say it is not saved and ask them to use the card instead. End your turn.
2. Ask one `ask_choice`: `Where does <product> run for testing?` Options come from what you can read now: the product's repos and any environments from `lookup_objects` (homepage and url fields), plus `Type your own`. When `browse_connection` is available, add the deployment URLs it returns. End your turn.
3. Ask one confirm card:
   - Option A, `Save <url> as <product>'s <stage> environment`: bind `objects.create_group` with `parent` = the existing product (`{type: "product", title: <name>, fields: {slug}}`), and one child `{type: "environment", title: <product>-<surface>-<stage>, fields: {slug, surface, stage, url}}`. `stage` is `staging` unless they say it is live (`production`). Link `{childField: "product", parentField: "slug"}`. Do not put a credential id on the child.
   - Option B, `That's not right`: no binding. Ask again.
4. Say plainly what now exists, or that nothing was created.

QA signs in with the stored `app-login` credential: when the environment names none, the workspace's only live one is used. If two are stored, none is used until one is named on the environment, so say so and ask which one.

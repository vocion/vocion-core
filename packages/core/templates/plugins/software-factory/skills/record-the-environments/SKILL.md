---
slug: record-the-environments
name: Record the environments
description: >-
  During workspace setup, record where a product runs for testing and how QA
  signs in, so the factory's first shipped change comes back with a screenshot.
  The QA password is pasted on the Connectors page, never typed in chat.
version: 1
---
# Record the environments

Use this in the setup `grow` step once a product exists, or when a person says where it runs. It is its own job, apart from `products-from-repos`: that skill creates products and repos, this one says where a product can be seen and signed into.

For each product that has no environment yet (`lookup_objects`, type `environment`), one turn at a time:

1. Call `offer_connection` for `app-login`, so the QA sign-in is pasted on the Connectors page. Never ask for a password, token or key in chat, and never repeat one back. If a person pastes one anyway, say it is not saved and ask them to use the Connectors page instead.
2. Ask one `ask_choice`: `Where does <product> run for testing?` Options come from what is known: repository homepages and deployment URLs `browse_connection` returns. Add `Type your own`. End your turn.
3. When the sign-in is saved and the URL is chosen, ask one confirm card:
   - Option A, `Save <url> as <product>'s <stage> environment`: bind `objects.create_group` with `parent` = the existing product (`{type: "product", title: <name>, fields: {slug}}`), and one child `{type: "environment", title: <product>-<surface>-<stage>, fields: {slug, surface, stage, url, qaLoginCredentialId}}`. `stage` is `staging` unless they say it is live (`production`). `qaLoginCredentialId` is the id of the newest live `app-login` credential. Link `{childField: "product", parentField: "slug"}`.
   - Option B, `That's not right`: no binding. Ask again.
4. Say plainly what now exists, or that nothing was created.

QA signs in with the credential this record names: the factory reads `qaLoginCredentialId` from the environment, so without it the first change comes back without a screenshot.

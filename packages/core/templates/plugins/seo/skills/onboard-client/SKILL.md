---
slug: onboard-client
name: Onboarding a client from their website
description: >-
  A client's site URL becomes a project the whole team writes from: voice and
  tone, services, audience, competitors, the content already on the site, the
  rules a writer must follow, the brand, and the guideline documents filed at
  three stars. Asks for what it could not find instead of inventing it. Read
  before opening a project for a new client.
version: 1
---

# Onboarding a client from their website

The project is where everything a writer needs about this client lives, so
nothing depends on who happens to remember it. One project per client. If the
client already has one (`list_projects`), update it; never open a second.

## 1. Read the site

- `crawl_site` the URL (the home page, the service or product pages, the
  about page, the blog index and three or four recent posts). On a
  Squarespace or WordPress site the public blog feed is usually readable.
- `brand_lookup` the domain for the logo, colours and tagline.

## 2. Open the project and write what you found

`create_project` with the client's name,
its domain in `domains`, and an anchor of type `client`. Then
`update_project`:

- **rules** (`add_rules`), one line each, every one something a writer can
  check a draft against: words the client uses and never uses, how they refer
  to themselves, claims they may not make, the call to action, spelling
  (US/UK), reading level, what to link to.
- **notes** (the client wiki), in sections: *Voice and tone* (three adjectives
  and two sentences quoted from their site that show it), *Services*,
  *Audience*, *Competitors* (the domains that rank beside them),
  *Content inventory* (existing pages and posts by topic, with URLs, so new
  pages link to them and never duplicate them).
- **brand**: the logo found by `brand_lookup`.

Every fact in the notes links the page it came from and the date you read it.

## 3. Ask for what you could not find

Brand guidelines, a style guide, a list of forbidden claims, the people who
sign off: if the site does not show them, ask the person for them in one
message, naming exactly what is missing. When they send a document, file it
to the project at three stars (`file_to_project`, rating 3), because three
stars means "read this before writing anything".

## 4. Where pages publish

If the person names the site's repository or platform, record it on the
project as a publish target, and say which kinds the workspace can publish to
today.

## Done when

The project has rules a writer can check against, notes with voice,
services, audience, competitors and the content inventory, and a list of what
is still missing, said to the person.

---
slug: onboard-client
name: Onboarding a client from their website
description: >-
  A client's site URL becomes a project the whole team writes from: the whole
  site inventoried from its sitemap, the client's voice as sourced lines,
  rules taken from every do and don't in their guides, competitors read from
  Google, services, audience, the content already on the site, and the brand.
  Asks for what it could not find instead of inventing it. Read before opening
  a project for a new client.
version: 3
---

# Onboarding a client from their website

The project is where everything a writer needs about this client lives, so
nothing depends on who happens to remember it. One project per client. If the
client already has one (`list_projects`), update it; never open a second.

## 1. Open the project

`create_project` with the client's name and nothing else in the title
("Northwind Home Services", never "Northwind Home Services — SEO"): a project
is the client, worked from every app, and what SEO is doing for them lives in
the SEO app's batches and pages. Spell the name the way the client writes it
on their own site, and use that one spelling everywhere after: the anchor's
label (the entity), working files, notes. Its domain goes in `domains`, and
the anchor is of type `client` with the project's name as its label.

## 2. Read the whole site

- `site_inventory` with the project. It reads the site's sitemap (then the
  sitemaps robots.txt names, then a crawl), every page's status, title, meta
  description, H1, canonical, noindex, word count and schema, and files a
  dated inventory on the project, filed as one of its sources. If it says it
  hit its cap, say so and offer to read the rest. If it fell back to a crawl,
  say pages nothing links to may be missing. The inventory is the content
  inventory, every blog post included: never wait on the site's repository
  (GitHub) for it, and never put "waiting on GitHub" in the status.
- Then read the pages that carry the voice and the offer, filing each as a
  source as you read it: `file_to_project` with `url`, kind `page` (it reads
  the page and keeps it with its URL and date). The home, service, product
  and about pages and case studies at ⭐⭐; a style guide or brand page on the
  site at ⭐⭐⭐; three or four recent posts at ⭐. Then the writer can open
  every page the voice and rules were taken from.
- The site's author pages (an `/author/` or team page, a byline on recent
  posts): `update_project` with `authors`, each with name, title, author
  page and the topics they write on, and one marked `default` (the byline a
  page gets when no one's topics fit). If the site names no one, say so in
  what is missing; pages are planned without a byline until a person names
  one.
- `brand_lookup` the domain with `project_id`: the colours, fonts and name
  are kept on the project's brand and the logo is fetched onto it, so its
  Brand & guidelines show them. The wiki links there; it does not copy them.

## 3. Competitors from Google, never from memory

- Pick 5 to 10 searches a customer makes for the client's core services, in
  their words. Where the business serves a place, add the city ("roof repair
  Springfield"), and pass the place as `location`.
- `serp_search` each one and keep every `serpResultId`.
- `record_competitors` with the project and all the ids. Code counts them: a
  domain that ranks for two or more searches is a competitor; directories,
  marketplaces and the client's own domains are left out. It records each one
  on the project with the searches it ranked for. Name only those.

## 4. Turn every guide into rules

For each guideline document the client has (a brand guide, a style guide, a
list of claims they may not make):

1. File it at three stars (`file_to_project`, rating 3; an upload by its
   `artifact_id`, pasted text as `text`), because three stars means "read
   this before writing anything". `read_project` then prints its text.
2. Read it whole (`read_project` with `source`), and turn **every** do and
   don't line into a rule: `update_project` with `add_rules` (one line each,
   something a writer can check a draft against) and `rules_source` set to
   the guide's source id, so each rule cites the guide.

The site's own pages give rules too: how they refer to themselves, the call
to action, what to link to. Cite the page URL as `rules_source`.

## 5. The client voice block

`update_project` with `voice`, every line citing the page or source id it was
read from. A line you cannot source, leave out.

- `point_of_view`: who speaks to whom ("we, to you").
- `reading_level`: as the pages read ("plain, short sentences, grade 7").
- `spelling`: US or UK.
- `tone`: three to five words, each shown by a sentence on the site.
- `banned_phrases`: words and phrases the client never uses, exactly as they
  would appear. A draft that has one is sent back in code.
- `preferred_ctas`: the calls to action, word for word.
- `never_claim`: claims they may not make, each with the `phrases` a draft
  making it would use ("guaranteed", "#1", "licensed in"). Checked in code.

## 6. The notes (the client wiki)

`update_project` notes, in sections: *Services*, *Audience*, *Content
inventory* (the inventory's pages by topic, with URLs, so new pages link to
them and never duplicate them). Every fact links the page it came from and
the date you read it. Competitors and the voice are on the project already;
do not restate them.

## 7. Ask for what you could not find

Brand guidelines, a style guide, a list of forbidden claims, the people who
sign off: if the site does not show them, ask the person for them in one
message, naming exactly what is missing. When they send one, do step 4 for it.

## 8. Where pages publish

If the person names the site's repository or platform, record it on the
project as a publish target, and say which kinds the workspace can publish to
today. A repository that is private or not connected yet is one line in what
is still missing; it blocks publishing only, never onboarding.

## Done when

The project is named after the client and has the site inventory, its
authors when the site names them, and the
pages read as sources, the brand read off the site, a sourced voice block,
rules citing the guides and pages they came from, competitors read from
Google, notes with services, audience and the content inventory, and a list
of what is still missing, said to the person.

---
slug: feedback-to-wiki
name: Routing feedback to where it belongs
description: >-
  Every note a person gives on an SEO page is recorded on the page and filed
  where it will be read next time: the page's own client project for what is
  true of this client, the seo-feedback learning step for craft that holds
  for every client. The page says where each note went, and the filing is
  checked. Read whenever a person revises, comments on or corrects a page.
version: 2
---

# Routing feedback to where it belongs

Feedback that stays in one conversation is given twice. The project's gate
holds new drafts, in every batch of that client, until every note on a
sent-back page is verifiably filed.

## 1. Record it on the page

A sign-off answered with Revise records its note on the page on its own. A
note given in words: `seo_record_feedback` with the page and the person's
words (and `requests_changes: true` when they asked for changes).

## 2. Decide its scope

- **client**: true of this client only. Their terminology, a claim they
  never make, how they want their services described.
- **general**: craft that would hold for any client. How to open a page, how
  to write a meta description, how many internal links.

When it is unclear, propose one and say why in a line; the person corrects
you if you are wrong.

## 3. File it — to the page's own project, or the learning step

The page names its project (`projectId`). That project, never the one on
screen and never another client's.

- client: `update_project` with `project_id` set to the page's project. A
  checkable rule goes in `add_rules`; anything longer goes in `append_notes`
  (the client wiki). Then `seo_record_feedback` with `filed_to:
  project:<that id>` and `filed_text`: the rule line or passage exactly as
  you filed it. The tool checks the words are on that project, and refuses
  when they are not.
- general: `seo_record_feedback` with `filed_to: learning:seo-feedback` and
  the rule as `filed_text`. The tool files it as a candidate rule a person
  adopts at /dashboard/learnings; once adopted it mounts for the writer and
  the editor before the next page. A client's note can go this way too
  (scope `client`): it is tagged with the project and, once adopted, reaches
  only that client's pages.

There is no wiki page for SEO craft: the learning step is the one place the
writer and the editor read it from.

## 4. Say where it went

Tell the person in one line where each note went, with the link: the project,
or the candidate waiting for them to adopt.

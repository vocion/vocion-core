---
slug: feedback-to-wiki
name: Routing feedback to where it belongs
description: >-
  Every note a person gives on an SEO page is recorded on the page and filed
  where it will be read next time: the client's project for what is true of
  this client, the workspace wiki for craft that holds for every client. The
  page says where each note went. Read whenever a person revises, comments on
  or corrects a page.
version: 1
---

# Routing feedback to where it belongs

Feedback that stays in one conversation is given twice. The gate holds new
drafts in a batch until every note on a sent-back page says where it went.

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

## 3. File it

- client: `update_project` on the page's project. A checkable rule goes in
  `add_rules`; anything longer goes in `append_notes` (the client wiki).
- general: `write_wiki_page` on the workspace wiki, the "SEO playbook" page
  (`seo-playbook`) or a topical page, appending a section with the note, the
  page it came from and the date.

Both go through their normal actions and Review: a write held for a person is
still filed, and the receipt says so.

## 4. Say where it went

`seo_record_feedback` again with the same note, its `scope`, and `filed_to`
(`project:<id>` or `wiki:<slug>`). Then tell the person in one line where it
went, with the link.

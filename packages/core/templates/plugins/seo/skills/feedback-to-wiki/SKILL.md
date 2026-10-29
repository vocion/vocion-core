---
slug: feedback-to-wiki
name: Routing feedback to where it belongs
description: >-
  Every note a person gives on an SEO page is recorded on the page and filed
  where it will be read next time: the page's own client project for what is
  true of this client, a proposed edit to one of the agency's playbooks for
  how we work on every client, the seo-feedback learning step for a one-line
  rule. The page says where each note went, and the filing is checked. Read
  whenever a person revises, comments on or corrects a page.
version: 3
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

## 3. File it: the project, a playbook, or a rule

The page names its project (`projectId`). That project, never the one on
screen and never another client's.

- **client** → the project. `update_project` with `project_id` set to the
  page's project. A checkable rule goes in `add_rules`; anything longer goes
  in `append_notes` (the client wiki). Then `seo_record_feedback` with
  `filed_to: project:<that id>` and `filed_text`: the rule line or passage
  exactly as you filed it. The tool checks the words are on that project, and
  refuses when they are not. A client's note never touches a playbook.
- **general, and it changes how we work** → a playbook edit. The note adds or
  corrects a step, a check, a threshold or a method that one of the agency's
  playbooks covers (`/playbooks/`: how-we-brief-a-page,
  location-pages-without-doorways, sourcing-and-claims, on-page-checklist,
  internal-linking). `read_playbook` that playbook, make the smallest edit
  that says it, in the playbook's own section and voice, and keep everything
  else byte for byte. Then `seo_record_feedback` with `filed_to:
  playbook:<slug>`, `filed_text` (the words you added or changed, exactly as
  they read in the new text) and `playbook_md` (the whole SKILL.md after the
  edit). The tool proposes the change: a person approves the diff in Review,
  and from then on every brief, draft and review reads it. Waiting for that
  decision counts as filed; a change the person leaves as it is does not.
- **general, and it is one line** → a rule. A single sentence a draft can be
  checked against, that no playbook section is about ("never open with a
  question", "spell out numbers under ten"): `seo_record_feedback` with
  `filed_to: learning:seo-feedback` and the rule as `filed_text`. The tool
  files it as a candidate rule a person adopts at /dashboard/learnings; once
  adopted it mounts for the writer and the editor before the next page.

When a one-line note contradicts or narrows what a playbook says, it is a
playbook edit: a rule that argues with a playbook leaves two places to read.

## 4. Say where it went

Tell the person in one line where each note went, with the link: the project,
the playbook change waiting for their approval, or the candidate waiting for
them to adopt.

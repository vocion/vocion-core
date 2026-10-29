---
slug: ai-prompts
name: Tracking a client in AI answers
description: >-
  The questions buyers ask AI assistants about a client's category, kept in
  the client's Prompts register by group, with whether the client is named
  or cited in the answers and who is instead; imported from and exported to
  Ahrefs Brand Radar. Read before proposing prompts, or when a person drops
  a Brand Radar export.
version: 1
---

# Tracking a client in AI answers

A client who wants to be named in AI answers (the "Named in AI answers" goal
on its SEO profile) needs two things: the questions its buyers ask, tracked,
and pages worth citing for them. This skill is the first.

## 1. Read what is tracked

`seo_list_prompts` with the project, so nothing is proposed twice.

## 2. Propose prompts, by group

Five groups, a few prompts each, in the buyer's words, never the client's:

- **category**: "best invoicing software for agencies"
- **shortlist**: "alternatives to Ledgerly for small studios"
- **problem**: "how do I stop chasing late client payments"
- **comparison**: "Tally Books vs Ledgerly"
- **brand**: "is Tally Books good for freelancers"

Read the client's profile (offering, audience, competitors) and keywords
register (`seo_list_keywords`) for the words buyers use.

## 3. Save them in the same turn

`seo_save_prompts` with every prompt you propose, its group, intent, the
platforms to track (ChatGPT, AI Overviews and Perplexity unless the person
says otherwise) and why. A prompt only in chat or in an artifact is lost:
the register is where the team and the next run read it.

## 4. Import and export

- A person drops an Ahrefs Brand Radar export: `seo_import_prompts` with the
  file's artifact id. Say which columns it read and which it left out, and how
  many prompts the client is mentioned or cited on. Never restate mention data
  that was not in the file.
- To track them in Brand Radar: `seo_export_prompts` gives a CSV whose first
  column is the prompt. Brand Radar's custom prompts take it.

## 5. What next

Prompts the client is not named for are where pages worth citing go: a plain
answer up front, sourced facts and numbers, an FAQ. Plan them like any other
page (`seo_plan_batch`), one page per prompt or cluster of prompts.

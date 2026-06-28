# Create a release blog post

Posts live in `vocion-www/posts/` as `YYYY-MM-DD-<slug>.md`. The date prefix sorts on disk; the
slug is the URL segment. `listPosts()` (`vocion-www/src/libs/blog.ts`) discovers them; `/blog`
lists all, `/changelog` lists those tagged `release`.

## Frontmatter (exact fields)

```yaml
---
title: 'Short, benefit-led title'
description: '1–2 sentences. Leads with the version + what shipped. Used on listings + SEO.'
date: 2026-06-28 # YYYY-MM-DD (overrides the filename date)
author: Vocion Team
tags: [release, agent, tools] # MUST include `release` for a release post
related_version: vocion-v0.6.0 # the tag this post documents → renders as a pill
# hero_image: /assets/blog/<slug>.png   # optional
---
```

## Body shape

- Open with the problem the release solves (1 short paragraph), not a feature list.
- `## What's new` — bullets, user-facing.
- A small table for options/providers when relevant.
- `## Where to find it` — link the app surface + docs (`/docs/docs/concepts/<x>`, `/docs/docs/guides/<x>`).
- `## Get it` — how to pull the version / what keys to set.

## Rules

- Always set `related_version` and include `release` in `tags`, or `/changelog` won't show it.
- Don't use `Date.now()`/`new Date()` to compute the date — write it literally in frontmatter.
- Keep the slug stable; it's the permalink.

---
slug: on-page-checklist
name: On-page checklist
description: >-
  The on-page checks every SEO draft passes before a person sees it: title and
  meta description lengths, one H1, a heading outline that reads, alt text,
  canonical and indexability, internal links, schema and readability. The
  editor reviews against it; the writer checks it before saving.
version: 1
---

# On-page checklist

Some of these are checked in code before a draft is saved (`seo_save_draft`:
meta lengths and the slug). The rest are the editor's. A failed item is a
`fix` that quotes the line it is about.

## Title and meta

- [ ] Meta title at most 60 characters (code refuses longer and warns from 55),
      unique on the site, the main phrase near the front, the brand last when
      it fits, no repeated keywords.
- [ ] The title and the H1 say the same thing in different words. A title far
      from the page's content is one Google rewrites.
- [ ] Meta description at most 155 characters, unique, specific to this page,
      written as the reason to click (what the reader gets, from whom, where).
- [ ] Slug short, lowercase, hyphenated, no dates. A refresh keeps its live
      URL: a ranking URL is never changed without a 301, and we do not change
      it in a draft.

## Headings

- [ ] Exactly one H1, and it answers the query in natural words.
- [ ] The first two sentences under the H1 answer the query.
- [ ] H2s and H3s nest in order (no H4 under an H2 for styling), and reading
      only the headings tells the page's story.
- [ ] No heading that exists only to carry a keyword or a city name.

## Images

- [ ] Every meaningful image has alt text that describes what is in it for
      someone who cannot see it ("technician flushing sediment from a 50-gallon
      tank"); decorative images have empty alt; no keyword lists in alt.
- [ ] Descriptive file names, compressed (WebP or AVIF), width and height set.
- [ ] The client's own photos over stock wherever the client has them.

## Canonical and indexability

- [ ] A self-referencing canonical, unless the page is a deliberate duplicate.
      A refresh keeps the canonical it had.
- [ ] Not noindexed, not blocked in robots.txt, and in the sitemap once
      published. Never a noindex together with a canonical to another page.

## Links

- [ ] Internal links as the internal-linking playbook says: 3 to 6 in the body,
      descriptive anchors, the supported service page linked where the reader
      decides, every target a live URL (status 200, no redirect).
- [ ] External links go to the sources the claims cite. Paid or affiliate
      links carry `rel="sponsored"`.
- [ ] Phone numbers are tappable (`tel:`) and match the NAP.

## Schema

- [ ] The types the brief named, valid in Google's Rich Results Test, and
      describing only what is visible on the page.
- [ ] No `HowTo`, and no review or rating markup about the client itself.

## Readability

- [ ] The client's reading level from its voice block; otherwise aim for a
      general reader: most sentences under 20 words, paragraphs of four lines
      or fewer.
- [ ] Steps as numbered lists, comparisons as tables, jargon defined at first
      use.
- [ ] One clear next step in the client's own call to action.

## Page experience

The draft cannot be measured for Core Web Vitals (LCP within 2.5 s, INP within
200 ms, CLS within 0.1), but the editor flags what will hurt them: a video or
map embed above the fold, a hero image with no dimensions, a carousel.

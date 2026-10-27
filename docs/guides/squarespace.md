# Squarespace

**In short.** Connect a client's Squarespace site with the email and password of
an account that can edit it. Vocion reads what is on the site through its public
pages, and publishes a new blog post by signing in to the site's editor in a
browser run. It saves a draft first and asks before the post goes live.

## Why it signs in instead of using an API

Squarespace has no API for pages or posts. Its developer API key reads the
site's identity (`GET https://api.squarespace.com/1.0/authorization/website`:
id, title, URL, time zone) and Commerce; every content path answers a generic
500. Its OAuth is for Commerce partners and opens no content either. So:

| What | How |
|---|---|
| Which site | The developer API key, when given, names the site it was made on; Test connection checks it is the site you entered. Optional. |
| What is on it | The public `?format=json` twin every Squarespace page has. The sync is the web connector's own read (`libs/sources/web.ts` recognises a Squarespace page and reads its JSON listing), seeded at the site and its blog: pages and posts, with their links. |
| Publishing | A browser run signs in to the editor with the stored login and writes the post. |

The connect card says it plainly: "Squarespace has no API for posts, so Vocion
publishes by signing in to your site's editor. It saves a draft first and asks
before it goes live."

## Connecting

1. **Connectors → Squarespace.** Enter the site's address
   (`https://example-site.squarespace.com`, or its own domain) and the blog's
   path (`/blog`, `/journal`).
2. Paste the **editor login**: the email and password of a Squarespace account
   that is a contributor on the site (Content Editor or Administrator). The
   password is kept in the vault as a secret; a browser run types it, and the
   model driving the browser only ever sees `{{password}}`.
3. Optionally, a **developer API key** from the site (Settings → Advanced →
   Developer API Keys), so Test connection names the site.

One login serves every site the account can edit, so one credential per
workspace covers an agency's clients. Accounts with two-step verification: the
run stops and asks the person for the code.

**Test connection** reads the site's public JSON (its title and address), the
blog (how many posts are published), the key's site when there is one, and
whether a login is stored. It does not try the login: the first publish does.

## Publishing a page

The Project names the site as a publish target:

```yaml
publishTargets:
  - id: blog
    kind: squarespace
    config:
      siteUrl: https://example-site.squarespace.com
      blogPath: /journal
```

`site.publish_page` (`{ pageRecordId }`; the explicit `{ projectId,
publishTargetId, artifactId, slug, title, metaDescription }` only for a project
whose pages the SEO app does not track) always waits for a person's decision on
its card, a word in chat included (`requiresReviewDecision`). It publishes only
a page whose sign-off covers the draft as it stands: the same artifact, and the
same version when the sign-off records one. The page's own `metaTitle`,
`metaDescription` and `slug` fill the SEO fields; a trailing "Meta title / Meta
description / Slug" block left in the body is kept off the page. A location,
service or landing page is refused on a Squarespace target, which takes blog
posts only. A post already live at the page's slug that is not this page's is
never overwritten or claimed.

1. **The draft** (`site.publish_page`). Approving the card starts a browser
   run in the approver's browser, or queues it behind their other publish runs
   (one at a time, oldest first, started by the job that follows them). The
   engine enforces what the approval covers (`DRAFT_APPROVED_AHEAD` in
   `services/publish/squarespaceTask.ts`): starting a post (**Add blog post**),
   and Save only while the editor shows the post as `Post · Draft`, read off
   the page at the click. Any click or choice naming Publish or Schedule, the
   status menu's Published included, waits for the person whatever its role,
   and Save on a post that is not a draft waits too. The run finds this page's
   own post by its URL slug (signed in, a draft shows at its address), or adds
   one; it never opens another post. It types the title, pastes the article
   into "Write here…" as formatted text (headings and lists kept), sets the
   Excerpt and Post URL (Content) and the SEO title and description (SEO) in
   Blog Post Settings, and presses Save.
2. **Going live** (`site.publish_live`, `{ pageRecordIds }`). One card lists
   the drafted posts; approving it covers each run's Publish click, on its own
   post only (allowed while that post's title is on the page). One run per
   post, in turn.

The `site.publish-settle` job follows each run and reads the post back from
`<siteUrl><blogPath>?format=json` by its slug alone. The page record gets
`squarespaceDraft` once the draft is saved, and `status: published` with
`publishedUrl` once the site lists it live; only then does the publish count on
the SEO team's "Pages published" (`rows: published-pages`). A run that says it
published while the blog does not list the post is recorded as exactly that.

There is no Undo: once saved, the post is the site's. Delete it in the
Squarespace editor if it should go.

## Practice

The practice blog editor (`services/browser/practiceBlog.ts`) is Northwind
Outfitters' site, fictional, served inside the browser: sign in at
`https://site.northwind-outfitters.test/config` with
`editor@northwind-outfitters.example` / `northwind-demo`, then the same Pages
panel, post list, editor (rich-text title and body), Blog Post Settings and Save/PUBLISH the
task text describes. It never touches the network.

## Verified on a live 7.1 site (2026-10-27)

The draft run was run against a real Squarespace 7.1 test site through the
browser-run engine: it saved one draft with its title, its headings as real
`h2`s, its excerpt, Post URL and SEO fields, status Draft, in about four and a
half minutes and 30 steps; the public `?format=json` did not list it. What the
real editor needed, now in core:

- **Add blog post** creates the draft at once, and reads as a consequential
  click ("post"), so it is approved ahead with Save.
- The title and body are rich-text areas named only by CSS placeholders. The
  browser names them by their placeholders before the model reads the page
  (`nameRichEditors`), types into them in one insert, and pastes HTML into
  them as formatted text: no Markdown block is needed.
- Blog Post Settings opens as a dialog drawn at the end of the page. The
  snapshot is centred on an open dialog, or the model never sees it.
- A run whose writes were approved ahead is a whole piece of work, like a
  routine's: 60 steps and 15 minutes.

Still unverified live: the going-live run (its Publish click, held for the
person), and accounts with two-step verification.

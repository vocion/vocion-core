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

`site.publish_page` (`{ pageRecordId }`, or `{ projectId, publishTargetId,
artifactId, slug, title, metaDescription }`) always waits for a person. Its
Review card shows the site and blog, the URL the post will have, the title, the
meta description and the page rendered. Then two browser runs, in the
approver's browser:

1. **The draft.** Approving the card starts it and is the approval for its
   writes: starting a post (Squarespace 7.1's **Add blog post**) and pressing
   Save on a post that stays a draft (an exact list of button names, sealed
   with the run's secrets: `DRAFT_SAVE_WRITES` in
   `services/publish/squarespaceTask.ts`). The run signs in, opens the blog in
   the Pages panel, adds a post (or reopens a draft with the same title, or an
   untitled draft an earlier attempt left), presses Edit, types the title into
   "Enter a post title…", pastes the article into "Write here…" as formatted
   text (headings and lists kept), opens Blog Post Settings from the post's
   name in the top bar and sets the Excerpt and Post URL (Content) and the SEO
   title and description (SEO), and presses Save, never PUBLISH. The article
   reaches the editor as `{{body_html}}`, a secret input the browser pastes, so
   the model reads the editor rather than the whole article on every step.
2. **Going live.** Once the draft is saved, a second run reopens it in the same
   browser and presses Publish. Nothing is approved ahead for it, so the
   browser holds that click for the person, with the draft on screen. Decline,
   or no answer within 30 minutes, leaves the draft.

The `site.publish-settle` job follows both runs, then reads the post back from
`<siteUrl><blogPath>?format=json` and writes on the page record:
`status: published` and `publishedUrl` once the site lists it,
`squarespaceDraftUrl` and the run's link while it is a draft, and the reason
when a run could not finish. A run that says it published but a blog that does
not list the post is recorded as exactly that, never as live.

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

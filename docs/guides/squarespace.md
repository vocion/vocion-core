# Squarespace

**In short.** Connect a client's Squarespace site, then sign in to it once from
your own machine. Vocion reads what is on the site through its public pages,
and publishes a new blog post in the site's editor, in a browser run that
starts from that kept sign-in. It saves a draft first and asks before the post
goes live.

## Why it signs in instead of using an API

Squarespace has no API for pages or posts. Its developer API key reads the
site's identity (`GET https://api.squarespace.com/1.0/authorization/website`:
id, title, URL, time zone) and Commerce; every content path answers a generic
500. Its OAuth is for Commerce partners and opens no content either. So:

| What | How |
|---|---|
| Which site | The developer API key, when given, names the site it was made on; Test connection checks it is the site you entered. Optional. |
| What is on it | The public `?format=json` twin every Squarespace page has. The sync is the web connector's own read (`libs/sources/web.ts` recognises a Squarespace page and reads its JSON listing), seeded at the site and its blog: pages and posts, with their links. |
| Publishing | A browser run opens the editor with the site's kept sign-in (or, failing that, the stored login, once) and writes the post. |

The connect card says it plainly: "Squarespace has no API for posts, so Vocion
publishes by signing in to your site's editor. It saves a draft first and asks
before it goes live."

## Why you sign in from your own machine

Squarespace refuses a password typed by a browser in a data centre. On Vocion
Cloud the publish run typed a correct email and password into
`login.squarespace.com` from the isolated browser container and Squarespace
answered "The username or password is incorrect"; the same login worked from a
laptop. The cookies of that laptop's session, loaded into the cloud browser,
opened the site's editor signed in.

So the one dependable way in is a **kept sign-in**: you sign in where
Squarespace knows you (your own machine, two-step verification included), and
Vocion keeps that browser session on the site's Squarespace connector, sealed
under the workspace's key like a browser run's checkpoint. Only cookies and
site storage for `squarespace.com` are kept; anything else is refused. The
connector shows when it was saved and from where, never the cookies.

Publish runs, the draft and going live alike, load it into their browser
before the first step and are told they start signed in. A run that ends well
saves the refreshed session back, so a sign-in that gets used stays alive.

### Signing in: the operator command

A workspace admin runs this from a checkout of Vocion, on a machine with a
screen (once: `npx playwright install chromium`):

```bash
# VOCION_API_TOKEN is a workspace admin API token: Developers → Create token
# (docs/guides/login-apps.md, "Getting a token"). Keep it out of the command line.
export VOCION_API_TOKEN=vcn_live_…
npm run squarespace:session -- \
  --site https://example-site.squarespace.com \
  --workspace northwind-seo \
  --url https://vocion.example
```

A Chromium window opens at the site's `/config`. Sign in as you always do.
When the editor shows, the window closes, and the session (Squarespace cookies
and site storage only) is sent to `PUT /api/v1/squarespace/session`, which
checks every cookie is for `squarespace.com`, seals it and keeps it on the
workspace's Squarespace connector for that site. `--workspace` (slug or id) is
checked against the token's workspace.

### Signing in: a session file

For an admin who cannot reach the app from the machine they sign in on, add
`--out session.json` instead of `--workspace` and `--url`: the command writes
the session to that file (readable only by you). In the app, open
**Connectors → Squarespace**, edit the connection, open **Advanced** and use
**Upload a session file**; or use **Sign in again** on the connection's row.
Delete the file afterwards: it is a signed-in session.

### When it expires

When Squarespace shows its login page anyway, the run types the stored login
once, if there is one (it may work from some networks). If Squarespace refuses
it, or there is no login to type, the run stops with `sign_in: refused` and:

- the page's publishing reads **"Squarespace needs a fresh sign-in for
  example-site.squarespace.com"**, status Publishing, never failed;
- the connector shows **Needs attention: the site wants a fresh sign-in** with
  **Sign in again**, which shows the command and the upload.

Once a fresh sign-in is kept, by either path, every page that was waiting on it
carries on by itself: its draft or going-live run starts again, as the person
who approved it, under the same approval.

A site with no kept sign-in behaves as before: the run tries the stored
password once.

When a password refusal is reported, the run is told plainly that the real
password was typed. The engine shows any echo of a secret to the model as its
placeholder, `{{password}}`, so before this a refused sign-in was misread as
"the field received the literal text {{password}}".

## Connecting

1. **Connectors → Squarespace.** Enter the site's address
   (`https://example-site.squarespace.com`, or its own domain) and the blog's
   path (`/blog`, `/journal`).
2. Paste the **editor login**: the email and password of a Squarespace account
   that is a contributor on the site (Content Editor or Administrator). The
   password is kept in the vault as a secret; a browser run types it only when
   the kept sign-in is missing or expired, and the model driving the browser
   only ever sees `{{password}}`.
3. **Sign in once** from your own machine (above). Without it, publishing from
   Vocion Cloud usually stops at Squarespace's login page.
4. Optionally, a **developer API key** from the site (Settings → Advanced →
   Developer API Keys), so Test connection names the site.

One login serves every site the account can edit, so one credential per
workspace covers an agency's clients; a kept sign-in is per site, on that
site's connector. Two-step verification is part of signing in on your own
machine; a run that has to type the password stops and asks the person for
the code.

**One client's site, one project.** Put a site's connector in its client's
Project (Manage → **Scope**, or **Connect for this project** on the project's
page) and only that project's pages publish with its kept sign-in and login.
Another project's publish never loads it: the page is refused with "Squarespace
for northwind-home.example is connected for project Northwind Home Services,
not for this work.", and so is saving that site as another project's publish
target (`services/connect/connectionScope.ts`).

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

Verified on Vocion Cloud dev (2026-10-27): the stored password typed from the
browser container was refused; a laptop's session (17 cookies across
`login.squarespace.com`, `.squarespace.com`, `<site>.squarespace.com` and
`.<site>.squarespace.com`) loaded
into a fresh context in the same container opened `<site>/config/pages`
signed in. That is what the kept sign-in does.

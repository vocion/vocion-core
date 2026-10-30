# Webflow

**In short.** Log in with Webflow and pick the client's site. Vocion learns
which of the blog collection's fields takes each part of a page, and you apply
that mapping on the client's project. An approved page is then saved as a
**draft** item in the blog. It goes live only when you approve that on its
own card.

## Connect

On **Connectors → Webflow**, press **Log in with Webflow**. On Webflow's
screen, pick the sites Vocion may reach (one login can cover several clients'
sites). The login asks for:

| Scope | Why |
|---|---|
| `sites:read` | List the sites, and find each one's domain |
| `cms:read` | Read the blog collection's fields and its posts, to learn the mapping and find a post by its slug |
| `cms:write` | Save a draft item, update it, and publish that item when you approve going live |

It never asks for `sites:write`: going live publishes the one item, not the
whole site, so nothing else waiting in the Designer goes out with it.

Webflow's tokens do not expire. To reach another site later, log in again and
pick every site the login should cover.

**Advanced: a site API token.** For a site whose owner will not authorize an
app, generate a token in the site's settings (**Apps & integrations → API
access**) with CMS read and write and Sites read, and paste it under
**Advanced**. It reaches that one site.

When the SEO strategist needs Webflow and it is not connected, it shows the
connect card in chat (`offer_connection` with `webflow`); one tap opens the
same login.

### Setting up the login on a server

Create a Data API (v2) app in Webflow with the scopes above, and set:

```
WEBFLOW_CLIENT_ID=
WEBFLOW_CLIENT_SECRET=
```

The redirect URL is `https://<your host>/api/connect/webflow/callback`.
Without them, the connector offers only the pasted token.

## The publish target

A project publishes to Webflow through a target of `kind: webflow`, under
**Publishing** on the project page:

```json
{
  "id": "blog",
  "kind": "webflow",
  "label": "Northwind blog",
  "config": {
    "siteId": "64f0c0ffee00000000000a01",
    "siteUrl": "https://www.northwind-outfitters.example",
    "collectionId": "64f0c0ffee00000000000b01",
    "collectionPath": "/blog",
    "fields": {
      "body": "post-body",
      "excerpt": "post-summary",
      "metaTitle": "seo-title",
      "metaDescription": "meta-description",
      "author": "author",
      "date": "publish-date",
      "image": "main-image"
    }
  }
}
```

- `fields` maps each part of the page to a collection field, by field slug:
  `body`, `excerpt` (the summary), `metaTitle` and `metaDescription` (the SEO
  title and description), `author`, `date`, `image` (the main image),
  `category` and `tags`. The title always goes in `name` and the slug in
  `slug`. Only `body` is required to publish.
- `collectionPath` and `siteUrl` say where a post lives once live:
  `<siteUrl><collectionPath>/<slug>`.

You don't type this. Save a target with only the site
(`{"id": "blog", "kind": "webflow", "config": {"siteUrl": "https://www.northwind-outfitters.example"}}`),
or let the strategist do it during onboarding (`seo_learn_frontmatter` with
`webflow_site`). Vocion then:

1. finds the site among the ones the login reaches, by id, `webflow.io` name
   or domain;
2. finds the blog: the collection named like one (Blog, Posts, Articles), or
   the one you name;
3. reads the collection's fields and its latest posts, and maps each part of
   the page by the field's type, its name and what a real post holds in it.
   For example, the body goes in the rich text field the posts hold the most
   in.

The result waits under **Publishing** with **Apply** and **Dismiss**, with
notes on anything to check: which of two rich text fields became the body, or
a required field that nothing fills. Vocion never writes the mapping for you.

## Saving the draft (`site.publish_page`)

A signed-off page is proposed as `site.publish_page`. The card shows the
title, meta, the address once live, the fields it fills, and a preview of
the body as Webflow will hold it. Approving it:

- converts the page's markdown to Webflow rich text: headings, paragraphs,
  lists, quotes, links (site paths like `/blog/other-post` are kept), bold,
  italic and code. A `#` heading in the body becomes an `h2`, because the
  title is the post's one `h1`. Webflow's rich text has no tables or rules,
  so a table becomes a list of its rows and a rule is left out. The card says
  so under **Changed for Webflow**. Raw HTML in a draft is escaped, never
  passed through;
- puts images in by URL: each `![alt](https://…)` becomes a figure, and
  Webflow fetches and hosts the image. The page's main image is its own
  `image`, else the first image in the draft;
- fills a reference field (an author or a category in another collection)
  with the item whose name matches. If nothing matches, the field is left
  empty and the card says so;
- refuses before sending anything if Webflow requires a field that the page
  leaves empty;
- saves the item with `isDraft: true`. It is never published here.

**One item per slug.** If the page's own draft item is already at its slug,
or a draft is, Vocion updates that item in place. The same applies to the
live post a refresh names (`existingUrl`, or `refresh: true`). A live post at
the slug that is someone else's is never touched: the card says to choose
another slug.

**Undo** deletes a draft item the save created. An item that was updated in
place is left as it is.

## Going live (`site.publish_live`)

Going live is its own card: `site.publish_live` with the drafted pages. It
is the same card that takes Squarespace drafts live. It always waits for a
person's decision on Review, and it has no Undo, so **Always allow** is never
offered for it. Approving it takes each item out of draft and publishes that
item alone (`POST /v2/collections/:id/items/publish`). The page then records
`published` and its live address.

If Webflow will not publish the item, the post stays a draft and the line
says why. One common reason is a collection the site has never published:
publish the site once in Webflow, then approve going live again.

## Where it lives in the code

| What | Where |
|---|---|
| The login | `libs/connect/providers/webflow.ts` |
| The connector (Test connection lists the sites and their blogs) | `libs/sources/webflow.ts` |
| The API calls | `libs/webflow/api.ts` |
| The target's schema | `libs/publish/targets.ts` (`kind: webflow`) |
| Learning the mapping, and filling a page's item | `libs/publish/webflowMapping.ts`, `services/publish/learnWebflow.ts` |
| Markdown to rich text | `libs/publish/webflowRichText.ts` |
| Draft, update by slug, go live | `services/publish/webflowPublish.ts`, `libs/actions/site-publish-page.ts` |
| Recorded API answers for tests | `libs/fixtures/webflow.ts` |

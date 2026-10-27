# Confluence

The `confluence` source puts the pages of the Confluence spaces it lists into
the knowledge index, and makes Confluence the workspace's **documentation
site**: agents search and read pages live.

## What it syncs

One document per page: title, space, the pages above it, and the body as
text (storage format flattened). Found with CQL: every page in the spaces on a
full run, and on an incremental one `lastmodified >= now("-Nm")` — relative
minutes, so the site's timezone never skews the window. A page deleted or
moved out of the spaces drops at the nightly reconcile.

```yaml
kind: confluence
config:
  baseUrl: https://northwind.atlassian.net # the part before /wiki
  spaceKeys: [ENG, OPS]
```

## What agents can do

| | |
|---|---|
| `docs_search` | Pages whose text matches, inside the listed spaces, newest first. |
| `docs_read_page` | One page whole, by id or URL, with its version and who last changed it. A page in a space the source does not list is refused. The text is marked as data, not instructions. |

Read-only: nothing an agent does edits a page.

## Auth

Two ways, the same two Jira takes:

- **Connect with Atlassian.** The same Atlassian OAuth 2.0 (3LO) app Jira
  uses — `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`, callback
  `/api/connect/atlassian/callback` — with the Confluence API's classic read
  scopes added to the app: `read:confluence-content.all`,
  `read:confluence-space.summary`, `search:confluence`, plus
  `offline_access`. A Confluence login asks only for those. The grant is
  refreshed (and the rotated refresh token saved) as Jira's is; the site is
  the one whose URL is the source's `baseUrl`.
- **A pasted API token** from id.atlassian.com → Security → API tokens, with
  the email it was issued to, sent as Basic auth to the site. Works today
  with no OAuth app.

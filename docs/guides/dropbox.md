# Dropbox

The `dropbox` source puts the files under one Dropbox folder — or the whole
Dropbox — into the knowledge index, and gives agents the **file storage**
live: search, list and read.

## What it syncs

Every file under the folder (`files/list_folder`, recursive). Text, Markdown,
CSV, JSON, HTML and PDF (the `extensions` list) and Paper docs are read whole;
everything else, and anything over 10 MB, is indexed by name and path only.
An incremental run downloads only files modified since the last one; the
nightly full run drops what was deleted.

```yaml
kind: dropbox
config:
  path: /Northwind # blank: the whole Dropbox
```

## What agents can do

| | |
|---|---|
| `files_search` | Files and folders whose name or content matches, inside the folder. |
| `files_list` | A folder's direct contents. |
| `files_read` | One file as text, or what it is and its link when it does not read as text. A file outside the source's folder is refused. |

Read-only.

## Auth

Three ways:

- <a id="connect-with-dropbox"></a>**Connect with Dropbox.** OAuth with
  `token_access_type=offline` and the scopes `account_info.read`,
  `files.metadata.read`, `files.content.read`. Needs a Dropbox app
  (dropbox.com/developers/apps, scoped access) with the redirect URI
  `https://<host>/api/connect/dropbox/callback`, as `DROPBOX_CLIENT_ID` /
  `DROPBOX_CLIENT_SECRET` on the server or a **Dropbox login app** a
  workspace admin saves on Developers. Access tokens last four hours and are
  refreshed and saved for you.
- **A refresh token with its app key and secret**, pasted: exchanged for an
  access token on every run. Works today with no server app.
- **An access token** generated on the app's Settings tab: for a quick test —
  it lasts four hours.

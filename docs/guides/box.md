# Box

The `box` source puts the files under one Box folder — or everything the
account sees — into the knowledge index, and gives agents the **file
storage** live: search, list and read.

## What it syncs

Every file under the folder, walked breadth-first. Text, Markdown, CSV, JSON,
HTML and PDF (the `extensions` list) are read whole; everything else, and
anything over 10 MB, is indexed by name and path only. An incremental run
downloads only files modified since the last one; the nightly full run drops
what was deleted.

```yaml
kind: box
config:
  folderId: '0' # the number at the end of the folder's Box URL; 0 is everything
```

## What agents can do

| | |
|---|---|
| `files_search` | Files and folders whose name or content matches, inside the folder. |
| `files_list` | A folder's direct contents, by folder id. |
| `files_read` | One file as text, or what it is and its link. A file outside the source's folder is refused. |

Read-only.

## Auth

Three ways:

- <a id="connect-with-box"></a>**Connect with Box.** OAuth with
  `root_readonly`. Needs a Box Custom App with User Authentication (OAuth
  2.0) and the redirect URI `https://<host>/api/connect/box/callback`, as
  `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` on the server or a **Box login app**
  a workspace admin saves on Developers. Box rotates the refresh token on
  every refresh; Vocion saves the new one at once.
- **Client Credentials Grant**, pasted: a Custom App with Server
  Authentication (CCG), authorized by a Box admin, its client ID and secret,
  and the enterprise ID (or a user ID, to read as one person). A fresh token
  is minted per run. Works today with no server app.
- **A developer token** from the app's Configuration page: for a quick test —
  it lasts 60 minutes.

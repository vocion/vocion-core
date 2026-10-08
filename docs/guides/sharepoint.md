# SharePoint

Documents from a SharePoint site's library, the twin of Google Drive for a
team site. Setup and permissions: [microsoft-365.md](microsoft-365.md).

- **Settings.** `site`: the site's address as the browser shows it
  (`https://contoso.sharepoint.com/sites/Sales`), the Graph form, or its id;
  blank is the organization's root site. `library`: a document library by name
  (default: the site's own). `folderPath`: one folder inside it (default: all).
  After logging in the person picks the site.
- **Syncs.** Every file under the folder, one document each
  (`sharepoint:<drive>:<item>`). Word, Excel, PowerPoint and the other formats
  Microsoft can render are fetched as PDF and read as text; PDFs and text files
  are read as they are; images and archives are indexed by name and path. Files
  over 25 MB are indexed by name. Incremental runs download only what changed;
  the daily full sync removes deleted files.
- **Tools.** `microsoft_files_search` (Microsoft 365 search over everything the
  account can open, names and contents) and `microsoft_file_read` (one file's
  text, live).
- **Actions.** None; read-only.
- **Auth.** Log in with Microsoft (`Sites.Read.All`, no admin consent where users
  may consent). Test connection opens the site and library.

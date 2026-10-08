# OneDrive

Documents from the logged-in account's OneDrive, the twin of Google Drive.
Setup and permissions: [microsoft-365.md](microsoft-365.md).

- **Settings.** `folderPath`: one folder (`Clients/Northwind`); blank syncs the
  whole drive.
- **Syncs.** As [SharePoint](sharepoint.md) does: Office files rendered to PDF
  by Microsoft and read as text, PDFs and text files as they are, binaries by
  name, one document per file (`onedrive:<drive>:<item>`). Incremental runs
  download only changed files; the daily full sync removes deleted ones.
- **Tools.** `microsoft_files_search` and `microsoft_file_read`, shared with
  SharePoint.
- **Actions.** None; read-only.
- **Auth.** Log in with Microsoft (`Files.Read.All`, no admin consent where users
  may consent). Test connection opens the drive.

# Outlook mail

Mail from the Outlook mailbox of whoever logged in with Microsoft, the twin of
the Gmail connector. Setup and permissions: [microsoft-365.md](microsoft-365.md).

- **Syncs.** One mail folder (`folder`, default `inbox`): subject, sender,
  recipients and Outlook's preview, one document per message, keyed
  `outlook:<id>`. The first sync reaches back `pastDays` (default 90); later
  syncs ask only for mail received since the last one. A daily full sync lets a
  deleted message leave search. Drafts are skipped.
- **Tools.** `outlook_search_mail` searches the mailbox live, the way the
  Outlook search box does. `get_outlook_thread` reads a whole conversation,
  every message's body, by conversation or message id.
- **Actions.** None. The login is read-only (`Mail.Read`); Vocion never sends
  or drafts Outlook mail.
- **Auth.** Log in with Microsoft (`Mail.Read`, no admin consent where users may
  consent). Test connection reads who the login is and counts the folder.

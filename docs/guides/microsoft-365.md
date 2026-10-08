# Microsoft 365 connectors

Five connectors share one Microsoft login: [Outlook mail](outlook-mail.md),
[Outlook Calendar](outlook-calendar.md), [Microsoft Teams](microsoft-teams.md),
[SharePoint](sharepoint.md) and [OneDrive](onedrive.md). They read Microsoft
Graph **delegated**, as the admin who logs in, inside that person's own work or
school tenant. They are the Microsoft 365 twins of Gmail, Google Calendar and
Google Drive.

## How the login works

- **One app.** The connectors run on the multi-tenant Entra app the deployment
  already signs people in with (`AUTH_MICROSOFT_ENTRA_ID_ID`,
  `AUTH_MICROSOFT_ENTRA_ID_SECRET`). A workspace can bring its own app instead,
  on **Developers → Microsoft login app** ([login-apps.md](login-apps.md)): the
  workspace's app first, the server's env second.
- **One connection.** The login is the workspace's `microsoft` credential (one
  live per workspace). Each connector's login asks only for that connector's
  permissions. A refresh asks for `https://graph.microsoft.com/.default`, so
  the token carries every permission consented so far, and the one login serves
  every connector logged in for. Logging in again with the same account
  updates the same credential; logging in with another account replaces it.
- **Refresh.** Microsoft rotates refresh tokens; every sync, tool and action
  saves the new one (`usableLoginGrant`, compare-and-swap).
- **No env set and no workspace app:** the catalog says the login needs an
  admin to configure Microsoft OAuth, and the connectors keep their paste form
  (an Entra app's client ID and secret plus a refresh token it was issued; a
  stopgap that is not renewed).

## Set up the Entra app (once, by the founder or a tenant admin)

In the Entra admin center → **App registrations** → the sign-in app:

1. **Authentication → Web → Redirect URIs.** Add one per deployment, next to
   the sign-in one (`…/api/auth/callback/microsoft-entra-id`):
   `https://<your host>/api/connect/microsoft/callback` for each deployment,
   and `http://localhost:3000/api/connect/microsoft/callback` for local dev.

   The callback is built from `NEXT_PUBLIC_APP_URL`, so it must match it exactly.
2. **API permissions → Add → Microsoft Graph → Delegated.** Add exactly these:

   | Permission | Used by | Admin consent required |
   |---|---|---|
   | `offline_access` | every connector (refresh token) | No |
   | `User.Read` | every connector (who logged in) | No |
   | `Mail.Read` | Outlook mail | No |
   | `Calendars.ReadWrite` | Outlook Calendar (read, and `outlook.create_event`) | No |
   | `Files.Read.All` | OneDrive | No |
   | `Sites.Read.All` | SharePoint | No |
   | `Team.ReadBasic.All` | Teams | No |
   | `Channel.ReadBasic.All` | Teams | No |
   | `ChannelMessage.Read.All` | Teams (channel messages) | **Yes** |
   | `ChannelMessage.Send` | Teams (`msteams.post_message`) | No |
   | `Chat.Read` | Teams (`msteams_read_chat`) | No |

3. **Admin consent.** `ChannelMessage.Read.All` always needs a tenant admin's
   consent, so in each customer tenant an admin either logs in for Teams
   themselves or presses **Grant admin consent** for the app. Many tenants also
   turn user consent off entirely; there, every Microsoft 365 login needs an
   admin's consent first. The other connectors need none where users may
   consent.

The app must be **multi-tenant** ("Accounts in any organizational directory").
The login uses the `organizations` endpoint: work and school accounts only.

## What each connector holds

| Connector | Syncs | Read tools | Actions |
|---|---|---|---|
| `outlook-mail` | one folder's messages (subject, sender, preview) | `outlook_search_mail`, `get_outlook_thread` | none |
| `outlook-calendar` | a rolling window of events | `calendar_events` (shared with Google) | `outlook.create_event` (Undo deletes it) |
| `microsoft-teams` | channel threads with their replies | `msteams_list_channels`, `msteams_read_channel`, `msteams_read_chat` | `msteams.post_message` (no Undo) |
| `sharepoint` | a site library's documents | `microsoft_files_search`, `microsoft_file_read` | none |
| `onedrive` | the person's OneDrive documents | `microsoft_files_search`, `microsoft_file_read` | none |

Code: `libs/connect/providers/microsoft.ts` (login), `libs/microsoft/graph.ts`
(token, throttling, paging), `libs/sources/{outlookMail,outlookCalendar,teams,microsoftFiles}.ts`,
`services/agents/tools/microsoft365.ts`, `libs/actions/{msteams-post-message,outlook-create-event}.ts`.

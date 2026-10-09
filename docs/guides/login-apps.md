# Setting up vendor logins

**TL;DR.** A "Connect with Google" (or Slack, HubSpot…) button only appears
once there is an app to log in with: a client ID and secret you create at the
vendor. Put them in the server's env, or have a workspace admin save them as
the workspace's own **login app** on the Developers page, which needs no
redeploy. This guide says how, per vendor. How the login itself works is in
[connect.md](connect.md). Signing **in to Vocion** with Google or Microsoft is
a different client with its own settings:
[sign-in-with-google-or-microsoft.md](sign-in-with-google-or-microsoft.md).

## The three things every vendor needs

1. **An app at the vendor.** You create it once per deployment, in the vendor's
   developer console. It gives you a client ID and a client secret.
2. **The callback URL registered on that app**, exactly:
   `<NEXT_PUBLIC_APP_URL>/api/connect/<provider>/callback`. The vendor refuses
   any other address.
3. **The two values, in one of two places**: the server's env, under the names
   in the table below, or the workspace's login app on Developers
   ([below](#saving-the-app-on-developers-no-redeploy)). With neither, the
   button is not offered and the connector keeps its paste form.

| Provider | Connectors it serves | Env vars | Setup |
|---|---|---|---|
| `google` | `gmail`, `drive`, `google-calendar`, `ga4` | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | [Google](#google) |
| `hubspot` | `hubspot` | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | [HubSpot](#hubspot) |
| `notion` | `notion` | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` | [Notion](#notion) |
| `zoom` | `zoom` | `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | [Zoom](#zoom) |
| `apollo` | `apollo` | `APOLLO_CLIENT_ID`, `APOLLO_CLIENT_SECRET` | [Apollo](#apollo) |
| `quickbooks` | `quickbooks` | `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | [QuickBooks](#quickbooks) |
| `xero` | `xero` | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | [Xero](#xero) |
| `gusto` | `gusto` | `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET` | [Gusto](#gusto) |
| `slack` | `slack` | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | [slack.md](slack.md#connecting-the-slack-source-with-a-click) |
| `atlassian` | `jira` | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` | [jira.md](jira.md#connect-with-atlassian) |
| `github` | `github` | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | [github.md](github.md#connect-with-github--the-app-instead-of-a-token) |
| `posthog` | `posthog` | None: PostHog reads our client from `/api/connect-client/posthog` | [posthog.md](posthog.md#connecting-it) |

## Saving the app on Developers (no redeploy)

A workspace admin can save the vendor's app for this workspace alone:

1. Open **Developers**, add a credential, and pick **&lt;Vendor&gt; login app**
   (Google, Slack, Atlassian, HubSpot, Notion, Zoom, Apollo, QuickBooks, Xero or Gusto).
2. The form shows the exact **redirect URL to register** at the vendor, with a
   copy button. Register it on the vendor's app.
3. Paste the **Client ID** and **Client secret**, and save.

The secret is encrypted in the workspace's credential store like any other key,
and is never shown in a list. The login button appears on the Connectors page
and in chat cards straight away.

- **Which app a login uses.** The workspace's login app when it has one, else
  the server's env app.
- **Replacing or removing it.** A workspace holds one login app per vendor, so
  saving a new one replaces the old one. Logins made with the old app can no
  longer be refreshed. Their sync says an admin needs to log in again, and that
  new login runs on the current app.
- **Not available for GitHub or PostHog.** GitHub's login is a GitHub App (an
  app ID, a private key and a webhook the server receives), so it stays in the
  env. PostHog has no secret to save.

## Saving the app through the API (scripts)

A script that sets up a workspace can save the app through the public API
instead of the Developers form. It saves the app only: logging in with the
vendor is still a click on the Connectors page, because the vendor's consent
screen needs a person.

**Getting a token.** An admin opens the Developers page and uses
**Create token**. Every token acts as a workspace admin, so keep it where you
keep other secrets. Send it as `Authorization: Bearer vcn_live_…`. A signed-in
admin session works too. A member's session is refused with 403, as on the
Developers page.

`:provider` is `google`, `slack`, `atlassian`, `hubspot`, `notion`, `zoom`,
`apollo`, `quickbooks`, `xero` or `gusto`. Any other name answers 404.

| Call | What it does |
|---|---|
| `PUT /api/v1/login-apps/:provider` with `{ "clientId", "clientSecret", "name"? }` | Saves the app, replacing the one before. |
| `GET /api/v1/login-apps` | Lists every vendor with `saved`, the app's `name`, `keyHint`, `savedAt` and `redirectUrl`. |
| `DELETE /api/v1/login-apps/:provider` | Revokes the app. New logins go back to the server's app, if it has one. Answers `{ "revoked": false }` when none was saved, so running it twice is safe. |

What the `PUT` answer means:

- **`keyHint`** is the client ID, masked to its last few characters, so you can tell which app is saved. No answer ever carries the secret.
- **`redirectUrl`** is the callback to register at the vendor. It is `null` when the server has no public address (`NEXT_PUBLIC_APP_URL` unset).
- **`replaced`** is true when an app was saved before and this one took its place.
- **`loginsNeedLoggingInAgain`** is true only when the client ID changed. Logins made with the old app then stop at their next refresh until an admin logs in again, and `note` says so. Saving a new secret for the same app leaves them working.
- **A 400** names the bad field in `error.details.field`. Blank values get the Developers form's sentence, e.g. "Enter the Client secret."
- **A 409** means another save of the same app kept landing at the same moment. Send yours again.

Send the secret from a file or an environment variable, never typed on the
command line:

```bash
# CLIENT_ID and CLIENT_SECRET are already in the environment, e.g. from your
# secrets manager. jq reads them from there, so the secret is never an argument.
# --fail-with-body makes curl exit non-zero on a 4xx or 5xx and still print why.
jq -n '{clientId: env.CLIENT_ID, clientSecret: env.CLIENT_SECRET}' \
  | curl -sS --fail-with-body -X PUT "$VOCION_URL/api/v1/login-apps/google" \
      -H "Authorization: Bearer $VOCION_TOKEN" -H 'content-type: application/json' --data @-
```

The routes are in
[`app/api/v1/login-apps`](../../packages/core/src/app/api/v1/login-apps/route.ts)
([`:provider`](../../packages/core/src/app/api/v1/login-apps/%5Bprovider%5D/route.ts)),
over [`services/connect/loginApps.ts`](../../packages/core/src/services/connect/loginApps.ts).
A save from the API or from the Developers form goes through the same
`saveLoginApp`, which uses `storePlatformKey` to validate, encrypt, and replace
the old app in one transaction. Every save and revoke writes an audit line
naming who did it. The full schema is in the OpenAPI document at
`/api/v1/openapi`.

## Where the values go

The client secret is a secret. Never commit it, paste it into chat, a ticket
or Slack, or pass it on a command line. There are two places it can go:

- **Developers page (no redeploy).** Add credential, then the vendor's
  **login app** ([above](#saving-the-app-on-developers-no-redeploy)). Use this
  when you can't change the server, or for one workspace's own app.
- **The server's env**, typed straight into the env file in your editor:

  - **Local dev.** `packages/core/.env.local` of the checkout you run. Each git
    worktree has its own `.env.local`, so a worktree needs the values too.
    Restart the dev server afterwards.
  - **Production (AWS host).** `/opt/vocion/infra/aws/.env.production` on the
    host. The `app` and `worker` containers both read that whole file, so one
    edit covers both. Then run `sudo bash /opt/vocion/infra/aws/update.sh`,
    which recreates both with the new values
    ([infra/aws/README.md](../../infra/aws/README.md#updating)).

**Check it worked.** Open **Connectors**, search **All connectors** for a
connector the provider serves and press **Connect**. With the app set, the form offers a login with
the vendor. With it unset, the form offers only the paste fields: check the
login app on Developers, or the env var names and that the server was
restarted.

**Callback URLs, local and live.** The callback uses `NEXT_PUBLIC_APP_URL`, so
a dev server on port 3010 needs
`http://localhost:3010/api/connect/<provider>/callback` registered, and
production needs `https://<your-host>/api/connect/<provider>/callback`. One
vendor app can list both, or keep a separate app for dev.

## What Vocion stores after a login

A login never copies the app's client ID and secret anywhere: an env app
stays in the env, and a workspace login app stays in its own encrypted
Developers row. What the vendor sends back after the person approves is
stored as the login:

- **Where.** One row in the workspace's credential store (`api_token`,
  `obtained_via = login`), encrypted under the workspace's key. It shows on
  **Developers** and can be revoked there like a pasted key. Each source of
  that connector points at it through `api_token_id`.
- **What, for Google.** `accessToken`, `refreshToken`, `expiresAt`, the
  granted `scope`, and the `email` of the Google account that logged in. The
  login is refused, and nothing is stored, if Google sends no refresh token or
  the email cannot be read.
- **Which app it came from.** Each login also records the client ID it ran on
  (`loginClientId`), because a refresh token only works with the app that
  issued it.
- **Refresh.** Access tokens are short-lived. A sync that finds the access
  token expiring uses the refresh token and that same app's client ID and
  secret to get a new one, and saves it back to the same row. So removing an
  app, from the env or from Developers, breaks every existing login made with
  it at its next refresh, not just new ones. Logins made before workspace login
  apps existed record no app and refresh on the server's.

## Google

One Google login serves Gmail, Drive, Calendar and Analytics. Each connector
asks only for its own read scope; a later login for another connector adds
its scope to the earlier ones.

**1. Create a Google Cloud project**, or pick an existing one, at
[console.cloud.google.com](https://console.cloud.google.com).

**2. Turn on the APIs the connectors call** under **APIs & Services →
Library**. Only the ones you will use:

| Connector | API to enable |
|---|---|
| `gmail` | Gmail API |
| `drive` | Google Drive API |
| `google-calendar` | Google Calendar API |
| `ga4` | Google Analytics Data API |

**3. Set up the consent screen** under **Google Auth platform → Branding**
(click **Get Started** if it is not configured yet):

- App name and a support email.
- **Audience.** Internal lets only accounts in your own Google Workspace log
  in. External lets anyone, and while it is in **Testing**, only the accounts
  you list under **Test users**.
- **Data Access → Add or Remove Scopes.** Add the scopes of the connectors you
  enabled, plus `openid` and `email`:

| Connector | Scope |
|---|---|
| `gmail` | `https://www.googleapis.com/auth/gmail.readonly` |
| `drive` | `https://www.googleapis.com/auth/drive.readonly` |
| `google-calendar` | `https://www.googleapis.com/auth/calendar.readonly` |
| `ga4` | `https://www.googleapis.com/auth/analytics.readonly` |

**4. Create the client** under **Google Auth platform → Clients → Create
Client**, type **Web application**. Under **Authorized redirect URIs** add
`<NEXT_PUBLIC_APP_URL>/api/connect/google/callback` for every place you run
(for example `http://localhost:3010/api/connect/google/callback` and the
production URL). Google shows the client ID and secret once you create it.

**5. Save them.** On **Developers**, add a **Google login app** with the
client ID and secret (no redeploy), or put them in the server's env as
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
([Where the values go](#where-the-values-go)).

**Before customers use it.** Gmail and Drive read scopes are restricted:
Google must verify the app, including a security assessment, before accounts
outside your own Workspace can use them. And while an External app is in
**Testing**, Google expires each refresh token after 7 days, so every login
stops working a week later and the person sees "An admin needs to log in with
Google again". Publish the app (**In production**) before customers rely on it.
A workspace's own Google login app needs the same verification and publishing.

**Without a server client.** A source can also hold its own Google client: an
admin pastes a client ID, secret and refresh token into the connector's form.
`npm run google:oauth -- --project <id|slug> --sources gmail` gets that refresh
token through a local consent page; it reads the client from
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in your env, so leave
off its `--client-secret` flag. Its client must allow
`http://localhost:8765/callback` (or the `--port` you pass).

## HubSpot

- **App.** An OAuth app in your HubSpot developer account.
- **Redirect URL.** `<NEXT_PUBLIC_APP_URL>/api/connect/hubspot/callback`.
- **Scopes the app must allow.** `oauth`, `crm.objects.contacts.read`,
  `crm.objects.companies.read`, `crm.objects.deals.read`. Vocion asks for
  exactly these.
- **Save it.** A **HubSpot login app** on Developers, or the env as
  `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`.

Access tokens last 30 minutes; syncs refresh them.

## Notion

- **App.** A **public** integration in Notion's integrations dashboard, with
  read content only. An internal integration has no login; its token is
  pasted instead.
- **Redirect URL.** `<NEXT_PUBLIC_APP_URL>/api/connect/notion/callback`.
- **Save it.** A **Notion login app** on Developers, or the env as
  `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`.

The person picks the pages to share on Notion's consent screen, and that is
what syncs. Notion sends no expiry, so nothing is refreshed.

## Zoom

- **App.** A **General app** (user-managed OAuth) in the Zoom Marketplace.
  This is not the Server-to-Server app whose credentials are pasted today;
  that paste keeps working.
- **Redirect URL.** `<NEXT_PUBLIC_APP_URL>/api/connect/zoom/callback`.
- **Scopes, set on the app.** Zoom takes them from the app, not the login
  URL: `user:read:user`, `cloud_recording:read:list_user_recordings`,
  `cloud_recording:read:list_recording_files`,
  `cloud_recording:read:meeting_transcript`. Add their `:admin` variants too,
  so an admin's login can read every user's recordings.
- **Save it.** A **Zoom login app** on Developers, or the env as
  `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`.

Zoom replaces the refresh token on every refresh and each one lasts 90 days;
Vocion saves the new one each time.

## Apollo

- **App.** A partner OAuth app. Apollo approves partner apps before it issues
  a client ID, so ask early.
- **Redirect URL.** `<NEXT_PUBLIC_APP_URL>/api/connect/apollo/callback`.
- **Scopes.** Vocion asks for `read_user_profile` and `app_scopes`. Confirm
  them against the app Apollo registers.
- **Save it.** A **Apollo login app** on Developers, or the env as
  `APOLLO_CLIENT_ID`, `APOLLO_CLIENT_SECRET`.

Access tokens last 30 days. Apollo replaces both tokens on refresh, and Vocion
saves the new pair.

## QuickBooks

- **App.** An app at the [Intuit Developer portal](https://developer.intuit.com/app/developer/dashboard)
  with the Accounting scope. Its Development keys connect sandbox companies;
  its Production keys connect real ones, after Intuit reviews the app.
- **Redirect URI.** `<NEXT_PUBLIC_APP_URL>/api/connect/quickbooks/callback`,
  on whichever keys you use (Production keys accept `https` only).
- **Scope.** `com.intuit.quickbooks.accounting`, read through the connector
  only: Vocion never writes to the books.
- **Save it.** A **QuickBooks login app** on Developers, or the env as
  `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`.

Access tokens last an hour. Intuit may replace the refresh token on a refresh,
and the old one then stops working; Vocion saves the new one each time. One
login is one company. More in [quickbooks.md](quickbooks.md).

## Xero

- **App.** A **Web app** at [developer.xero.com](https://developer.xero.com/app/manage).
- **Redirect URI.** `<NEXT_PUBLIC_APP_URL>/api/connect/xero/callback`.
- **Scopes.** `openid profile email offline_access accounting.transactions.read
  accounting.contacts.read accounting.reports.read accounting.settings.read` —
  read-only; Vocion never writes to the books.
- **Save it.** A **Xero login app** on Developers, or the env as
  `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`.

Access tokens last 30 minutes and Xero replaces the refresh token on each
refresh; Vocion saves the new one. Without an app, a Xero **custom connection**
(client ID and secret) can be pasted instead. More in [xero.md](xero.md).

## Gusto

- **App.** An application in the [Gusto developer portal](https://dev.gusto.com/),
  approved for read access to companies, employees, departments, payrolls and
  time off.
- **Redirect URI.** `<NEXT_PUBLIC_APP_URL>/api/connect/gusto/callback`.
- **Save it.** A **Gusto login app** on Developers, or the env as
  `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET`.

Access tokens last two hours and each refresh token works once; Vocion saves
the next one every time. Gusto is login-only. More in [gusto.md](gusto.md).
## LinkedIn

- **App.** An app in LinkedIn's developer portal with the **Advertising API**
  product approved. LinkedIn reviews that product before `r_ads` can be
  granted, so ask early; until then, paste an access token from LinkedIn's
  token generator on the LinkedIn Ads connector (it lasts 60 days).
- **Redirect URL.** `<NEXT_PUBLIC_APP_URL>/api/connect/linkedin/callback`.
- **Scopes.** Vocion asks for `r_ads` and `r_ads_reporting` and nothing that
  writes, so a LinkedIn connection can only read.
- **Save it.** A **LinkedIn login app** on Developers, or the env as
  `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.

Access tokens last 60 days. Where LinkedIn issues a refresh token the login
renews itself and saves the new token; where it does not, the connector says
to log in again when the token runs out.

## Where it lives in the code

| What | Where |
|---|---|
| The login-app credential types, one per vendor | [`LOGIN_APP_PLATFORMS`, `loginAppPlatformFor`](../../packages/core/src/libs/platforms/registry.ts) |
| Which app a new login, its callback or a refresh uses, and the sentence when that app is gone | [`loginClientForNewLogin`, `loginClientForCallback`, `loginClientForGrant`, `loginAppLookupFailure`, `loginOffered`](../../packages/core/src/libs/connect/loginClient.ts) |
| The server's env apps | [`serverLoginClient`](../../packages/core/src/libs/connect/serverClients.ts) |
| The login starts on the chosen app | [start route](../../packages/core/src/app/api/connect/%5Bprovider%5D/start/route.ts) |
| The code is traded on the app the start chose (its client ID rides in the signed [state](../../packages/core/src/libs/connect/state.ts)), and that client ID is stored with the login | [callback route](../../packages/core/src/app/api/connect/%5Bprovider%5D/callback/route.ts) |
| Refresh on the login's own app | [`refreshAndSave` in `loginGrant.ts`](../../packages/core/src/libs/connect/loginGrant.ts), [`googleAuth.ts`](../../packages/core/src/libs/sources/googleAuth.ts), [`jira.ts`](../../packages/core/src/libs/sources/jira.ts) |
| Saving, listing and revoking by API | [`/api/v1/login-apps`](../../packages/core/src/app/api/v1/login-apps/route.ts), [`loginApps.ts`](../../packages/core/src/services/connect/loginApps.ts), [tests](../../packages/core/src/app/api/v1/login-apps/route.test.ts) |
| The redirect URL the Developers form shows | [`listPlatformsRoute`](../../packages/core/src/routers/ApiTokens.ts), [`ApiTokensPanel`](../../packages/core/src/features/api-tokens/ApiTokensPanel.tsx) |
| Tests | [`loginClient.test.ts`](../../packages/core/src/libs/connect/loginClient.test.ts), [every provider](../../packages/core/src/libs/connect/providers/loginApps.test.ts), [refresh](../../packages/core/src/libs/connect/loginGrant.test.ts), [Google](../../packages/core/src/libs/sources/googleAuth.test.ts), [end to end](../../packages/core/e2e/connect/connect.spec.ts) |

## When a login stops working

The connector's row says what happened and who fixes it:

- **"An admin needs to log in with &lt;vendor&gt; again"**: the person's grant
  was revoked or expired. An admin presses **Reconnect** on the row.
- **"…made with a &lt;vendor&gt; app that is no longer set up"**: the login
  app this login ran on was replaced or removed (or the server's client ID was
  changed). An admin logs in again, on the current app, saving a login app on
  Developers first if there is none.
- **"No &lt;vendor&gt; app is set up any more"**: neither the server nor the
  workspace has an app. Save a login app on Developers (or set the env), then
  log in again.
- **"The saved &lt;vendor&gt; login app could not be read"**: save the login
  app again on Developers.
- **"…logging in again will not help"**: the vendor refused the app itself
  (`invalid_client`, `unauthorized_client`). For the workspace's login app,
  fix it on Developers. For the server's, fix the env values and restart.
- **"The vendor refused the app's client ID or secret"**, right after a login:
  check on Developers that the client ID and secret aren't swapped or cut
  short, then save the app again.
- **`redirect_uri_mismatch` on the vendor's own page**: the redirect URL
  registered at the vendor isn't the one the Developers form shows. Copy it
  exactly: same scheme, host and port, no trailing slash.
- **"…replaced or removed while you were logging in"**: an admin changed the
  login app mid-login. Log in again.

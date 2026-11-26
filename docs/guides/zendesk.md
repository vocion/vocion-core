# Zendesk

A workspace connects one Zendesk account through an OAuth client, and Vocion
calls the account live. Nothing is synced or copied into Vocion.

Today the connector holds the credential and runs Test connection. It is the
base that Zendesk tools call through (`libs/zendesk/client.ts`): each tool asks
for only the OAuth scopes its own calls use.

## Why an OAuth client, not an API token

Zendesk is retiring API tokens. Existing accounts could no longer make new ones
from October 27, 2026, and every remaining API token is deactivated on April 30,
2027 ([Zendesk: migrating from API tokens to OAuth](https://developer.zendesk.com/documentation/authentication/oauth-migration/)).
Vocion uses the OAuth client credentials grant instead, which needs no person
to sign in.

## Connecting it

1. **Make the OAuth client.** A Zendesk admin opens Admin Center → Apps and
   integrations → APIs → OAuth clients → **Add OAuth client**, and sets:
   - **Client kind:** Confidential. Public clients cannot use the client
     credentials grant.
   - **Identifier:** this is the client ID Vocion asks for.
   - **Scopes:** empty allows every scope ("Leave this field empty to allow
     all scopes"). If you limit it, allow at least `users:read`, which Test
     connection uses.
   - Save. The **Secret** field appears once the page refreshes after Save,
     and Zendesk shows it in full only once, so copy it then.

   Source: [Zendesk: Using OAuth authentication with your application](https://support.zendesk.com/hc/en-us/articles/4408845965210).
2. **Credential** (`zendesk` platform):
   - **Subdomain:** the part of your Zendesk address before `.zendesk.com`.
     `acme`, `acme.zendesk.com` and `https://acme.zendesk.com/` all work.
     Shown in full.
   - **Client ID:** the client's Identifier. Shown in full.
   - **Client secret:** stored encrypted and never shown again.
3. **Add a Zendesk source.** It has no settings: the credential names the
   account. Its slug is `zendesk`, so a workspace file that declares
   `slug: zendesk` adopts it instead of adding a second one. If another kind
   of source already holds that slug (sample tickets under `local-files`, for
   example), the new source takes the first free one, `zendesk-2`, `zendesk-3`
   and so on, rather than taking over that source. Adding Zendesk again then
   finds that moved source instead of adding another.
4. **Test connection.** See below.

One Zendesk credential per workspace: one OAuth client covers the whole
account.

## Whose name the calls go out under

A client credentials token acts as the admin who made the OAuth client, with
that admin's permissions. If that admin is later deactivated or loses access,
calls made with the client's tokens fail
([Zendesk](https://support.zendesk.com/hc/en-us/articles/4408845965210)). Make
the client from the admin account you want Vocion's work to appear under.

## What Test connection checks

Read-only. Nothing is saved in Vocion.

| Check | Passes when |
|---|---|
| Gets an OAuth token | Zendesk issues a token for `users:read`, and lists that scope as granted. Zendesk still issues a token for a scope it does not recognise, then refuses every call made with it, so a missing scope fails here rather than later. |
| Reads which Zendesk user the client acts as | `GET /api/v2/users/me.json` answers, and the user's role is `admin` or `agent`. Shows the role and user ID, never the name or email. An `end-user` fails, because working tickets needs an agent or admin. |

Each test mints a new token, so a client revoked since the last test fails
straight away.

## Tokens

- Vocion asks for a one-hour token (Zendesk allows 300 to 172,800 seconds) and
  keeps it in the server's memory, per account, client, secret and set of
  scopes. Saving a new secret gets a new token.
- A token is replaced 5 minutes before it expires, or in its last tenth when
  that is shorter. A tenth is shorter than 5 minutes for any token under 50
  minutes, so the one-hour token Vocion asks for keeps the full 5 minutes, the
  assumed 30-minute token is replaced 3 minutes early, and Zendesk's shortest,
  5-minute token is still used for 4.5 minutes rather than not at all.
- If Zendesk's answer leaves out `expires_in`, Vocion assumes 30 minutes,
  Zendesk's default for clients made on or after April 30, 2026.
- The client credentials grant gives no refresh token, so an expired token is
  replaced by asking for a new one.
- A call Zendesk answers with 401 gets one fresh token and is sent once more.
  A second 401 is reported. Nothing else is retried, except one short wait when
  Zendesk answers 429 with a `Retry-After` of 10 seconds or less.

Token facts: [Zendesk: Create token for grant type](https://developer.zendesk.com/api-reference/ticketing/oauth/grant_type_tokens/).

## Limits

- Only `*.zendesk.com` addresses. A custom domain mapped to Zendesk
  (`support.acme.com`) is refused, so a pasted value can never point the server
  at another host. Redirects are refused for the same reason.
- Each HTTP request times out after 15 seconds: the token request, the call,
  and any resend count separately. One call that also mints a token, waits
  out a short 429 or gets a fresh token after a 401 can take longer in all.
- Every call stays under `/api/v2/`, checked after `..` and `%2e%2e` are
  resolved, so a path cannot climb out to another endpoint with the token.
- A success with no body (a 204, or a write Zendesk confirms with nothing to
  say) comes back as an empty answer. A success whose body is not a JSON
  object, or breaks off part way, is reported as an error.

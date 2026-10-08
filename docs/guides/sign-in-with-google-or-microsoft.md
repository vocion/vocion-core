# Sign in with Google or Microsoft

**TL;DR.** Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` and the sign-in page
shows **Continue with Google**. Set `AUTH_MICROSOFT_ENTRA_ID_ID` and
`AUTH_MICROSOFT_ENTRA_ID_SECRET` and it shows **Continue with Microsoft** (work
or school accounts). Turn on outbound mail and it also offers **Email me a
sign-in link**. None of them opens sign-up: the deployment stays invite-only.

| Way in | Settings | Redirect URI to register |
|---|---|---|
| Google | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | `https://<host>/api/auth/callback/google` |
| Microsoft (Entra ID, multi-tenant) | `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` | `https://<host>/api/auth/callback/microsoft-entra-id` |
| Email link | `VOCION_MAIL_ENABLED=1`, `RESEND_API_KEY`, `VOCION_MAIL_FROM` ([email.md](email.md)) | none |
| Password | none (always on) | none |

`<host>` is the address people open the app at: the host in
`NEXT_PUBLIC_APP_URL` (or `AUTH_URL`). Register one redirect URI per address
the deployment answers on, for example production and a staging host. A
provider whose two values are not both set is not offered anywhere: no button,
nothing registered with Auth.js, nothing on the profile page.

These are not the vendor logins that connect a workspace to Google Drive or
Gmail (`GOOGLE_OAUTH_CLIENT_ID`, [login-apps.md](login-apps.md)). You can make
both clients in the same Google Cloud project, but they are separate clients
with separate redirect URIs.

## Who gets in

The deployment is invite-only, and these ways in keep it that way. They are new
ways to prove who you are, never a way to become someone. On every sign-in
with Google, Microsoft or an email link, in this order:

1. **Already linked.** The provider account was linked to a login before: that
   login signs in.
2. **No verified address.** The provider did not vouch for an email address
   (below): refused.
3. **A login with that address.** The provider account is linked to it and the
   person signs in. One person stays one login, with a password, Google and
   Microsoft all able to open it.
4. **A pending invite to that address.** The invite is accepted exactly as the
   invite link's form accepts it: the login is made, with a membership at the
   invite's role and the person's own workspace. Every other pending invite to
   the same address is accepted on that login too.
5. **Anything else.** Refused, and the sign-in page says *"No invite for this
   address. Ask an admin to invite you."*

Nothing else makes a user. Auth.js is not allowed to create one at all
(`buildAdapter` in `libs/Auth.ts`); the only way a login comes to exist through
the web is accepting an invite (`acceptInviteAsNewUser` in
`services/InviteAcceptance.ts`). The decision is a pure function,
`services/auth/signInDecision.ts`, with its tests beside it.

The invite page (`/sign-up?invite=…`) shows the same buttons. Use the account
whose address the invite was sent to; any other address is refused like any
other uninvited one.

## Set up Google

1. In the [Google Cloud console](https://console.cloud.google.com/), pick or
   create a project for this deployment.
2. **APIs & Services → OAuth consent screen.** Choose *External* (anyone with a
   Google account can reach the button; the invite rules decide who gets in)
   or *Internal* (only your Google Workspace's users). Give it the app's name
   and a support address. The scopes it needs are `openid`, `email` and
   `profile`, which need no verification by Google.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
   Application type *Web application*. Under **Authorized redirect URIs** add
   `https://<host>/api/auth/callback/google` for each address the app is served
   on (`http://localhost:3000/api/auth/callback/google` for development).
   Authorized JavaScript origins are not needed.
4. Copy the client ID and secret into the server's environment:

   ```bash
   AUTH_GOOGLE_ID=1234567890-abc.apps.googleusercontent.com
   AUTH_GOOGLE_SECRET=GOCSPX-…
   ```

5. Restart the app. **Continue with Google** appears on `/sign-in`.

**What Google is trusted for:** the `email` claim, only when `email_verified`
is `true`. An unverified address is refused.

## Set up Microsoft (Entra ID)

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to
   **Identity → Applications → App registrations → New registration**.
2. **Supported account types:** *Accounts in any organizational directory (Any
   Microsoft Entra ID tenant — Multitenant)*. Vocion signs in work and school
   accounts from any organization; personal Microsoft accounts (outlook.com,
   hotmail.com) are refused even if you pick a type that allows them.
3. **Redirect URI:** platform *Web*,
   `https://<host>/api/auth/callback/microsoft-entra-id`. Add one per address
   under **Authentication** afterwards.
4. **Certificates & secrets → New client secret.** Copy the secret's *Value*
   (not its ID) straight away; it is shown once. Note its expiry date: when it
   expires, Microsoft sign-in stops until a new secret is set.
5. Put the **Application (client) ID** from the Overview page and the secret
   into the server's environment:

   ```bash
   AUTH_MICROSOFT_ENTRA_ID_ID=00000000-0000-0000-0000-000000000000
   AUTH_MICROSOFT_ENTRA_ID_SECRET=…
   ```

6. Optional but recommended: **Token configuration → Add optional claim → ID**,
   tick `email` and `xms_edov`. With them, Vocion can match a person by their
   mail address when it differs from their sign-in name (below).
7. Restart the app. **Continue with Microsoft** appears on `/sign-in`.

The first person from each organization may see *"Need admin approval"*: their
organization only lets users consent to apps an admin approved. Their admin
grants consent once for the organization (the permissions asked for are
`openid`, `profile` and `email`).

Vocion uses Microsoft's multi-tenant endpoint,
`https://login.microsoftonline.com/organizations/v2.0`. A token comes back from
each person's own organization, so its issuer is that organization's
(`https://login.microsoftonline.com/<tenant id>/v2.0`). Auth.js re-reads that
tenant's signing keys and checks the token against them; Vocion additionally
requires the issuer to be exactly the one for the token's own `tid`, and refuses
the tenant that holds personal Microsoft accounts.

### What Microsoft is trusted for — the assumption, stated

Microsoft does not say whether an email address is verified, and an
organization's admin can type **any** address into a user's mail attribute,
which Entra then hands out as the `email` claim. Trusting it would let the
admin of any organization sign in as anyone (the "nOAuth" pattern). So:

- **The sign-in name (`preferred_username`, the user principal name) is
  trusted.** Entra only lets an organization give a user a sign-in name in a
  domain that organization has verified it owns (or its own
  `*.onmicrosoft.com`), and a domain can be verified by one organization at a
  time. So `dana@northwind.example` can only come from the organization that
  owns `northwind.example`.
- **`email` is trusted only when `xms_edov` is `true`**, Microsoft's statement
  that the address's domain is verified by the issuing organization. Without
  that optional claim, `email` is ignored.
- **That address must still match an existing login or a pending invite.** A
  verified address with neither is refused.

The consequence to know: an organization that owns a domain can mint any
sign-in name in it, so it can sign in as any of *its own* addresses that has a
login or an invite here. That is the same trust you already place in whoever
runs that domain's mail. If invites go to an address whose sign-in name differs
(mail `dana@northwind.example`, sign-in name `dana@corp.northwind.example`),
either invite the sign-in name or add the optional claims in step 6.

Once a Microsoft or Google account is linked, it is recognised by the
provider's own id for that person (`sub`), not by the address, so a later
change of address at the provider does not move the link.

## Email me a sign-in link

Offered whenever outbound mail is set up ([email.md](email.md)) and, in
production, the deployment knows its own address (`NEXT_PUBLIC_APP_URL` or
`AUTH_URL`). The email field on the sign-in page then sends a link by default,
with **Use a password** one click away.

- A link is mailed only to an address with a login or a pending invite; using
  it signs that login in or accepts the invite exactly as above.
- The page always answers *"If you have an account, we've sent a link"*, and
  decides whether to send after answering, so it reveals nothing about who has
  a login.
- A link works once, for 15 minutes. Auth.js stores only a hash of it.
- Three links per address and ten per network address every 15 minutes.
- The link opens `/sign-in/email-link`, which asks the person to press **Sign
  in**. Mail scanners (Microsoft Defender's Safe Links and others) open every
  link in a message first; a link that signed in on open would be spent before
  the person got there. The token rides in the link's fragment, so it never
  reaches a server log.
- The link is built from `NEXT_PUBLIC_APP_URL` / `AUTH_URL`, never from the
  request's `Host` header, so a forged header cannot make the app mail someone
  a working link to another server.

## Linked sign-in methods on the profile

`/dashboard/profile` → **Sign-in methods** lists the password (set or not), the
email link (when offered), and each provider: linked or not. **Link** signs in
with that provider; it links when the provider vouches for the same address as
this login. **Unlink** removes a provider, but only while a password or another
offered provider still gets the person in; the email link does not count,
because it disappears if the deployment's mail settings change. Links and
unlinks are recorded on the adoption stream (`auth.method_linked`,
`auth.method_unlinked`).

## Security notes

- State and PKCE are checked on every Google and Microsoft sign-in (Auth.js).
- Provider tokens are not stored: a link keeps the provider and the person's id
  there, nothing else.
- Signing in with a provider while already signed in does not attach it to the
  current login by default. It resolves by link or verified address like any
  other sign-in.
- Tenancy is unchanged: whichever way a person signs in, the session's Org and
  workspace are resolved the same way.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `redirect_uri_mismatch` (Google) or `AADSTS50011` (Microsoft) | The redirect URI registered at the provider is not exactly the one the app sent | Register `https://<host>/api/auth/callback/<google \| microsoft-entra-id>` for the host in the address bar; set `NEXT_PUBLIC_APP_URL` / `AUTH_URL` behind a proxy |
| "No invite for this address" | The verified address has no login and no pending invite | Invite that exact address, or sign in with the account the invite went to |
| "Microsoft didn't confirm an email address…" | The account's sign-in name is not an address, and no `email` with `xms_edov` came back | Add the optional claims (step 6), or invite the sign-in name |
| "Use a work or school Microsoft account" | A personal Microsoft account | Use the organization's account |
| "Need admin approval" (Microsoft) | The person's organization requires admin consent | Their admin grants consent for the app once |
| The button is missing | One of the two values is unset or blank | Set both and restart |
| "That sign-in link has expired or was already used" | Older than 15 minutes, used, or replaced | Ask for a new one |

## What this is not

This is sign-in for one deployment, configured by whoever runs it. Per-Org
single sign-on — an Org's own SAML or OIDC connection, capturing an email
domain, enforcing SSO for an Org's members, SCIM provisioning — is not part of
core. The seam for it is the provider registry in
`libs/identity/signInProviders.ts`: `registerSignInProvider` adds a provider to
the same list the buttons, Auth.js and the profile page read, and the
invite-only rules apply to it unchanged because they read only the address the
provider vouches for (`trustedEmail`).

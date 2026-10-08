# Sign-in

**TL;DR.** People sign in with a password, Google, Microsoft or an emailed
link, and can be asked for a code from their phone on top. Every way in is
invite-only: it proves who you are, it never makes you someone new. An invite
still open for your address is joined the next time you sign in, however you
sign in. Forgot your password? There is a link for that
([password-reset.md](password-reset.md)).

| Way in | Turned on by | Guide |
|---|---|---|
| Password | always on | this page |
| Continue with Google | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | [sign-in-with-google-or-microsoft.md](sign-in-with-google-or-microsoft.md) |
| Continue with Microsoft (work or school) | `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` | [sign-in-with-google-or-microsoft.md](sign-in-with-google-or-microsoft.md) |
| Email me a sign-in link | outbound mail on ([email.md](email.md)) | [sign-in-with-google-or-microsoft.md](sign-in-with-google-or-microsoft.md#email-me-a-sign-in-link) |
| Forgot password? | outbound mail on, and `NEXT_PUBLIC_APP_URL` | [password-reset.md](password-reset.md) |
| Two-step sign-in (a code from an app) | each person, or required by `VOCION_REQUIRE_MFA=1` or an Org admin | [below](#two-step-sign-in) |

The sign-in page shows exactly the ways this deployment offers: a button per
configured provider, then the email field, which mails a link when mail is on
(with **Use a password** one click away) and asks for the password otherwise.
**Forgot password?** sits beside the password field.

## Who gets in

The deployment is invite-only, and nothing on the sign-in page changes that.
A login exists because an admin invited that address, because the operator
created it on the server (`npm run user:create`), or — only where the operator
opted in — because the address is in one of the install's
[auto-join domains](invites.md#auto-join-domains).

The password checks itself. Google, Microsoft and an email link go through one
decision, `services/auth/signInDecision.ts`, a pure function with its tests
beside it. In this order:

1. **Already linked.** The provider account was linked to a login before: that
   login signs in. The provider's own id for the person is the identity now,
   not today's address.
2. **No verified address.** The provider did not vouch for an email address:
   refused. An unverified address is exactly what someone taking over another
   person's login would bring.
3. **A login with that address.** Google or Microsoft is linked to it and the
   person signs in. One person stays one login. The person is told: a
   notification, *"Google added to your sign-in methods"*, opens their profile,
   where **Sign-in methods** lists it and can remove it. (A login this same
   sign-in just made gets no notice: there the provider is how they joined.)
4. **Pending invites to that address.** The first is accepted exactly as the
   invite link's form accepts it: the login, a membership at the invite's role,
   the person's own workspace. The rest are joined as the sign-in completes.
   A multi-Org server joins every Org that asked; a single-Org server (the
   default) joins the one Org it allows.
5. **An auto-join domain.** Only on a single-Org install whose operator listed
   the address's domain in `VOCION_AUTO_JOIN_DOMAINS`: a login is made, as a
   member of the install's Org. See [invites.md](invites.md#auto-join-domains).
6. **Anything else.** Refused. The sign-in page says *"No invite for this
   address. Ask an admin to invite you."*

Auth.js is not allowed to create a user at all (`buildAdapter` in
`libs/Auth.ts`). Steps 4 and 5 make the login before Auth.js looks for one.

## Invites are joined when you sign in

Someone who already has a login can be invited to another Org later. They do
not register again. Every completed sign-in — password, Google, Microsoft or
an email link, and after the second factor when one is owed — accepts the
invites still open for the login's own address (`joinPendingInvites`,
`services/auth/joinInvites.ts`). Which ones is the same rule a first sign-in
uses (`invitesToJoin`):

- **Multi-Org server:** every Org that invited the address, except Orgs the
  person is already in.
- **Single-Org server:** only the Org the person is already in, so an existing
  member joins nothing new. An invite to a second Org is left alone, and its
  link says why.

Each Org joined this way is told to the person as a notification in that Org's
workspace: *"You joined Kestrel Capital"*, with the workspaces they now open
there. They do not have to wait for their next sign-in: the invite email's
link opens a one-click **Join** card for a signed-in person, and the app tells
them too (*"Kestrel Capital invited you to join"*), opening **Profile →
Invitations**, where each open invite has its own **Join** button
([invites.md](invites.md#someone-who-already-has-a-login)).

The address used is the login's own, never one typed at sign-in. A login's
email is the address an admin invited or the operator created, and it cannot be
changed from the profile, so an invite to it is an invite to that person.

## Two-step sign-in

A code from an authenticator app (Google Authenticator, 1Password, Authy…) on
top of the password, or on top of Google, Microsoft or an email link.

- **For yourself:** Profile → **Two-step sign-in** → **Set up**. Scan the QR
  code, type the first code, and save the ten recovery codes; each works once
  and they are shown once. Setting it up asks for your password, or, if you
  have none, a sign-in from the last ten minutes.
- **For an Org:** an admin turns on **Require two-step sign-in for everyone in
  this account** on their profile page. Members without it set it up at their
  next sign-in, before they reach a workspace.
- **For the whole deployment:** `VOCION_REQUIRE_MFA=1`.
- **Lost phone and codes:** an Org admin opens the member's row on Members →
  **Reset two-step sign-in**. A person who belongs to more than one Org is reset
  by an operator: `npm run local:reset-mfa -- --email ana@northwind.example`.

Until the code is typed, the session counts as signed out everywhere except the
sign-in page; that half-finished sign-in lasts ten minutes. The secret is
stored with the credential vault, like every other secret the deployment
holds. The rules are in `services/auth/mfa.ts`.

## Limits and lockouts

Every limit is in one list, `packages/core/src/libs/rateLimit/policies.ts`, so
"how many tries does a person get" has one answer. The ones a person meets:

| What | Limit |
|---|---|
| Wrong passwords for one email from one network address | 10 per 15 minutes, then that email is locked from that address |
| Wrong passwords for one email from everywhere together | 50 per 15 minutes, then locked everywhere |
| Two-step codes for one person | 5 per 15 minutes |
| Sign-in links | 3 per address and 10 per network address every 15 minutes |
| Password reset requests | 3 per email and 10 per network address an hour |
| Invite emails an admin sends | 50 an hour |

A lockout says to wait — *"Too many sign-in attempts. Wait a few minutes, then
try again."* — never "wrong password". The right password, or a password reset,
clears it. Limits that guard a secret are counted in Postgres, so every app
instance agrees. Per-address limits read the client from `X-Forwarded-For`,
counting `VOCION_TRUSTED_PROXY_COUNT` proxies from the right (default 1).

## Changing a password ends your other sessions

A new password — by reset, from the profile, or by an operator script — ends
every other session the person had. So does turning two-step sign-in on or off,
or an admin resetting it. The session the change was made from stays signed in.
Someone else using your account is the most common reason to change a
password, so the change removes them.

## One login on several environments

Each environment — a laptop, staging, production — is its own install with its
own database. A login on one does not exist on the others; there are no
accounts shared across installs. To have `ana@northwind.example` work on all
three:

1. **Get a login on each.** An admin on each environment invites the address
   (Members → **Invite member**), or the operator creates it on that server
   (`--org` names the install's Org; it prints a generated password when none
   is passed):

   ```bash
   npm run user:create -- --email ana@northwind.example --name "Ana" --org "Northwind" --role admin
   ```

2. **Sign in the way that suits you.** With Google or Microsoft configured on
   that environment, **Continue with Google** links to the login by its
   verified address on first use; nothing else to remember. Or use **Forgot
   password?** to set a password by email
   ([password-reset.md](password-reset.md)), which also works for a login that
   was made by Google and has no password yet.

Each environment needs its own redirect URI registered at Google and Microsoft
([sign-in-with-google-or-microsoft.md](sign-in-with-google-or-microsoft.md)),
and its own outbound mail for reset links.

## Related

[Invites](invites.md) · [Password reset](password-reset.md) ·
[Google and Microsoft](sign-in-with-google-or-microsoft.md) · [Email](email.md) ·
[Extensions](extensions.md)

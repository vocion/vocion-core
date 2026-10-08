# Password reset

**TL;DR.** **Forgot password?** on the sign-in page mails a link that works
once, for 30 minutes, and leads to a page where you choose a new password. It
needs outbound mail on ([email.md](email.md)) and the deployment's own address
in `NEXT_PUBLIC_APP_URL` (or `AUTH_URL`). The page never says whether an email
has a login.

## What a person does

1. On `/sign-in`, click **Forgot password?** beside the password field. (When
   the page leads with **Email me a sign-in link**, click **Use a password**
   first.)
2. On `/forgot-password`, type the email they sign in with and press **Send
   reset link**. The page answers *"If ana@northwind.example has a login here,
   a reset link is on its way. It works once and expires in 30 minutes."* —
   whatever the address.
3. The mail, *"Reset your Vocion password"*, has one button: **Choose a new
   password**.
4. The button opens `/reset-password`, which checks the link before asking for
   anything. A good link asks for the new password twice (at least 8
   characters). A spent or expired one says *"This link has expired"* and
   offers **Send a new link**.
5. After **Set password**, they sign in with it.

A person who signs in only with Google, Microsoft or an email link has no
password, and the profile page cannot change one they do not have. **Forgot
password?** is how they add one: the reset sets a password on any login.

## What the reset does

- **Ends every other session.** Whoever else was using the account is signed
  out (`endOtherSessions`, `services/auth/sessionVersion.ts`). Someone else
  using the account is the most common reason to reset a password.
- **Lifts the sign-in lockout** on that email. The person just proved they own
  the mailbox, so the password they chose works straight away.
- **Spends the link, and every other link for that person.** Asking twice
  spends the first link; using one spends the rest.

## Why it is built this way

| Rule | Why |
|---|---|
| Same answer for every email, and the mail is sent after the answer | Nothing — the words or the time taken — says whether an email has a login |
| One use, 30 minutes | Long enough to find the mail; short enough that an old one is dead |
| Only a SHA-256 of the token is stored | The link in the mail is the only copy of the secret; reading the `password_reset_token` table resets nobody |
| The token is in the link's fragment (`/reset-password#token=…`) | A browser never sends a fragment to a server, so it stays out of proxy logs and an error tracker's request URLs; the page reads it, drops it from the address bar, and posts it |
| The link is built from `NEXT_PUBLIC_APP_URL` / `AUTH_URL`, never the request's `Host` | A forged `Host` header cannot make the app mail a working link to someone else's server |
| The reset page sends no `Referer` | Nothing on it can carry its URL away |

The code is `services/auth/passwordReset.ts`; the routes are
`/api/password-reset` (ask), `/api/password-reset/check` (is this link still
good?) and `/api/password-reset/confirm` (set it).

## Limits

| What | Limit |
|---|---|
| Reset requests about one email | 3 an hour |
| Reset requests from one network address | 10 an hour |
| Links redeemed (or guessed) from one network address | 20 an hour |

Every email counts alike, so a limit says nothing about who has a login. Past a
limit the page says how many minutes to wait. The numbers are in
`packages/core/src/libs/rateLimit/policies.ts`.

## Set it up

```bash
VOCION_MAIL_ENABLED=1
RESEND_API_KEY=re_…
VOCION_MAIL_FROM="Vocion <signin@northwind.example>"   # on a domain verified in Resend
NEXT_PUBLIC_APP_URL=https://app.northwind.example       # the address in the link
```

On a laptop, the dev mail sink stands in for Resend: set
`VOCION_MAIL_ENABLED=1` and `VOCION_MAIL_SINK_DIR=.mail-sink`, and every
message lands there as a JSON file you can open ([invites.md](invites.md#try-it-on-a-laptop-the-dev-mail-sink)).

Without mail, the page still answers the same way and nothing is sent; the
server log says why (`password reset requested but outbound mail is off`).

## When nobody can get a mail through

An operator on the server can set a password directly. It is a development and
recovery tool: it changes the hash with no check of the old password, and ends
the person's other sessions.

```bash
npm run local:reset-password -- --email ana@northwind.example
```

With a terminal it prompts twice for the new password; `--from-file <path>`
reads it from a file and deletes the file.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| The page says a link is on its way, and none arrives | No login for that address, mail is off, or Resend refused the sender | Check the address is the one they sign in with; check the server log; verify the sending domain in Resend |
| The log says *"set NEXT_PUBLIC_APP_URL (or AUTH_URL) so the link can name this deployment"* | Production with no configured address | Set `NEXT_PUBLIC_APP_URL` and restart |
| *"This link has expired"* | Older than 30 minutes, already used, or a newer one was asked for | **Send a new link**, and use the newest mail |
| *"Too many requests. Try again in N minutes."* | One of the limits above | Wait, or reset from the server |
| The link in the mail points at the wrong host | `NEXT_PUBLIC_APP_URL` names another address | Set it to the address people open the app at |

## Related

[Sign-in](sign-in.md) · [Invites](invites.md) · [Email](email.md)

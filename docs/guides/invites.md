# Invites

**TL;DR.** An admin invites an address from **Members → Invite member**. With
outbound mail on, the person gets an email, *"Join Northwind on Vocion"*, with
one button; the link is also there to copy. With mail off, the admin copies
the link and sends it. The invite works once, for that address only, for 14
days. Someone who already has a login joins with one click, or on their own at
their next sign-in. An operator can also let a company's own domain join
without invites ([auto-join domains](#auto-join-domains)).

## Invite someone

1. **Members** (`/dashboard/members`) → **People** → **Invite member**. Admins
   only.
2. Type the address and pick the role they join with: `member` or `admin`.
3. Press **Send invite** (mail on) or **Create link** (mail off).

What the dialog says next depends on the mail:

| Mail | The dialog shows | The person gets |
|---|---|---|
| On, sent | *"Emailed to ana@northwind.example. The link works too:"* and the link with **Copy** | The invite email |
| On, not sent | *"Not emailed to ana@northwind.example."* and the reason, then the link | Nothing yet: copy the link and send it yourself |
| Off | *"Link for ana@northwind.example"* and the link | Whatever you send them |

The invite waits on the People list as a row marked **Invited**, with who sent
it and when it expires. Its menu (the **⋯** on the row):

- **Resend email** — mails it again. Shown only when this server sends mail,
  and not for an expired invite.
- **Copy invite link** — always there while the invite is live. The link is the
  invite, with mail on or off.
- **Re-invite** — on an expired invite: a fresh link for the same address and
  role, which replaces the old one and, with mail on, is mailed.
- **Revoke invite** — the link stops working.

Inviting the same address again replaces its open invite rather than adding a
second one. An address already in the Org cannot be invited.

## The invite email

Subject: **Join Northwind on Vocion**. It says who invited the person and with
which role, has one button, **Join Northwind**, prints the link underneath for
mail clients that strip buttons, and says until when it works: *"This invite
works once, for this email address only, until October 22, 2026. If you were
not expecting it, you can ignore this email."*

The link is built from `NEXT_PUBLIC_APP_URL` (then `AUTH_URL`), never the
request's `Host` header. In production with neither set, nothing is mailed and
the dialog says so; copy the link instead. Sending is in
`services/InviteMail.ts`; every transactional mail shares the template in
`libs/mail/templates.ts`. An admin can send 50 invite emails an hour.

A mail that cannot be sent never undoes the invite.

## Accepting an invite

The link opens `/sign-up?invite=<token>`. Signed out, it offers every way in
this deployment has. Each one must prove the invited address:

- **The form** — a name and a password, for the address the invite was sent
  to.
- **Continue with Google / Continue with Microsoft** — with the account whose
  verified address is the invited one
  ([sign-in-with-google-or-microsoft.md](sign-in-with-google-or-microsoft.md)).
- **An email link** — when mail is on, from the sign-in page; clicking it
  proves the mailbox.

Any of them makes the login, adds the membership at the invite's role, and
makes the person's own workspace. They then see the Org's shared workspaces —
all of them, unless the deployment enforces workspace access
(`VOCION_ENFORCE_WORKSPACE_ACCESS=1`), in which case the groups an admin puts
them in decide.

They do not even need the link: signing in with Google, Microsoft or an email
link on the plain sign-in page finds the invite to that verified address and
accepts it.

### Someone who already has a login

One person is one login, with a membership per Org. They never register again.

- **From the link.** Signed in, the link opens a card: **Join Kestrel Capital**.
  One click adds the membership on the login they have.
- **From the app, without signing out.** The moment the invite is made, they
  get a notification where they work — *"Kestrel Capital invited you to
  join"* — which opens their **Profile**. Its **Invitations** section lists
  every open invite to their address, each with one **Join Kestrel Capital**
  button (the same path the link's card takes).
- **At their next sign-in.** Every completed sign-in — password included —
  joins the invites still open for the login's address
  ([sign-in.md](sign-in.md#invites-are-joined-when-you-sign-in)).

Either way, they get a notification in the Org they joined: *"You joined
Kestrel Capital"*, naming the workspaces they now open there.

**On a single-Org server** (the default) a person belongs to one Org. An invite
that would put them in a second one is refused, with the sentence the link
shows: *"This Vocion server runs a single Org, and you already belong to
Northwind, so you can't also join Kestrel Capital here. Ask an admin of Kestrel
Capital to invite a different email."* Several Orgs per person need a
multi-Org server, which only an [extension](extensions.md) turns on.

## What an invite never does

- It never works for another address. The link checks the address of whoever
  uses it.
- It never works twice, after 14 days, or after it is revoked. The page says
  which.
- It never makes someone an admin unless the admin who sent it chose that role.

## Auto-join domains

For a company running its own single-Org install, inviting every colleague one
by one is busywork. `VOCION_AUTO_JOIN_DOMAINS` lets the operator say "anyone
who proves an address at our domain may come in":

```bash
VOCION_AUTO_JOIN_DOMAINS=northwind.example,northwind-labs.example
```

Someone with no login and no invite, who proves an address in a listed domain,
gets a login and joins the install's Org:

- **Proving the address** means a verified Google or Microsoft address, or a
  clicked email link. A password cannot: there is no password before there is a
  login, so every login made this way was proven by the provider or the
  mailbox.
- **As a member**, never an admin, with no workspace beyond what any member of
  the Org gets: their personal workspace, plus the shared ones unless access is
  enforced.
- **Exact domains.** `northwind.example` takes `ana@northwind.example`; not
  `ana@mail.northwind.example`, and not `ana@evilnorthwind.example`.
- **An invite wins.** If the address also has an invite, the invite is
  accepted, with the role the admin chose.
- **Off by default.** Unset or empty, nobody joins without an invite.
- **Single-Org installs only.** On a multi-Org server the setting is ignored,
  and the server logs *"VOCION_AUTO_JOIN_DOMAINS is ignored on a multi-Org
  server; each Org invites its own people"* once. Which of several Orgs a
  domain belongs to is each Org's claim to make and verify — per-Org domain
  capture, which is an enterprise extension's to build, not core's. The one
  place the policy is read is `autoJoinPolicy()` in
  `services/auth/autoJoin.ts`; that is where such an extension would answer.
  Core has no hook for it yet.
- **Not before the first admin.** The install's Org is the one people belong
  to; until the operator makes the first admin (`npm run user:create`), there
  is no Org to join.

The person is told *"You joined Northwind"*, like any other join. The decision
is step 5 of the sign-in order ([sign-in.md](sign-in.md#who-gets-in)).

## Try it on a laptop: the dev mail sink

Every mail flow — invites, password resets, sign-in links — runs without a
mail provider:

```bash
VOCION_MAIL_ENABLED=1
VOCION_MAIL_SINK_DIR=.mail-sink   # gitignored
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

With mail on and no Resend key, the sink is the transport: each message is
written to `.mail-sink/` as one JSON file (`to`, `subject`, `text`, `html`,
`tags`, `delivered`). Open the newest one and follow its link. With Resend
configured too, Resend delivers and the sink keeps a copy. With mail off, the
sink still records what would have been sent, with `delivered: false`.

The Playwright suite reads the sink the same way (`e2e/accounts`): an admin
invites an address, the spec finds the invite email in the directory, opens
its link, and accepts. `readSink()` in `libs/mail/sink.ts` lists the messages
oldest first.

Never point the sink at a shared or served directory: a message can carry a
sign-in or reset link, which is a credential until it is used.

## Related

[Sign-in](sign-in.md) · [Password reset](password-reset.md) ·
[Google and Microsoft](sign-in-with-google-or-microsoft.md) · [Email](email.md)

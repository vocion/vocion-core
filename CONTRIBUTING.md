# Contributing to Vocion

Thanks for your interest in improving Vocion. This document covers **how** to
contribute (commit conventions, checks) and the **licensing terms** your
contributions are made under.

## Contributor licensing terms

Vocion is released under the [Mozilla Public License 2.0](LICENSE), and Metacto,
Inc. also offers Vocion under separate [commercial licenses](COMMERCIAL-LICENSE.md).
For that dual model to work, Metacto must hold sufficient rights in the whole
codebase — including your contributions — to keep offering it under both the MPL
and commercial terms.

By submitting a contribution (a pull request, patch, or any other change) you
agree to both of the following:

1. **Inbound license & relicensing grant.** You license your contribution to
   Metacto and to all recipients of the software under the MPL 2.0, **and** you
   grant Metacto, Inc. a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable license — with the right to sublicense — to use, reproduce,
   modify, distribute, and **relicense** your contribution, including as part of
   a proprietary or commercial distribution of Vocion. You retain copyright in
   your contribution; this grant does not transfer ownership.

2. **Developer Certificate of Origin (DCO).** You certify the
   [DCO 1.1](https://developercertificate.org/) for every commit — in short,
   that you wrote the contribution or otherwise have the right to submit it under
   these terms. Certify it by signing off each commit:

   ```
   git commit -s
   ```

   which appends a `Signed-off-by: Your Name <you@example.com>` trailer.

If you cannot agree to these terms, please do not submit a contribution. For
substantial contributions from a company, or if you need a signed Contributor
License Agreement instead of the DCO, contact **licensing@metacto.com**.

## Commit conventions

Conventional commits, enforced by commitlint + lefthook:

| Type | Purpose |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `refactor` | Code change (no feature/fix) |
| `test` | Tests |
| `chore` | Build/tooling |

## Database migrations

Read [packages/core/migrations/CONVENTIONS.md](packages/core/migrations/CONVENTIONS.md)
before writing one. The short version: an index on a table that already exists
goes in `migrations/concurrent/` and says `CONCURRENTLY`, because a plain
`CREATE INDEX` blocks every write to the table until it finishes; column
changes go through expand and contract across releases, never in place.
`npm run check:migrations` enforces the first rule and runs in CI.

## Working in a git worktree

A `git worktree` gets you a second checkout of a branch without disturbing the
first, which is the usual way to work on two branches at once. Two things do
**not** come with it, and both fail in ways that look like a broken branch:

```bash
git worktree add ../vocion-core-<topic> -b <branch>
cd ../vocion-core-<topic>

npm install                                        # node_modules is not shared
cp packages/core/.env.example packages/core/.env.local   # nor is .env.local
```

`packages/core/.env.local` is gitignored (`.env*.local` in `.gitignore`), so a
new worktree has no environment at all. `packages/core/src/libs/Env.ts` validates
on import and `DATABASE_URL` is required there, so **it has to be set before
anything runs** — `npm test`, `npm run dev` and the build all fail during module
load, before a single test executes, and the failure names the env schema rather
than the worktree, which is what makes it cost half an hour the first time.
`AUTH_SECRET` is optional to the schema but required by Auth.js as soon as a
request hits it, so set both and stop thinking about it.

For unit tests the values only have to be present and well-formed; nothing dials
them. `.github/workflows/CI.yml` uses exactly this, and copying it into a
worktree's `.env.local` is enough to run `npm test`:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vocion_test
AUTH_SECRET=<openssl rand -base64 32>
```

A real database is only needed for `npm run dev`, `npm run db:migrate` and the
E2E suite. Copying your primary checkout's `.env.local` works too — but read it
first: it points at whatever database that checkout uses, and migrating from a
worktree will migrate that one.

## Before you push

Run these locally (the pre-commit hook also handles auto-fix + type check +
unused-dep check):

```
npm run check:types
npm test
npm run lint
npm run check:migrations
```

# Security incident — PolinRider supply-chain compromise (June 2026)

**Status:** payload removed from `main` 2026-07-09 · repo-side cleanup completed 2026-08-28 · full history rewrite force-pushed 2026-08-31 · **operational follow-ups still open (see below)**

## What happened

`vocion-core` was hit by **PolinRider**, a DPRK-linked (Lazarus / Contagious Interview cluster) supply-chain campaign that compromises developer machines and then propagates through their GitHub sessions. The campaign is documented publicly by [Socket](https://socket.dev/blog/polinrider-north-korea-linked-supply-chain-campaign-expands), [Wiz](https://threats.wiz.io/all-incidents/polinrider-supply-chain-attack), and [OpenSourceMalware](https://github.com/OpenSourceMalware/PolinRider).

The malware ran **in-process with an already-authenticated GitHub session** — it did not need to steal a token. That is why the pushes look legitimate in the audit log.

### The payload

`packages/core/postcss.config.mjs` carried ~20 KB of obfuscated JavaScript appended to the `export default config;` line, **after roughly 20,000 spaces** — invisible in an editor, and easy to miss in review because the file still ends with a normal-looking export.

- Original PolinRider variant: `global['!']='9-6298-5'`, signature marker `rmcej%otb%` in its string table.
- A `createRequire` shim was added at the top of the file so the ESM module could reach CommonJS `require`; the payload then overrode `global.require` / `global.module`.
- It self-decoded and fetched a second stage from an **Ethereum JSON-RPC endpoint (`geomi.dev`) — the "EtherHiding" pattern**, where the next stage lives in on-chain data rather than on a takedown-able host.
- **It executed on every PostCSS load: `npm run dev`, `npm run build`, `npm run lint`, and the test suite.**

Two decoys shipped alongside it: a one-line `auth.js` at the repo root, and a `config.bat` entry appended to `.gitignore` (so the propagation script's working file would never show up in `git status`).

### How it propagated

GitHub's activity log shows the `chrisfitkin` account force-pushing multiple branches **within a five-second window** — the signature of PolinRider's `temp_auto_push.bat`, which amends the branch's last commit, preserves the original author date, and pushes with `-uf --no-verify`:

| When (UTC) | Repo | Refs force-pushed |
|---|---|---|
| 2026-06-19 22:54 | vocion-core | `main` + 6 branches |
| 2026-06-19 22:54 | vocion-www | `main` |
| 2026-06-26 23:17 | vocion-core | `main` + 4 branches |
| 2026-06-26 23:17 | vocion-www | `main` |

Because the amend preserves the author date but not the committer date, the malicious commits carry **committer timezone `-0400`** while that author's other 470 commits are `-0700`. The `main` amend was `f329fbd` → `1647224`, disguised as *"docs(roadmap): correct auth references Clerk -> auth.js"* — a plausible message over a diff that actually shipped the payload.

Anyone who pulled `main` between ~2026-06-20 and 2026-07-09 executed it on their next `npm run dev`/`build`/`lint`/`test`.

## What was done

**2026-07-09** — `ad31932` (PR/issue #37) restored `postcss.config.mjs` to the legitimate Tailwind-only config on `main`. The decoy `auth.js` was removed on 07-02 by `ceebeff`.

**2026-08-28** — full repo-side sweep:

- Audited every branch, tag, and the full history of `vocion-core` and `vocion-demos` against the published IOC set (signature markers, C2 domains, wallet dead-drops, XOR keys, malicious `tailwind*` npm packages, `temp_auto_push.bat`, `folderOpen` tasks, disguised `.woff2` files).
- Confirmed **30 stale branches still carried the live payload at their tips**; all were verified as already-merged work whose only unique commit was the malware amend, and were deleted.
- Removed the `config.bat` IOC from `.gitignore`.
- Added `npm run check:integrity` (`scripts/check-config-integrity.mjs`), wired into **CI** and the **pre-commit hook**, which fails on: over-long lines in build configs, known campaign signatures, `runOn: folderOpen` VS Code tasks, propagation artifacts, and font files without a font magic number.
- Verified clean: `vocion-demos` (no IOCs in any file or commit), the lockfile (all 2,436 entries resolve to `registry.npmjs.org`, no malicious `tailwind*` packages, no lifecycle-script injection), and the `vocion-demos` → `vocion-core` submodule pin (`cdcd383`, post-fix).

**2026-08-31** — full history rewrite (`git filter-repo`, two passes), force-pushed to every branch and tag:

- Removed the root `auth.js` decoy from all history, replaced the payload blob's content with the clean Tailwind-only config wherever any ref reached it, and stripped the bare `config.bat` line from every `.gitignore` variant that carried it (three distinct blob versions existed; one sat at the tip of 22 stale branches).
- Verified before pushing that every branch tip is tree-identical to its pre-rewrite state except the 22 IOC branches, which differ only by the `.gitignore` line. No shipped code changed.
- Verified after pushing, on a fresh mirror clone: no payload blob, no decoy, no bare `config.bat` line, and no campaign signature reachable from any branch, tag, or notes ref (signatures remain only as documentation, in this file and in `scripts/check-config-integrity.mjs`).
- Every commit SHA after 2026-06-20 changed (again). **Every existing clone must be re-cloned or hard-reset**; local tags must be deleted and re-fetched (`git fetch --force --prune --prune-tags --tags`), because git does not clobber stale local tags on a normal fetch.
- Pre-rewrite mirrors of both the remote and the dataroom's local checkout are backed up at `~/mcto-ip/.backups/polinrider-rewrite-2026-08-31/` on Jamie's machine, along with a preserved 2026-08-20 stash (discovery audit-trail WIP, since shipped) that had been pinning the infected lineage in the local object store.

## Still open

- [ ] **Chris's machine and GitHub credentials.** The malware ran in his session. The workstation should be treated as compromised until reimaged, and every credential on it rotated — GitHub tokens/SSH keys, npm tokens, AWS keys, and **any crypto wallet keys first** (this payload family targets wallets).
- [ ] **Production (`agents.metacto.com`).** It builds from `main`, so it ran the payload for the ~3 weeks it was live. Inspect for outbound `geomi.dev` traffic in that window and rotate anything the build host held.
- [ ] **`vocion-www`.** Its `main` is clean today, but the infected commit `9524d5d` is still an ancestor of `main`. Same audit and secret rotation applies.
- [ ] **Other repos touched by that account.** `chrisfitkin/onyx-fork` and `chrisfitkin/jf-landingpage` were both pushed on 2026-06-26 and have not been audited.
- [x] ~~**29 stale `origin` branches still carry the LIVE payload blob**~~ **Resolved by 2026-08-31**: the 29 branches were deleted from `origin`, and the 08-31 full-ref audit confirmed no branch, tag, or notes ref reaches the payload blob any longer. The three payload-free `config.bat` IOC repos (`deliverystack-api`, `deliverystack-web`, `openclaw-infra`) remain open below. Original finding kept for the record: (2026-08-29) (found 2026-08-29 by scanning every remote ref's `packages/core/postcss.config.mjs` for the >20k-char line). The 2026-08-28 rewrite cleaned `main`'s lineage, but these old-lineage branches were not rewritten or deleted, so any fetch mirrors the payload onto every clone (including the prod box, whose deploy fetches all refs) and any checkout of one re-arms it: `docs/agency-agents-capabilities`, `docs/firsthq-forced-upgrades`, `docs/readme-current-state`, `docs/roadmap-audit`, `docs/vocion-1.0-path`, `feat/action-framework`, `feat/agent-teams`, `feat/api-tokens`, `feat/configurable-brand`, `feat/connector-pack`, `feat/credential-vault-sync`, `feat/drive-connector`, `feat/durable-ingestion`, `feat/event-trigger-runner`, `feat/hubspot-connector`, `feat/hubspot-write-action`, `feat/mcp-over-http`, `feat/missions`, `feat/permission-model`, `feat/review-service`, `feat/scheduled-source-syncs`, `feat/scoped-retrieval`, `feat/team-review-queue`, `feat/v0.5-sidebar-reorg`, `feat/v0.5.2-no-sales-assistant`, `feat/workflow-runner-and-cards-sdk`, `feat/write-api-reviews`, `fix/dockerfile-workspace-copy`, `phase-1-auth-tenancy`. All correspond to long-shipped work; deleting them (or rewriting if any must survive) is the fix. Local-machine sweep done the same day: a payload-carrying local branch deleted in two checkouts, the `vocion-local` superproject's vocion-www pin moved off the infected commit, and `config.bat` gitignore IOCs found (payload-free) in `deliverystack-api`, `deliverystack-web`, and `openclaw-infra` — three repos the account-audit list above does not cover.
- [x] ~~**History rewrite (decision needed).**~~ **Done 2026-08-31** (see "What was done" above). The decoy `auth.js` and the `config.bat` gitignore entry are gone from all pushable history; the payload blob was already unreachable from branches after the 08-28/08-29 work and is now absent from the local mirrors as well.
- [ ] **GitHub PR refs still pin the original infected commits.** 47 `refs/pull/*/head` and `refs/pull/*/merge` refs on GitHub (PRs ~8 through ~61) still reach the original payload commit `1647224`. These refs are read-only snapshots GitHub keeps per pull request; they cannot be deleted or force-pushed by us. Normal `git clone`/`git fetch` does not download them, so no regular clone picks the malware up, but a `--mirror` clone does, and the blob stays browsable on github.com by SHA. Fix: a GitHub Support request to remove the sensitive data and run a server-side GC (their documented "remove sensitive data" flow), or delete and recreate the repository (loses PRs, issues, stars).
- [ ] **Stale clones after the 08-31 rewrite.** Every checkout cloned before 2026-08-31 (teammates' machines, the prod box, `vocion-local/*`) holds pre-rewrite objects and stale tags. Each needs: delete local tags, `git fetch --force --prune --prune-tags --tags`, reset branches onto the rewritten refs, then `git reflog expire --expire=now --all && git gc --prune=now`. Watch for stashes: a stash created on the old lineage silently keeps the whole infected history alive in the object store (that is exactly what happened in the dataroom checkout).

## If you are checking out an old branch

Anything branched before 2026-07-09 may carry the payload. Before running **any** npm script:

```bash
npm run check:integrity
```

Or check the one file directly:

```bash
awk 'length > 500 { print FILENAME ":" FNR " — " length($0) " chars" }' packages/core/postcss.config.mjs
```

A clean file has no line over ~95 characters.

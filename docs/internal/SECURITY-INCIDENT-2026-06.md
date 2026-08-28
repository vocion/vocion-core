# Security incident — PolinRider supply-chain compromise (June 2026)

**Status:** payload removed from `main` 2026-07-09 · repo-side cleanup completed 2026-08-28 · **operational follow-ups still open (see below)**

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

## Still open

- [ ] **Chris's machine and GitHub credentials.** The malware ran in his session. The workstation should be treated as compromised until reimaged, and every credential on it rotated — GitHub tokens/SSH keys, npm tokens, AWS keys, and **any crypto wallet keys first** (this payload family targets wallets).
- [ ] **Production (`agents.metacto.com`).** It builds from `main`, so it ran the payload for the ~3 weeks it was live. Inspect for outbound `geomi.dev` traffic in that window and rotate anything the build host held.
- [ ] **`vocion-www`.** Its `main` is clean today, but the infected commit `9524d5d` is still an ancestor of `main`. Same audit and secret rotation applies.
- [ ] **Other repos touched by that account.** `chrisfitkin/onyx-fork` and `chrisfitkin/jf-landingpage` were both pushed on 2026-06-26 and have not been audited.
- [ ] **History rewrite (decision needed).** The malicious commits remain in `vocion-core` history and are reachable from `main`. They are inert — nothing checks them out — but they are still there. Rewriting is a `git filter-repo` + coordinated force-push that invalidates every existing clone and all tags; it is a team decision, not a unilateral one. The alternative is to leave them and rely on the CI guard.

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

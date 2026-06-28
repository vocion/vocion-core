---
name: release
description: Wrap a shipped unit of work into a complete Vocion release — propagate it to public docs, the marketing site + a cumulative release-notes blog post, the app dashboard, the internal changelog, and a conventional-commit/semver bump. Use when a feature/fix has landed in vocion-core and you want to "ship the release" — docs, website, app UX, blog, and version — in one pass.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash(git status)
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git tag)
  - Bash(npm run check:types *)
  - Bash(npm run lint *)
  - Bash(npm run build *)
---

# Release

This skill turns a shipped unit of work into a **complete, propagated release**. A feature isn't
"done" when the code merges — it's done when the docs, the marketing site, the app UX, the
changelog, and the version all reflect it. This skill does that consistently every time.

It spans two repos in the umbrella:
- **vocion-core** — the framework (code, internal changelog, this skill, semver via semantic-release).
- **vocion-www** — public docs (`docs/`), the blog (`posts/`), and the `/changelog` page.

## Core principles

1. **One unit of work → one release pass.** Don't leave docs/site/app drift behind a code change.
2. **Reuse the established formats.** Match the existing concept-doc shape, blog frontmatter, and
   changelog style — see the references below. Don't invent new structures.
3. **User-facing language.** Write for the person using Vocion, not the commit. Name things by what
   they do.
4. **Conventional commits drive semver.** semantic-release reads commit types on `main`; phrase
   commits so the right version falls out (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING
   CHANGE:` → major).
5. **Verify before you ship.** `check:types` + `lint` clean before committing.

## Inputs to gather

Before writing anything, establish:
- **What shipped** — the capability/fix, in plain terms. Read the diff (`git diff`, `git log`).
- **Primitive type** — a new tool, operation, source, workflow, agent, or an enhancement to one.
- **Surfaces it touches** — does it need a new concept doc? a guide? an app UX surface?
- **Version** — current tag (`git tag | sort -V | tail -1`) + the bump the commits imply.

## The release checklist

Run through `references/release-checklist.md`. In short:

1. **Docs** (vocion-www/docs) — add/update the concept and/or guide; link from `docs/README.md` and
   `docs/reference/mcp.md` if MCP-exposed. See `references/update-docs.md`.
2. **App UX** (vocion-core) — confirm the change is visible in the dashboard (e.g. the Tools or
   Skills catalog, sidebar). See `references/propagate-to-app.md`.
3. **Blog + cumulative notes** (vocion-www) — author `posts/<YYYY-MM-DD>-<slug>.md` with correct
   frontmatter (`related_version`, `tags: [release, …]`). It feeds `/blog` and `/changelog`. See
   `references/create-blog-post.md`.
4. **Internal changelog** (vocion-core) — append a dated entry to `docs/internal/changelog.md`.
5. **Semver + commits** — conventional commits in each repo; push `vocion-core` to `main`
   (semantic-release cuts the tag + GitHub release); then bump the umbrella submodule pin
   (`chore: bump pins to vocion-vX.Y.Z`).

## Repo paths

- Docs: `vocion-www/docs/{concepts,guides,reference,upgrades}/`
- Blog: `vocion-www/posts/YYYY-MM-DD-<slug>.md` · routes at `vocion-www/src/app/[locale]/(marketing)/{blog,changelog}/`
- Internal changelog: `vocion-core/docs/internal/changelog.md`
- App dashboard: `vocion-core/packages/core/src/app/[locale]/(auth)/dashboard/` + `features/dashboard/AppSidebar.tsx`

## Don't

- Don't push to `vocion-core` `main` until `check:types` + `lint` pass — it triggers a real release.
- Don't write a blog post without `related_version` + a `release` tag (the `/changelog` page filters on it).
- Don't duplicate doc structure — extend the existing concept/guide files.

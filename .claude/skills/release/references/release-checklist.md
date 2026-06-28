# Release checklist

Work top to bottom. Tick each before moving on.

## 0. Understand the change
- [ ] `git -C vocion-core log --oneline -10` and `git -C vocion-core diff` — know exactly what shipped.
- [ ] Classify: new **tool / operation / source / workflow / agent**, or an enhancement.
- [ ] Current version: `git -C vocion-core tag | sort -V | tail -1`. Decide the bump from commit types.

## 1. Docs (vocion-www/docs)
- [ ] New primitive → new `concepts/<name>.md`; enhancement → extend the existing concept doc.
- [ ] Add a `guides/<task>.md` if there's a how-to.
- [ ] MCP-exposed? add rows to `reference/mcp.md`.
- [ ] Link new pages from `docs/README.md`.
- See `update-docs.md`.

## 2. App UX (vocion-core)
- [ ] The change is visible in the dashboard (catalog card, sidebar entry, status).
- [ ] New nav entry uses an icon; literal title or an i18n key in `locales/en.json`.
- See `propagate-to-app.md`.

## 3. Blog + cumulative notes (vocion-www)
- [ ] `posts/<YYYY-MM-DD>-<slug>.md` with full frontmatter (`title`, `description`, `date`,
      `author`, `tags: [release, …]`, `related_version: vocion-vX.Y.Z`).
- [ ] Appears on `/blog`; the `release` tag makes it appear on `/changelog`.
- See `create-blog-post.md`.

## 4. Internal changelog (vocion-core)
- [ ] Prepend a dated entry to `docs/internal/changelog.md` (newest first), matching its format.

## 5. Verify
- [ ] `cd vocion-core && npm run check:types && npm run lint` clean.
- [ ] `cd vocion-www && npm run check:types` (and `npm run build` if feasible) clean.

## 6. Commit + release (only after verify)
- [ ] vocion-core: conventional commits (`feat(scope): …`) → push `main` → semantic-release tags + GitHub release.
- [ ] vocion-www: commit docs + blog + changelog → push.
- [ ] umbrella: `git submodule update --remote --merge` → `chore: bump pins to vocion-vX.Y.Z (summary)`.

# Cross-repo release

Ship the feature across the repos. (Propagation of docs/blog/changelog is the `/release` skill's
job — this is the git/version/deploy sequence around it.)

## Sequence
1. **vocion-core** — verify (`check:types` + `lint` + tests). Conventional commit on a feature
   branch (`feat(scope): …`; `feat` → minor bump, only `!`/`BREAKING CHANGE:` for major). Push →
   open PR → squash-merge to `main`.
2. **vocion-www** — commit docs + blog + `/changelog` on a branch → PR → squash-merge.
3. **firsthq** (if buyer-facing) — commit roadmap/marketing → PR → merge → deploy firsthq-www.
4. **Umbrella (`vocion-local`)** — checkout `main` + `pull --ff-only` in each submodule, then
   `git add <submodules> && git commit -m "chore: bump pins …"` and push.
5. **Deploy** — `cd vocion-www && vercel deploy --prod --yes --scope metacto` (and firsthq-www).

## Known carryover blockers (pre-existing, not your feature)
- **vocion-core CI is env-red** (missing Clerk/DB secrets + a broken `WorkflowService.test.ts`),
  so `semantic-release` won't auto-cut the tag until CI is fixed. Merging still lands on `main`.
- **vocion-www auto-deploy is disconnected** (Vercel↔GitHub since a force-push) — every push needs
  a **manual** `vercel --prod`. Reconnect in Vercel → Settings → Git to fix permanently.
- **`drizzle-kit generate` is blocked** by a `0021/0022` snapshot collision in `migrations/meta` —
  hand-write migrations until the journal is repaired.

## Tips
- `gh pr merge <n> --repo vocion/<repo> --squash --delete-branch` (add `--admin` if branch
  protection blocks). Squash uses the PR title — keep it a clean conventional message.
- After merging, re-pin the umbrella so a fresh `bootstrap` pulls the new code.

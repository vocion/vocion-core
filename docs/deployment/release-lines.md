# Release lines

Which branch an installation follows, and how it stays on a major version while the next one
ships.

Companion to [the parent-project pattern](./parent-project-pattern.md).

---

## The lines

| Branch | Major | Releases (git tags) | Runner image tags |
|---|---|---|---|
| `main` | **5.x**, Vocion 5.0 onward | `v5.y.z`, by semantic-release on every green CI | `sha-<commit>`, `5.x`, and `v5.y.z` per release |
| `4.x` | **4.x**, the previous major, still maintained | `v4.y.z`, by semantic-release on every green CI | `sha-<commit>`, `4.x`, `main`, and `v4.y.z` per release |
| `next` | the major after the current one, when one is being built | `vN.0.0-rc.M` on the `next` channel | `sha-<commit>`, `next`, and `vN.0.0-rc.M` per release |

`4.x` was cut from `main` on 2026-10-07 at `0724ad10`, the last commit before Vocion 5.0. Every
4.x release after that is tagged from the `4.x` branch.

A release is a git tag (`v4.33.0`) on a commit of its line, and a GitHub release with notes. There
is no npm package: an installation pins a **commit**, and the tag tells it which commits are
releases.

## What a release is, exactly

A release is **the commit CI passed**, on the line it passed on, and nothing else.
`.github/workflows/release.yml` runs when CI completes and:

- releases only when that CI run concluded `success` on a **push** to `main`, `next` or an `N.x`
  branch. A failed run, and a pull request's run, release nothing;
- checks out that run's own commit and releases it for that run's own branch. A green `4.x` run
  releases `4.x`, never `main`;
- publishes only while that commit is still the branch's tip. If more commits landed while CI ran,
  the run says so and stops, and the newest commit's own green CI releases them all. A tag never
  lands on a commit whose CI has not passed;
- runs one release per line at a time.

Before 5.1 the job released whatever the default branch's HEAD was when it started, so a tag
could land on a commit still in CI, a failed CI run still released, and a green `next` or `4.x`
run released `main`. Releases made before 5.1 were cut that way, so an older tag is not proof
that its commit passed CI: look at that commit's CI run before pinning it.

## The runner image of a release

After a release, the same workflow tags the runner image with the release's name:
`ghcr.io/vocion/vocion-runner:v5.1.0`. It is not a new build. It points at the newest published
`sha-<commit>` image at or before the release whose `packages/runner` is identical to the
release's, so `:v5.1.0` and that `:sha-` tag are the same digest
(`scripts/tag-runner-image.sh`). It waits for a runner build of the release (or an ancestor) that is
still running, since a release often lands while its own runner change is still building.

When no published image has the release's runner source (its build failed or was cancelled), an
older image would be the wrong runner, so none is tagged. The workflow dispatches the Runner image
build on the release tag instead, which builds that exact commit and pushes `:sha-<commit>` and
`:v5.1.0` itself. The run's summary says which of the two happened.

Releases from before 5.1 have no runner release tag. To give one its tag, run the **Release**
workflow by hand (Actions → Release → Run workflow) with that release, for example `v5.0.0`. That
releases nothing; it only does the tagging above.

## Staying on 4.x

Vocion 5.0 changes the navigation (an app rail with a workspace picker per app) and adds a personal
workspace for every member. An installation that is not ready for that stays on 4.x, keeps getting
fixes, and moves to 5.x when it chooses.

1. **Pick the release.** The newest 4.x release:

   ```bash
   git ls-remote --tags https://github.com/vocion/vocion-core.git 'v4.*' | sort -t/ -k3 -V | tail -2
   ```

   Use the commit on the `^{}` line: that is the commit the tag points at.
2. **Pin that commit.**
   - A `vocion-core` submodule: `git -C vocion-core fetch origin 4.x --tags && git -C vocion-core checkout v4.y.z`, then commit the submodule.
   - A file that names the commit (for example `CORE_REF`): write the full 40-character commit.
3. **Pin the runner image to the same release,** if the installation runs the engineering
   runner:

   ```bash
   # VOCION_RUNNER_IMAGE=ghcr.io/vocion/vocion-runner:v4.y.z
   docker buildx imagetools inspect ghcr.io/vocion/vocion-runner:v4.y.z   # exists once the release's tagging ran
   ```

   A release from before 5.1 may not have that tag yet (see [the runner image of a
   release](#the-runner-image-of-a-release)); until it does, pin the commit's runner instead:

   ```bash
   git -C vocion-core log -1 --format=%H v4.y.z -- packages/runner .github/workflows/runner-image.yml
   # VOCION_RUNNER_IMAGE=ghcr.io/vocion/vocion-runner:sha-<that commit>
   ```

   `ghcr.io/vocion/vocion-runner:4.x` also works and moves with the line. `:main` is kept as a 4.x
   alias for installations that never set the variable, but do not rely on it.
4. **Point any bump automation at `4.x`.** A job that moves the pin to a branch head must follow
   `4.x`. One that follows `main` moves the installation to 5.x on its next run.
5. **Taking 4.x fixes later** is the same steps with a newer `v4.y.z`.

A fix needed on 4.x is a pull request against `4.x`. A fix needed on both lines lands on `main`
first and is cherry-picked to `4.x`.

## Moving to 5.x

Pin a `v5.y.z` commit from `main` (and its runner image `:v5.y.z`), apply the workspace, and read
the 5.0 release notes. The database migrations are additive, so returning to the 4.x pin works
without a restore.

## After the deploy: prove it from outside

A health gate says the new build answers. It does not say a person can sign in, open a page or get
an answer from an agent. `infra/aws/verify-full.sh` checks those three things against the live
host, as a QA account the installation keeps for the purpose, and fails red naming the one that
broke:

```bash
HOST=app.example.com PIN=v5.1.0 \
QA_EMAIL="$VERIFY_QA_EMAIL" QA_PASSWORD="$VERIFY_QA_PASSWORD" \
VERIFY_PAGE_PATH=/w/<workspace>/dashboard \
  bash vocion-core/infra/aws/verify-full.sh
```

1. **version**: `/version.txt` is the build this deploy pinned. `PIN` is a release name (the build
   must be exactly that release, not a commit past it), or a commit (the build's `deploy-pin` or its
   core `commit`).
2. **signed in**: the QA account signs in through the same form a person uses, its session names
   it, and `VERIFY_PAGE_PATH` (default `/dashboard`) loads without bouncing to sign-in.
3. **chat**: one chat turn, sent from that page and routed the way the chat routes it, ends with a
   non-empty answer. It is not saved as a conversation, and the workspace's budget records it.

Run it as the last step of the deploy job, after the health gate. Keep the QA sign-in in the
deploy's secrets; the password goes to curl on stdin and never reaches the log.

## The `main` image tag never changes major

`ghcr.io/vocion/vocion-runner:main` is a 4.x alias, moved only by the branch named in
`MAIN_ALIAS_BRANCH` (`.github/workflows/runner-image.yml`), which is `4.x`.
`infra/aws/docker-compose.prod.yml` falls back to it when `VOCION_RUNNER_IMAGE` is unset, and an
installation we cannot see may still pull it, so it must never jump a major. Pin
`VOCION_RUNNER_IMAGE` anyway: a tag that moves is a deploy you did not choose.

## Following a line

- **A pin bumped by hand** stays where it is until someone moves it.
- **A bump bot** follows what it is pointed at. Prefer a release over a branch head: a release
  passed CI and has a name to roll back to.
  - `latest`: the newest release on any line, which is the current major (5.x).
  - `latest-4`: the newest 4.x release. Stays on 4.x.
  - A branch (`main`, `4.x`, `next`): every commit that lands, released or not.

Whatever moves the app pin moves the runner image in the same commit. Pinned by release, that is one
name for both: `v5.1.0` for the core commit and `:v5.1.0` for the runner.

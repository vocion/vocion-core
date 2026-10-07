# Release lines

Which branch an installation follows, and how it stays on a major version while the next one
ships.

Companion to [the parent-project pattern](./parent-project-pattern.md).

---

## The lines

| Branch | Major | Releases (git tags) | Runner image tags |
|---|---|---|---|
| `main` | **5.x**, Vocion 5.0 onward | `v5.y.z`, by semantic-release on every green CI | `sha-<commit>`, `5.x` |
| `4.x` | **4.x**, the previous major, still maintained | `v4.y.z`, by semantic-release on every green CI | `sha-<commit>`, `4.x`, `main` |
| `next` | the major after the current one, when one is being built | `vN.0.0-rc.M` on the `next` channel | `sha-<commit>`, `next` |

`4.x` was cut from `main` on 2026-10-07 at `0724ad10`, the last commit before Vocion 5.0. Every
4.x release after that is tagged from the `4.x` branch.

A release is a git tag (`v4.33.0`) on a commit of its line, and a GitHub release with notes. There
is no npm package: an installation pins a **commit**, and the tag tells it which commits are
releases.

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
3. **Pin the runner image to the same commit's runner,** if the installation runs the engineering
   runner:

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

Pin a `v5.y.z` commit from `main` (and its runner image `sha-` or `:5.x`), apply the workspace,
and read the 5.0 release notes. The database migrations are additive, so returning to the 4.x pin
works without a restore.

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

Whatever moves the app pin moves the runner image in the same commit.

# Release lines

Which branch an installation follows, and how it stays on a major version while the next one is
built.

Companion to [the parent-project pattern](./parent-project-pattern.md).

---

## The lines

| Branch | Releases | Runner image tags |
|---|---|---|
| `main` | the current major (4.x today), by semantic-release on every green CI | `sha-<commit>`, `main` |
| `next` | the next major as prereleases, `v5.0.0-rc.N`, on the `next` channel | `sha-<commit>`, `next` |
| `N.x` (e.g. `4.x`) | a superseded major that installations still run | `sha-<commit>`, `N.x` |

`next` is where Vocion 3.0 (core 5.x) is built. When it is generally available:

1. Cut `4.x` from `main` at the last 4.x release.
2. In `.github/workflows/runner-image.yml`, set `MAIN_ALIAS_BRANCH: 4.x`, on both `4.x` and `main`.
3. Merge `next` into `main`. Its breaking commits release `v5.0.0`.

From then on a fix for a 4.x installation lands on `4.x` and releases `v4.x.y` from there; the
release config's maintenance pattern (`+([0-9])?(.{+([0-9]),x}).x`) is what lets it.

While `next` is open, every fix merged to `main` is merged forward into `next` the same day.

## The `main` image tag never changes major

`ghcr.io/vocion/vocion-runner:main` is a 4.x alias. It moves with the 4.x line and never to 5.x,
because an installation we cannot see may still pull it, and
`infra/aws/docker-compose.prod.yml` falls back to it when `VOCION_RUNNER_IMAGE` is unset. Only the
branch named in `MAIN_ALIAS_BRANCH` moves it.

Pin `VOCION_RUNNER_IMAGE` to `sha-<core commit>` anyway. A tag that moves is a deploy you did not
choose.

## Following a line

An installation follows a line by what it pins:

- **A submodule or `CORE_REF` commit, bumped by hand.** Stays where it is until someone moves it.
  Take the commit from `git ls-remote` on the line's branch.
- **A bump bot** (for example a scheduled workflow that moves the submodule to a branch head). Point
  it at the line's branch: `main` for the current major, `next` to run prereleases, `4.x` to stay
  on 4.x after 5.0.0 ships. A bot pointed at `main` moves to 5.x the day `next` merges.

Whatever moves the app pin moves the runner image in the same commit, to the `sha-` tag of the
same core commit.

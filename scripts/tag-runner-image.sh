#!/usr/bin/env bash
# tag-runner-image.sh — give a release its runner image: ghcr.io/<owner>/vocion-runner:vX.Y.Z.
#
# The runner image is built only when packages/runner changes, and tagged by the commit it was
# built from (sha-<commit>, .github/workflows/runner-image.yml). A release names a commit that
# usually has no image of its own, so a deployment pinned to v5.1.0 had to work out which sha- tag
# was that release's runner. This names it once, at release time, by pointing vX.Y.Z at an image
# that already exists — the same digest as its sha- tag, nothing rebuilt:
#
#   1. Wait for any Runner image build of a commit at or before the release that is still running
#      (a release often lands while its own runner change is still building).
#   2. Take the newest successfully published image whose commit is the release or an ancestor of
#      it, AND whose packages/runner tree is identical to the release's. An older image with the
#      same tree is the same runner; a newer-looking one with a different tree is not.
#   3. Point vX.Y.Z at it (docker buildx imagetools create).
#
# When no published image carries the release's runner source (its build failed, was cancelled,
# or aged out of the run list), the tag would be a lie, so none is made from an older image.
# Instead the Runner image workflow is dispatched on the release tag, which builds that exact
# commit and pushes sha-<commit> and vX.Y.Z itself. Either way the result says what it did.
#
# Environment:
#   TAG       the release tag, v5.1.0 or v6.0.0-rc.1 (required)
#   IMAGE     ghcr.io/<owner>/vocion-runner (required)
#   REPO      <owner>/<repo>, for the gh calls (required)
#   RUNNER_DIR      the image's build context (default packages/runner)
#   RUNNER_WORKFLOW the workflow that builds it (default runner-image.yml)
#   RUN_LIMIT       how many of its recent runs to consider (default 100)
#   DISPATCH        0 reports a missing image instead of building it (default 1)
#
# Needs git (with the tag and full history), gh (actions: read, and write to dispatch), docker
# with buildx, logged in to the registry with packages: write. Tested by
# packages/core/src/scripts/tagRunnerImage.test.ts with fake gh and docker binaries.
set -euo pipefail

say() { echo "tag-runner-image: $*"; }
fail() {
  echo "::error::tag-runner-image: $1"
  exit 1
}
summary() { printf '%s\n' "$@" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }

TAG="${TAG:-}"
IMAGE="${IMAGE:-}"
REPO="${REPO:-}"
RUNNER_DIR="${RUNNER_DIR:-packages/runner}"
RUNNER_WORKFLOW="${RUNNER_WORKFLOW:-runner-image.yml}"
RUN_LIMIT="${RUN_LIMIT:-100}"
DISPATCH="${DISPATCH:-1}"

[ -n "$IMAGE" ] || fail "IMAGE is required (ghcr.io/<owner>/vocion-runner)"
[ -n "$REPO" ] || fail "REPO is required (<owner>/<repo>)"
# A release tag as semantic-release writes one. The value becomes a git ref and an image tag, and
# can come from a person typing it into workflow_dispatch, so nothing else gets through.
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || fail "'${TAG}' is not a release tag (v5.1.0, v6.0.0-rc.1)"

release=$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}") || fail "${TAG} is not a tag in this checkout (fetch with tags and full history)"
want=$(git rev-parse -q --verify "${release}:${RUNNER_DIR}") || fail "${TAG} has no ${RUNNER_DIR}"
say "${TAG} is ${release:0:12}; its runner source is tree ${want:0:12}"

# Runs that push an image: a push to a release line, or a dispatch. A pull request's build never
# leaves the runner. One line per run: id, status, conclusion, commit. No field may be empty: a
# tab is whitespace to `read`, so an empty one would shift the commit into the wrong field.
runs() {
  gh run list --repo "$REPO" --workflow "$RUNNER_WORKFLOW" --limit "$RUN_LIMIT" \
    --json databaseId,status,conclusion,event,headSha \
    --jq '.[] | select(.event == "push" or .event == "workflow_dispatch") | [.databaseId, .status, ((.conclusion // "") | if . == "" then "none" else . end), .headSha] | @tsv'
}
at_or_before() { [ "$1" = "$release" ] || git merge-base --is-ancestor "$1" "$release" 2>/dev/null; }

# 1. Wait out builds of the release or its ancestors that have not finished.
while IFS=$'\t' read -r id status _ sha; do
  [ -n "${id:-}" ] || continue
  [ "$status" != "completed" ] || continue
  at_or_before "$sha" || continue
  say "waiting for the Runner image build of ${sha:0:12} (run ${id}, ${status})"
  gh run watch "$id" --repo "$REPO" --interval 30 < /dev/null > /dev/null || true
done < <(runs)

# 2. The newest published image with the release's runner source. gh lists newest first.
source_sha=""
checked=""
while IFS=$'\t' read -r _ status conclusion sha; do
  [ -n "${sha:-}" ] || continue
  [ "$status" = "completed" ] && [ "$conclusion" = "success" ] || continue
  case " $checked " in *" $sha "*) continue ;; esac
  checked="$checked $sha"
  at_or_before "$sha" || continue
  tree=$(git rev-parse -q --verify "${sha}:${RUNNER_DIR}" 2>/dev/null || true)
  [ "$tree" = "$want" ] || continue
  if docker buildx imagetools inspect "${IMAGE}:sha-${sha}" < /dev/null > /dev/null 2>&1; then
    source_sha="$sha"
    break
  fi
  say "the build of ${sha:0:12} succeeded but ${IMAGE}:sha-${sha} is not in the registry; looking further back"
done < <(runs)

# 3. Name it, or build it.
if [ -n "$source_sha" ]; then
  docker buildx imagetools create --tag "${IMAGE}:${TAG}" "${IMAGE}:sha-${source_sha}"
  say "${IMAGE}:${TAG} -> ${IMAGE}:sha-${source_sha}"
  summary "### Runner image for ${TAG}" \
    "- \`${IMAGE}:${TAG}\` now points at \`${IMAGE}:sha-${source_sha}\`" \
    "- built from ${source_sha:0:12}, whose \`${RUNNER_DIR}\` is identical to ${TAG}'s (${release:0:12})"
  exit 0
fi

reason="no published runner image has ${TAG}'s ${RUNNER_DIR} (tree ${want:0:12}) among the last ${RUN_LIMIT} ${RUNNER_WORKFLOW} runs"
if [ "$DISPATCH" != "1" ]; then
  fail "${reason}. Dispatch ${RUNNER_WORKFLOW} on ${TAG} to build it."
fi
echo "::warning::tag-runner-image: ${reason}; building it from the tag"
gh workflow run "$RUNNER_WORKFLOW" --repo "$REPO" --ref "$TAG" \
  || fail "${reason}, and dispatching ${RUNNER_WORKFLOW} on ${TAG} failed"
say "dispatched ${RUNNER_WORKFLOW} on ${TAG}: it pushes ${IMAGE}:sha-${release} and ${IMAGE}:${TAG}"
summary "### Runner image for ${TAG}" \
  "- ${reason}" \
  "- dispatched \`${RUNNER_WORKFLOW}\` on \`${TAG}\`, which builds ${release:0:12} and pushes \`${IMAGE}:${TAG}\`"

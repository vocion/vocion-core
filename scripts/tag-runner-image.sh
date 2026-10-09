#!/usr/bin/env bash
# tag-runner-image.sh — give a release its runner image: ghcr.io/<owner>/vocion-runner:vX.Y.Z.
#
# The runner image is built only when packages/runner or its workflow changes, and tagged by the
# commit it was built from (sha-<commit>, .github/workflows/runner-image.yml). A release names a
# commit that usually has no image of its own, so a deployment pinned to v5.1.0 had to work out
# which sha- tag was that release's runner. This names it once, at release time:
#
#   0. A release's runner tag never moves: production pins it. If vX.Y.Z already exists (a re-run,
#      a second backfill), it is left as it is and the script says so. FORCE=1 overrides, for a
#      tag known to be wrong.
#   1. Wait for any Runner image build of a commit at or before the release that is still running
#      (a release often lands while its own runner change is still building).
#   2. Take the newest published image whose commit is the release or an ancestor of it, AND whose
#      packages/runner tree and runner-image.yml are both identical to the release's: those two
#      are everything the image is built from. An older image with the same pair is the same
#      runner; a newer-looking one with a different pair is not. Failing that, the release's own
#      sha- image if the registry has it (its run may have aged out of the run list).
#   3. Point vX.Y.Z at it (docker buildx imagetools create): the same digest as its sha- tag,
#      nothing rebuilt.
#
# When no published image is the release's runner (its build failed, was cancelled, or never ran),
# an older image would be the wrong runner, so none is tagged. The script reports result=build and
# commit=<release commit> in $GITHUB_OUTPUT, and the Release workflow's runner-image job builds
# that commit's packages/runner itself and pushes sha-<commit> and vX.Y.Z. It never dispatches
# runner-image.yml on the tag: that runs the tag's own copy of the workflow, which before 5.1
# could push `:main` (the 4.x alias that never moves) and, up to v4.32.0, no release tag at all.
#
# A build is a new digest, and the Dockerfile installs the newest Claude Code, so a rebuilt runner
# can differ from the one the release's commit would have got the day it landed. The summary says
# which path ran. Either way the image's worker_version is the commit it was built from, which can
# be older than the release.
#
# Environment:
#   TAG       the release tag, v5.1.0 or v6.0.0-rc.1 (required)
#   IMAGE     ghcr.io/<owner>/vocion-runner (required)
#   REPO      <owner>/<repo>, for the gh calls (required)
#   RUNNER_DIR      the image's build context (default packages/runner)
#   RUNNER_WORKFLOW the workflow that builds it, under .github/workflows (default runner-image.yml)
#   RUN_LIMIT       how many of its recent push runs, and of its dispatched runs, to consider
#                   (default 100 each; a pull request's run never counts against it)
#   BUILD     0 fails when the release needs a build, instead of asking for one (default 1)
#   FORCE     1 re-points a vX.Y.Z that already exists (default 0)
#
# Needs git (with the tag and full history), gh (actions: read), jq, and docker with buildx logged
# in to the registry with packages: write. Tested by packages/core/src/scripts/tagRunnerImage.test.ts
# with fake gh and docker binaries.
set -euo pipefail

say() { echo "tag-runner-image: $*"; }
fail() {
  echo "::error::tag-runner-image: $1"
  exit 1
}
summary() { printf '%s\n' "$@" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
output() { printf '%s\n' "$@" >> "${GITHUB_OUTPUT:-/dev/null}"; }

TAG="${TAG:-}"
IMAGE="${IMAGE:-}"
REPO="${REPO:-}"
RUNNER_DIR="${RUNNER_DIR:-packages/runner}"
RUNNER_WORKFLOW="${RUNNER_WORKFLOW:-runner-image.yml}"
RUN_LIMIT="${RUN_LIMIT:-100}"
BUILD="${BUILD:-1}"
FORCE="${FORCE:-0}"

[ -n "$IMAGE" ] || fail "IMAGE is required (ghcr.io/<owner>/vocion-runner)"
[ -n "$REPO" ] || fail "REPO is required (<owner>/<repo>)"
# A release tag as semantic-release writes one. The value becomes a git ref and an image tag, and
# can come from a person typing it into workflow_dispatch, so nothing else gets through.
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || fail "'${TAG}' is not a release tag (v5.1.0, v6.0.0-rc.1)"

release=$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}") || fail "${TAG} is not a tag in this checkout (fetch with tags and full history)"
output "commit=${release}"

# 0. A release's runner tag never moves.
if [ "$FORCE" != "1" ] && digest=$(docker buildx imagetools inspect "${IMAGE}:${TAG}" --format '{{json .Manifest.Digest}}' < /dev/null 2> /dev/null); then
  digest="${digest//\"/}"
  say "${IMAGE}:${TAG} already exists (${digest}); a release's runner tag never moves, so it is left as it is"
  output "result=exists"
  summary "### Runner image for ${TAG}" \
    "- \`${IMAGE}:${TAG}\` already exists (\`${digest}\`) and was left as it is. A release's runner tag never moves; \`FORCE=1\` re-points one known to be wrong."
  exit 0
fi

workflow_file=".github/workflows/${RUNNER_WORKFLOW}"
want=$(git rev-parse -q --verify "${release}:${RUNNER_DIR}") || fail "${TAG} has no ${RUNNER_DIR}"
want_workflow=$(git rev-parse -q --verify "${release}:${workflow_file}" || echo none)
say "${TAG} is ${release:0:12}; its runner source is tree ${want:0:12}, built by ${workflow_file} blob ${want_workflow:0:12}"

# Runs that push an image: a push to a release line, or a dispatch. A pull request's build never
# leaves the runner, so it is not asked for, and RUN_LIMIT counts only runs that pushed. One line
# per run, newest first: id, status, conclusion, commit. No field may be empty: a tab is whitespace
# to `read`, so an empty one would shift the commit into the wrong field.
runs() {
  local event
  for event in push workflow_dispatch; do
    gh run list --repo "$REPO" --workflow "$RUNNER_WORKFLOW" --event "$event" --limit "$RUN_LIMIT" \
      --json databaseId,status,conclusion,headSha,createdAt
  done | jq -rs 'add | sort_by(.createdAt) | reverse | .[]
    | [.databaseId, .status, ((.conclusion // "") | if . == "" then "none" else . end), .headSha] | @tsv'
}
at_or_before() { [ "$1" = "$release" ] || git merge-base --is-ancestor "$1" "$release" 2> /dev/null; }
# The same runner: the same build context and the same build definition.
same_runner() {
  [ "$(git rev-parse -q --verify "${1}:${RUNNER_DIR}" 2> /dev/null || true)" = "$want" ] \
    && [ "$(git rev-parse -q --verify "${1}:${workflow_file}" 2> /dev/null || echo none)" = "$want_workflow" ]
}
published() { docker buildx imagetools inspect "${IMAGE}:sha-${1}" < /dev/null > /dev/null 2>&1; }

# 1. Wait out builds of the release or its ancestors that have not finished.
while IFS=$'\t' read -r id status _ sha; do
  [ -n "${id:-}" ] || continue
  [ "$status" != "completed" ] || continue
  at_or_before "$sha" || continue
  say "waiting for the Runner image build of ${sha:0:12} (run ${id}, ${status})"
  gh run watch "$id" --repo "$REPO" --interval 30 < /dev/null > /dev/null || true
done < <(runs)

# 2. The newest published image of the release's runner.
source_sha=""
checked=""
while IFS=$'\t' read -r _ status conclusion sha; do
  [ -n "${sha:-}" ] || continue
  [ "$status" = "completed" ] && [ "$conclusion" = "success" ] || continue
  case " $checked " in *" $sha "*) continue ;; esac
  checked="$checked $sha"
  at_or_before "$sha" || continue
  same_runner "$sha" || continue
  if published "$sha"; then
    source_sha="$sha"
    break
  fi
  say "the build of ${sha:0:12} succeeded but ${IMAGE}:sha-${sha} is not in the registry; looking further back"
done < <(runs)
if [ -z "$source_sha" ] && published "$release"; then
  source_sha="$release"
fi

# 3. Name it.
if [ -n "$source_sha" ]; then
  docker buildx imagetools create --tag "${IMAGE}:${TAG}" "${IMAGE}:sha-${source_sha}"
  say "${IMAGE}:${TAG} -> ${IMAGE}:sha-${source_sha}"
  output "result=tagged"
  summary "### Runner image for ${TAG}" \
    "- \`${IMAGE}:${TAG}\` now points at \`${IMAGE}:sha-${source_sha}\`" \
    "- built from ${source_sha:0:12}, whose \`${RUNNER_DIR}\` and \`${workflow_file}\` are identical to ${TAG}'s (${release:0:12}); its worker_version is ${source_sha:0:12}"
  exit 0
fi

# Or say it needs building.
reason="no published runner image is ${TAG}'s runner (${RUNNER_DIR} tree ${want:0:12}, ${workflow_file} blob ${want_workflow:0:12}) among the last ${RUN_LIMIT} push and ${RUN_LIMIT} dispatched ${RUNNER_WORKFLOW} runs, and ${IMAGE}:sha-${release} is not in the registry"
if [ "$BUILD" != "1" ]; then
  fail "${reason}. Run the Release workflow by hand with release ${TAG} to build it."
fi
echo "::warning::tag-runner-image: ${reason}; this job builds it from ${TAG}"
output "result=build"
summary "### Runner image for ${TAG}" \
  "- ${reason}" \
  "- so this job builds ${release:0:12}'s \`${RUNNER_DIR}\` and pushes \`${IMAGE}:sha-${release}\` and \`${IMAGE}:${TAG}\`: a new digest, not an image any earlier deploy ran"

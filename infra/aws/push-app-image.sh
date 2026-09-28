#!/usr/bin/env bash
# infra/aws/push-app-image.sh — build the app image in CI and push it.
#
# The box that serves the app should never compile it: a first build of
# packages/core/Dockerfile needs about 7.9 GB, and on the box it competes
# with the running stack for memory (#670). A parent project's CI runs this
# instead, then its deploy pulls the image with pull-app-image.sh.
#
#   APP_IMAGE_REPOSITORY=<registry>/<repository> IMAGE_TAG=<tag> \
#     bash vocion-core/infra/aws/push-app-image.sh \
#       --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
#       [--build-arg NAME=value ...]
#
# APP_IMAGE_REPOSITORY  required. An ECR repository logs in with the AWS
#                       credentials in scope (CI: an OIDC role); any other
#                       registry must be logged in already.
# IMAGE_TAG             default $GITHUB_SHA. Tag with the commit, so a deploy
#                       names exactly what it runs and a rollback is a pull.
# IMAGE_PLATFORM        default linux/amd64; linux/arm64 for a Graviton box.
#
# Every argument is passed to `docker buildx build`. NEXT_PUBLIC_APP_URL is
# required: Next bakes NEXT_PUBLIC_* into the client bundle at build time, so
# each environment needs its own image. The URL is also stamped on the image
# as the org.vocion.app-url label, which pull-app-image.sh checks.
#
# The build cache lives in the same repository under the `buildcache` tag, so
# a run whose package-lock.json hasn't changed skips the dependency install.
# Turbopack's own cache is a BuildKit cache mount, which no registry cache
# carries, so the compile itself starts cold on every CI run (about 3 minutes
# on a GitHub runner; see docs/deployment/parent-project-pattern.md).
#
# Safe to run twice: the same tag is pushed again with the same content.
# When run in GitHub Actions it writes `image=<repository>:<tag>` to the step
# outputs, for the deploy job to pass on.

set -euo pipefail

log() { echo "[push-app-image] $*"; }

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repository="${APP_IMAGE_REPOSITORY:-}"
tag="${IMAGE_TAG:-${GITHUB_SHA:-}}"
platform="${IMAGE_PLATFORM:-linux/amd64}"
builder="vocion-app-builder"

if [ -z "${repository}" ]; then
  log "ERROR: APP_IMAGE_REPOSITORY is not set, so there is nowhere to push."
  exit 1
fi
if [ -z "${tag}" ]; then
  log "ERROR: IMAGE_TAG is not set and this isn't a GitHub Actions run. Tag with the commit."
  exit 1
fi
case "${tag}" in
  latest | buildcache)
    log "ERROR: '${tag}' can't be a deploy tag: it would be overwritten. Tag with the commit."
    exit 1
    ;;
esac

app_url=""
previous=""
for argument in "$@"; do
  case "${argument}" in
    --build-arg=NEXT_PUBLIC_APP_URL=*) app_url="${argument#--build-arg=NEXT_PUBLIC_APP_URL=}" ;;
    NEXT_PUBLIC_APP_URL=*)
      if [ "${previous}" = "--build-arg" ]; then app_url="${argument#NEXT_PUBLIC_APP_URL=}"; fi
      ;;
  esac
  previous="${argument}"
done
if [ -z "${app_url}" ]; then
  log "ERROR: pass --build-arg NEXT_PUBLIC_APP_URL=https://<host>."
  log "  Next bakes it into the client bundle; an image built without it can't sign anyone in."
  exit 1
fi

registry_host="${repository%%/*}"
ecr_host_pattern='^[0-9]{12}\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$'
if [[ "${registry_host}" =~ ${ecr_host_pattern} ]]; then
  log "logging in to ${registry_host}"
  if ! aws ecr get-login-password --region "${BASH_REMATCH[1]}" \
    | docker login --username AWS --password-stdin "${registry_host}" >/dev/null; then
    log "ERROR: could not log in to ${registry_host}."
    log "  The CI role needs ecr:GetAuthorizationToken, and push rights on the"
    log "  repository (see docs/deployment/parent-project-pattern.md)."
    exit 1
  fi
fi

# The default `docker` builder can't write a cache to a registry; a
# docker-container builder can. Host networking lets it reach a registry on
# localhost, as the tests use.
if ! docker buildx inspect "${builder}" >/dev/null 2>&1; then
  log "creating the ${builder} buildx builder"
  docker buildx create --name "${builder}" --driver docker-container \
    --driver-opt network=host >/dev/null
fi

image="${repository}:${tag}"
cache="${repository}:buildcache"
log "building ${image} for ${app_url} (${platform})"
# image-manifest and oci-mediatypes: ECR stores a registry cache only in that
# form.
docker buildx build \
  --builder "${builder}" \
  --platform "${platform}" \
  --file "${CORE_DIR}/packages/core/Dockerfile" \
  --tag "${image}" \
  --label "org.vocion.app-url=${app_url}" \
  --cache-from "type=registry,ref=${cache}" \
  --cache-to "type=registry,ref=${cache},mode=max,image-manifest=true,oci-mediatypes=true" \
  --push \
  "$@" \
  "${CORE_DIR}"

log "pushed ${image}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "image=${image}" >> "${GITHUB_OUTPUT}"
fi

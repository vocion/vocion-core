#!/usr/bin/env bash
# infra/aws/pull-app-image.sh — put a CI-built app image on this box.
#
# Building packages/core/Dockerfile on the box that serves the app competes
# with the running stack for memory: a first build needs about 7.9 GB, and an
# out-of-memory kill can take Postgres or Langfuse instead of the build
# (#670). So CI builds the image (push-app-image.sh), and a deploy only pulls
# it. This pulls one image and tags it `vocion-app:latest`, the name
# infra/aws/docker-compose.prod.yml runs.
#
#   bash infra/aws/pull-app-image.sh <registry>/<repository>:<tag>
#
# update.sh and bootstrap.sh call it when VOCION_APP_IMAGE is set. A parent
# project's own deploy script should call it rather than copy it.
#
# An ECR image logs in with the box's own IAM role, which needs
# ecr:GetAuthorizationToken plus pull on the repository. Any other registry
# must be logged in already.
#
# EXPECTED_APP_URL, when set, must match the URL the image was built for.
# Next bakes NEXT_PUBLIC_APP_URL into the client bundle, so an image built for
# another environment would send every sign-in to the wrong host.
#
# Safe to run twice: pulling and tagging the same image again changes nothing.
# A failed pull exits non-zero and leaves the running containers alone.

set -euo pipefail

log() { echo "[pull-app-image] $*"; }

image="${1:-}"
if [ -z "${image}" ]; then
  log "ERROR: no image given. Usage: pull-app-image.sh <registry>/<repository>:<tag>"
  exit 1
fi

# The tag is what makes a deploy repeatable and a rollback possible: without
# one, Docker pulls :latest, which is whatever was pushed last.
image_name="${image##*/}"
case "${image_name}" in
  *:* | *@sha256:*) ;;
  *)
    log "ERROR: ${image} has no tag. Deploy the tag CI pushed, usually the commit."
    exit 1
    ;;
esac

registry_host="${image%%/*}"
ecr_host_pattern='^[0-9]{12}\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$'
if [[ "${registry_host}" =~ ${ecr_host_pattern} ]]; then
  ecr_region="${BASH_REMATCH[1]}"
  log "logging in to ${registry_host}"
  if ! aws ecr get-login-password --region "${ecr_region}" \
    | docker login --username AWS --password-stdin "${registry_host}" >/dev/null; then
    log "ERROR: could not log in to ${registry_host}."
    log "  The box's IAM role needs ecr:GetAuthorizationToken, and"
    log "  ecr:BatchGetImage plus ecr:GetDownloadUrlForLayer on the repository."
    exit 1
  fi
fi

# A pull can fail on a network blip; three tries with a pause between them.
attempt=1
until docker pull --quiet "${image}" >/dev/null; do
  if [ "${attempt}" -ge 3 ]; then
    log "ERROR: could not pull ${image} after ${attempt} tries."
    log "  Check that CI pushed this tag and that the box can reach the registry."
    exit 1
  fi
  log "pull failed (try ${attempt} of 3); retrying in 10s"
  sleep "${PULL_RETRY_SECONDS:-10}"
  attempt=$((attempt + 1))
done

if [ -n "${EXPECTED_APP_URL:-}" ]; then
  built_for=$(docker image inspect --format '{{ index .Config.Labels "org.vocion.app-url" }}' "${image}")
  if [ "${built_for}" != "${EXPECTED_APP_URL}" ]; then
    log "ERROR: ${image} was built for '${built_for:-an unknown URL}', but this box serves ${EXPECTED_APP_URL}."
    log "  Next bakes the app URL into the client bundle, so sign-in would break."
    log "  Deploy the image CI built for this environment."
    exit 1
  fi
fi

docker tag "${image}" vocion-app:latest
log "pulled ${image} and tagged it vocion-app:latest"

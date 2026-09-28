#!/usr/bin/env bash
# infra/aws/install-buildx.sh — install Docker's buildx plugin if it's missing.
#
# packages/core/Dockerfile keeps Turbopack's build cache in a BuildKit cache
# mount (#670), so a repeat image build recompiles only what changed. `docker
# build` runs BuildKit only through the buildx plugin. Without the plugin,
# Docker falls back to its legacy builder, which stops at the cache mount with
# "the --mount option requires BuildKit".
#
# bootstrap.sh and update.sh run this right before they build the image. A
# parent project that builds packages/core/Dockerfile from its own scripts
# should call this one rather than copy it, so the pinned version and its
# checksums stay in one place:
#
#   sudo bash <checkout>/vocion-core/infra/aws/install-buildx.sh
#
# It does nothing when `docker buildx version` already works. Otherwise it
# downloads the pinned release for this machine, checks it against the
# release's published SHA-256, and only then puts it where the Docker CLI
# looks for plugins. A failed download or a checksum mismatch leaves nothing
# installed and exits non-zero, so a deploy stops before it builds anything.

set -euo pipefail

# To move to a new release, update the version and both checksums together,
# from https://github.com/docker/buildx/releases/download/<version>/checksums.txt
BUILDX_VERSION="v0.37.1"
BUILDX_SHA256_AMD64="9447199cdb435f25880548343c128a4b6650e8891ee598905d8d29d39a8e359b"
BUILDX_SHA256_ARM64="e5cc9fe3bbff5cbc91230981f7860e06076110730a2db997082652199042a1f2"

log() { echo "[install-buildx] $*"; }

if docker buildx version >/dev/null 2>&1; then
  exit 0
fi

machine="$(uname -m)"
case "${machine}" in
  x86_64 | amd64)
    release_arch="amd64"
    expected_sha256="${BUILDX_SHA256_AMD64}"
    ;;
  aarch64 | arm64)
    release_arch="arm64"
    expected_sha256="${BUILDX_SHA256_ARM64}"
    ;;
  *)
    log "ERROR: no pinned buildx release for this machine (uname -m: ${machine})."
    log "Install the docker-buildx plugin by hand, then run this again."
    exit 1
    ;;
esac

# The system-wide plugin directory by default, the same one bootstrap.sh
# installs the compose plugin into. The Docker CLI searches it, and also
# DOCKER_CONFIG's own cli-plugins directory when DOCKER_CONFIG is set.
plugin_dir="${DOCKER_CONFIG:-/usr/local/lib/docker}/cli-plugins"
release_url="https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${release_arch}"

log "installing docker-buildx plugin ${BUILDX_VERSION} (linux-${release_arch})"
mkdir -p "${plugin_dir}"
# Download beside the final path, so the move into place is a rename on the
# same filesystem and Docker never sees a half-written plugin.
download_path="$(mktemp "${plugin_dir}/.docker-buildx.XXXXXX")"
trap 'rm -f "${download_path}"' EXIT

if ! curl -fsSL --max-time 120 --retry 3 "${release_url}" -o "${download_path}"; then
  log "ERROR: could not download ${release_url}"
  exit 1
fi

actual_sha256="$(sha256sum "${download_path}" | cut -d ' ' -f 1)"
if [ "${actual_sha256}" != "${expected_sha256}" ]; then
  log "ERROR: checksum mismatch for ${release_url}"
  log "  expected ${expected_sha256}"
  log "  got      ${actual_sha256}"
  exit 1
fi

chmod +x "${download_path}"
mv "${download_path}" "${plugin_dir}/docker-buildx"

if ! docker buildx version >/dev/null 2>&1; then
  log "ERROR: installed ${plugin_dir}/docker-buildx, but \`docker buildx version\` still fails."
  exit 1
fi
log "docker-buildx ${BUILDX_VERSION} installed"

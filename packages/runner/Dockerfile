# The Vocion runner: one headless engineering task per container.
# Build (context is packages/runner, so the contract schema ships with the runner):
#   docker build --platform linux/arm64 -f packages/runner/Dockerfile -t vocion-runner packages/runner
# Published from vocion-core CI, tagged by the commit it was built from. See docs/guides/runner.md.
#
# Two targets (src/engines/):
#   internal (the default, the last stage): both engines, headless Claude Code (claude-cli, the
#            default when a contract names no engine) on top of the open stage's OpenHands. What
#            CI builds and publishes. It carries both so that any runner on an installation can
#            take any run: runners claim across every workspace, oldest first, and a runner that
#            claims a run whose engine its image lacks fails it.
#   open     the openhands engine: the OpenHands Software Agent SDK (MIT) in /opt/openhands, and no
#            Claude Code. The image a client installation pulls.
#              docker build --target open -t vocion-runner-open packages/runner
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg jq less openssh-client procps python3 ripgrep unzip \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Playwright and chromium, for the QA evidence pass. The library lives in /opt/vocion-runner so
# `import('playwright')` from src/qa.mjs resolves without a NODE_PATH trick; the browser lives in
# /opt/playwright so it is shared and readable by the non-root user. Chromium only, and only its
# own system dependencies: firefox and webkit would roughly triple the image.
ARG PLAYWRIGHT_VERSION=1.49.1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN mkdir -p /opt/vocion-runner /opt/playwright \
 && npm install --prefix /opt/vocion-runner --no-audit --no-fund --no-save "playwright@${PLAYWRIGHT_VERSION}" \
 && /opt/vocion-runner/node_modules/.bin/playwright install --with-deps chromium \
 && chmod -R a+rX /opt/playwright \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

# Non-root user with a writable home (Claude Code keeps its state under ~/.claude) and /workspace.
RUN useradd --create-home --uid 10001 --shell /bin/bash runner \
 && mkdir -p /workspace /opt/vocion-runner \
 && chown -R runner:runner /workspace /opt/vocion-runner /opt/playwright

# Every module, by glob: a hand list once missed one and every image built from it died on start
# with ERR_MODULE_NOT_FOUND (2026-09-28). src/image.test.mjs holds this to what the sources import.
COPY --chown=runner:runner src/*.mjs /opt/vocion-runner/src/
COPY --chown=runner:runner src/engines/ /opt/vocion-runner/src/engines/
COPY --chown=runner:runner hooks/ /opt/vocion-runner/hooks/
COPY --chown=runner:runner contract/schema.json /opt/vocion-runner/contract/schema.json
COPY --chown=runner:runner entrypoint.sh claude-settings.json /opt/vocion-runner/
RUN rm -f /opt/vocion-runner/src/*.test.mjs \
 && chmod +x /opt/vocion-runner/entrypoint.sh /opt/vocion-runner/hooks/*.sh

USER runner
WORKDIR /workspace
ENV HOME=/home/runner \
    RUNNER_HOME=/opt/vocion-runner \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    PATH=/usr/local/bin:/usr/bin:/bin

# The commit this image was built from, reported on every claim and heartbeat so Vocion can tell a
# rebuilt runner from the one that failed (2026-09-28: an image older than a rename failed every
# run's setup and nothing could say so).
ARG WORKER_VERSION=unknown
ENV WORKER_VERSION=${WORKER_VERSION}
LABEL org.opencontainers.image.source="https://github.com/vocion/vocion-core" \
      org.opencontainers.image.description="The Vocion runner: one headless engineering task per container."

ENTRYPOINT ["/opt/vocion-runner/entrypoint.sh"]

# ---------- open: the openhands engine, no Claude Code ----------
FROM base AS open
USER root
# Python 3.13 (the SDK needs 3.12+; bookworm has 3.11) and tmux, which the terminal tool drives.
# uv is pinned and copied from its release image; the environment is the pinned list, --no-deps.
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv
COPY openhands-requirements.txt /tmp/openhands-requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends tmux && rm -rf /var/lib/apt/lists/* \
 && UV_PYTHON_INSTALL_DIR=/opt/python uv python install 3.13 \
 && UV_PYTHON_INSTALL_DIR=/opt/python uv venv --python 3.13 /opt/openhands \
 && uv pip install --python /opt/openhands/bin/python --no-deps --no-cache -r /tmp/openhands-requirements.txt \
 && rm -f /tmp/openhands-requirements.txt /usr/local/bin/uv \
 && chmod -R a+rX /opt/python /opt/openhands
USER runner
ENV OPENHANDS_HOME=/opt/openhands \
    OPENHANDS_SUPPRESS_BANNER=1
LABEL org.opencontainers.image.description="The Vocion runner, open engines (OpenHands): one headless engineering task per container."

# ---------- internal (default): claude-cli on top of the open stage, so both engines ----------
FROM open AS internal
USER root
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && npm cache clean --force
USER runner
LABEL org.opencontainers.image.description="The Vocion runner, claude-cli and openhands engines: one headless engineering task per container."

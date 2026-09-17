# Vocion BYOA agent runtime — AgentCore Runtime container.
# AgentCore requires linux/arm64 and serves the HTTP contract on :8080.
# The bundle is self-contained (esbuild), so the app itself is one file.
FROM public.ecr.aws/docker/library/node:22-slim

WORKDIR /app
COPY dist/index.js ./index.js

# The one dependency that cannot be bundled. AWS's OpenTelemetry distro is
# loaded with `--require` before our code, and it sets up the tracer provider
# and the exporter that ships spans to CloudWatch. Bundling it would not work:
# it registers itself at process start, before any import of ours runs, and it
# reads its own package layout off disk. The spans themselves come from the
# LangChain instrumentation inside the bundle (see src/telemetry.ts), which is
# registered by hand for exactly that bundling reason.
RUN npm install --omit=dev --no-package-lock \
      @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.12.0

ENV PORT=8080
EXPOSE 8080

# `--require` has to come before the script, and the distro is a no-op unless
# AGENT_OBSERVABILITY_ENABLED is set, so an environment with tracing switched
# off pays only the load time.
CMD ["node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "index.js"]

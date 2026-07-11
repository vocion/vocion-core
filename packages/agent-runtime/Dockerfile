# Vocion BYOA agent runtime — AgentCore Runtime container.
# AgentCore requires linux/arm64 and serves the HTTP contract on :8080.
# The bundle is self-contained (esbuild), so the image is just node + one file.
FROM public.ecr.aws/docker/library/node:22-slim

WORKDIR /app
COPY dist/index.js ./index.js

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]

# @vocion/agent-runtime

The Vocion **BYOA agent runtime** — the deepagents loop as a standalone, generic artifact. One HTTP contract (`POST /invocations` streaming SSE, `GET /ping`), hostable anywhere: a laptop process in dev, AWS Bedrock AgentCore Runtime in the cloud (same bundle, different host).

## Design rules

- **Agents are data.** The artifact holds no agent definitions and no DB access. Every invocation carries the compiled definition (prompt, subagents, tool catalog), mounted files (playbooks/learnings), and a signed tenant claim.
- **Tools execute in vocion-core.** Catalog entries are rebuilt as transport tools that POST to core's claim-verified endpoint (`/api/internal/agent-tools`); side-channel events (documents, hitl gates, retrieval progress) come back with each result and re-enter this run's stream.
- **The event contract is frozen.** The SSE stream is vocion-core's `AgentEvent` shape — the chat UI can't tell which host ran the loop. One runtime-internal addition: `usage` events for budget charging (consumed by core's provider, never forwarded).

## Run locally

```bash
npm run dev -w @vocion/agent-runtime        # :8080
# model provider: ANTHROPIC_API_KEY → Anthropic; else Bedrock
# (AWS_PROFILE=metacto AWS_REGION=us-west-2 VOCION_MODEL_PROVIDER=bedrock)
```

Then point core at it: agents with `harness: { provider: runtime }` in workspace YAML, or force fleet-wide with `VOCION_AGENT_PROVIDER=runtime`. E2E check: `npx dotenv -c -- tsx src/scripts/smoke-runtime.ts` (in packages/core, with Next dev + Postgres up).

## Deploy to AgentCore (us-west-2)

```bash
ENV=dev AWS_PROFILE=metacto bash infra/agentcore/provision.sh      # once: ECR, role, Memory, SSM
ENV=dev AWS_PROFILE=metacto bash infra/agentcore/deploy-runtime.sh # bundle → arm64 image → ECR → runtime READY
ENV=dev AWS_PROFILE=metacto bash infra/agentcore/smoke-invoke.sh   # toolless streamed-done assertion
```

Core targets the deployed runtime when `VOCION_AGENT_RUNTIME_ARN` is set (SigV4 via the AWS SDK); unset, it uses `VOCION_AGENT_RUNTIME_URL` (default `http://localhost:8080`). **Deployed tool calls require a cloud-reachable core** (`VOCION_TOOL_ENDPOINT_URL`) — until vocion-core itself is deployed, cloud runs are loop+model only and tool calls fail gracefully as tool errors the model can see.

Rollback: `update-agent-runtime` with any previous image tag in ECR (tags are `<git-sha>-<timestamp>`).

## Env

| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 8080 — the AgentCore contract port) |
| `VOCION_MODEL_PROVIDER` | `anthropic` \| `bedrock` (default: anthropic if key present, else bedrock) |
| `VOCION_LLM_MODEL_MAIN` | model id override |
| `LANGFUSE_PUBLIC_KEY` / `SECRET_KEY` / `BASE_URL` | optional in-artifact tracing; degrades to usage-only when unset |
| `VOCION_TOOL_TIMEOUT_MS` | per-tool-call timeout (default 120000) |

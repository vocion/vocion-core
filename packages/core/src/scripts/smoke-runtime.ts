/**
 * E2E smoke test for the BYOA runtime provider.
 *
 * Drives a real agent turn through the full seam:
 *   runAgentDeep → providers/runtime → POST <runtime>/invocations →
 *   deepagents loop in the artifact → tool calls back through
 *   /api/internal/agent-tools (claim-verified) → SSE events relayed here.
 *
 * Prereqs: Postgres up + migrated + workspace applied; the runtime
 * artifact on :8080 (npm run dev -w @vocion/agent-runtime); the Next
 * dev server on :3000 (tool endpoint). Forces the runtime provider via
 * VOCION_AGENT_PROVIDER regardless of the agent's harness config.
 *
 * usage: dotenv -c -- tsx src/scripts/smoke-runtime.ts \
 *   [--org <orgId>] [--agent <slug>] [--message "..."]
 */

import process from 'node:process';

process.env.VOCION_AGENT_PROVIDER = 'runtime';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const { runAgentDeep } = await import('@/services/AgentService');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');

  const [firstAgent] = await db.select().from(agentSchema).limit(1);
  const orgId = arg('org') ?? firstAgent?.orgId;
  const agentSlug = arg('agent') ?? firstAgent?.slug;
  const message = arg('message') ?? 'Briefly: what knowledge sources can you search? Use your search tool once to check what is in the knowledge base about pricing.';

  if (!orgId || !agentSlug) {
    console.error('no agent found — apply a workspace first');
    process.exit(1);
  }

  console.log(`▶ smoke: agent=${agentSlug} org=${orgId} runtime=${process.env.VOCION_AGENT_RUNTIME_URL ?? 'http://localhost:8080'}`);

  const seen = new Set<string>();
  let deltaCount = 0;

  const result = await runAgentDeep({
    orgId,
    agentSlug,
    message,
    userId: 'smoke-runtime',
    onEvent: (event) => {
      seen.add(event.type);
      if (event.type === 'response_delta') {
        deltaCount += 1;
        return;
      }
      if (event.type === 'thinking_delta') {
        return;
      }
      const summary = event.type === 'tool_start' || event.type === 'tool_end'
        ? `${event.type} ${event.tool}`
        : event.type === 'error'
          ? `error: ${event.message}`
          : event.type;
      console.log(`  · ${summary}`);
    },
  });

  console.log(`\n✔ done — ${result.response.length} chars, ${result.toolCalls.length} tool call(s), traceId=${result.traceId || '(none)'}`);
  console.log(`  events seen: ${[...seen].join(', ')} (+${deltaCount} response deltas)`);
  console.log(`\n--- response head ---\n${result.response.slice(0, 400)}`);

  const missing = ['response_delta', 'done'].filter(t => !seen.has(t));
  if (missing.length > 0 || result.response.length === 0) {
    console.error(`\n✗ FAIL: missing ${missing.join(', ')} or empty response`);
    process.exit(1);
  }
  console.log('\n✔ PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ FAIL: ${(err as Error).message}`);
  process.exit(1);
});

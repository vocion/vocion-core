/**
 * AgentCore harness provider — `harness.provider: agentcore`.
 *
 * Runs an agent on the AWS Bedrock **AgentCore managed harness**
 * (CreateHarness/InvokeHarness) instead of the in-process deepagents
 * loop. The split:
 *
 *   - AWS runs the LOOP: model calls, tool selection, context, session
 *     microVM. The agent is pure configuration (systemPrompt, model,
 *     tools, limits) — synced from the `agent` row by workspace:apply.
 *   - vocion-core runs the TOOLS: every vocion capability is declared
 *     as an `inline_function`, so when the agent calls one the harness
 *     pauses and hands the call BACK to this process. We execute it
 *     with the SAME tool implementations the local provider uses
 *     (searchKnowledgeTool, runOperationTool — including the
 *     harness-interrupt HITL gate) and resume with the result.
 *
 * Provisioning (`syncAgentCoreHarness`) is idempotent per agent slug:
 * create-or-update, then poll READY. Invocation
 * (`runAgentOnAgentCoreHarness`) mirrors runAgentDeep's event/return
 * contract so the SSE route and chat UI need no changes.
 *
 * v1 notes:
 *   - Managed AgentCore Memory is DISABLED; conversation continuity
 *     comes from the caller-supplied history (same as the local
 *     provider). Enabling memory + a stable per-conversation session id
 *     is the phase-2 upgrade.
 *   - Loop observability lives in CloudWatch GenAI (AWS side);
 *     operations still trace to Langfuse via SkillService.
 */

import type { HarnessMessage, HarnessContentBlock as SdkContentBlock } from '@aws-sdk/client-bedrock-agentcore';
import type { HarnessTool } from '@aws-sdk/client-bedrock-agentcore-control';
import type { AgentEvent, RuntimeContext } from '../types';
import { randomUUID } from 'node:crypto';
import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore';
import {
  BedrockAgentCoreControlClient,
  CreateHarnessCommand,
  GetHarnessCommand,
  ListHarnessesCommand,
  UpdateHarnessCommand,
} from '@aws-sdk/client-bedrock-agentcore-control';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, skillSchema } from '@/models/Schema';
import { runOperationTool } from '../tools/runOperation';
import { searchKnowledgeTool } from '../tools/searchKnowledge';

/* ------------------------------------------------------------------ */
/* Clients + account plumbing                                          */
/* ------------------------------------------------------------------ */

const REGION = process.env.VOCION_AGENTCORE_REGION ?? 'us-east-1';
/** IAM role the harness assumes (trusts bedrock-agentcore.amazonaws.com). */
const EXECUTION_ROLE_NAME = 'VocionAgentCoreHarnessRole';
/** Default model when the agent's harness block doesn't set one. */
const DEFAULT_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';
/** Max inline-tool round-trips per user turn — backstop against loops. */
const MAX_TOOL_ROUNDS = 12;

let controlClient: BedrockAgentCoreControlClient | undefined;
let dataClient: BedrockAgentCoreClient | undefined;

function control(): BedrockAgentCoreControlClient {
  controlClient ??= new BedrockAgentCoreControlClient({ region: REGION });
  return controlClient;
}

function data(): BedrockAgentCoreClient {
  dataClient ??= new BedrockAgentCoreClient({ region: REGION });
  return dataClient;
}

async function resolveExecutionRoleArn(): Promise<string> {
  const override = process.env.VOCION_AGENTCORE_ROLE_ARN;
  if (override) {
    return override;
  }
  const sts = new STSClient({ region: REGION });
  const { Account } = await sts.send(new GetCallerIdentityCommand({}));
  if (!Account) {
    throw new Error('agentcore: could not resolve AWS account id for the harness execution role');
  }
  return `arn:aws:iam::${Account}:role/${EXECUTION_ROLE_NAME}`;
}

/**
 * Harness names must start with a letter, alphanumeric + underscores only.
 * @param agentSlug
 */
function harnessNameFor(agentSlug: string): string {
  return `vocion_${agentSlug.replace(/[^a-z0-9]/gi, '_')}`;
}

/* ------------------------------------------------------------------ */
/* Provisioning — agent row → CreateHarness / UpdateHarness            */
/* ------------------------------------------------------------------ */

type AgentRow = typeof agentSchema.$inferSelect;

/**
 * The vocion tool surface, declared as harness inline functions. The
 * harness never executes these — it pauses and returns the call to us.
 * Schemas mirror the local tools (tools/searchKnowledge.ts,
 * tools/runOperation.ts) so both providers behave identically.
 * @param row
 * @param skillRows
 */
function buildInlineTools(row: AgentRow, skillRows: Array<typeof skillSchema.$inferSelect>): HarnessTool[] {
  const sources = (row.connectorSources ?? []).join(', ');
  const interrupts = row.harnessConfig?.interrupts ?? [];
  const opCatalog = skillRows
    .map(s => `- ${s.slug}: ${s.description ?? s.name}`)
    .join('\n');

  return [
    {
      type: 'inline_function',
      name: 'search_knowledge',
      config: {
        inlineFunction: {
          description: `Search all ingested knowledge — docs, calls, files, and other connected sources. Use natural language queries; retrieval is hybrid (vector + keyword) so paraphrases and exact terms both work.${sources ? ` Available sources: ${sources}.` : ''}`,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Natural language search query — describe what you want conceptually' },
              source_types: { type: 'array', items: { type: 'string' }, description: `Optional: limit to specific sources${sources ? ` (available: ${sources})` : ''}` },
              metadata_filters: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional: filter by document metadata key-value pairs.' },
            },
            required: ['query'],
          },
        },
      },
    },
    {
      type: 'inline_function',
      name: 'run_operation',
      config: {
        inlineFunction: {
          description: `Invoke a typed operation (a single LLM call + plugin code).${opCatalog ? ` Available operations:\n${opCatalog}` : ' No operations are in scope for this agent.'}${interrupts.length > 0 ? `\nOperations requiring human approval before execution: ${interrupts.join(', ')}. Calling one emits an approval gate; wait for the user's decision, then re-call with approved: true only if they approved.` : ''}`,
          inputSchema: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'operation slug to invoke' },
              input: { type: 'object', description: 'arguments matching the operation\'s declared inputSchema' },
              approved: { type: 'boolean', description: 'for interrupt-gated operations ONLY: set true after — and only after — the user has explicitly approved this exact operation in a later turn' },
            },
            required: ['slug', 'input'],
          },
        },
      },
    },
  ];
}

/**
 * Create or update the AgentCore harness for one agent. Idempotent —
 * keyed by harness name derived from the agent slug. Returns the
 * harness ARN once READY.
 * @param orgId
 * @param agentSlug
 */
export async function syncAgentCoreHarness(orgId: string, agentSlug: string): Promise<string> {
  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug)));
  if (!row) {
    throw new Error(`agentcore: agent ${agentSlug} not found for org ${orgId}`);
  }

  const skillSlugs = row.skillSlugs ?? [];
  const skillRows = skillSlugs.length > 0
    ? await db.select().from(skillSchema).where(and(eq(skillSchema.orgId, orgId), inArray(skillSchema.slug, skillSlugs)))
    : [];

  const hc = row.harnessConfig ?? {};
  const tools = buildInlineTools(row, skillRows);
  const shared = {
    executionRoleArn: await resolveExecutionRoleArn(),
    model: {
      bedrockModelConfig: {
        modelId: hc.model ?? DEFAULT_MODEL_ID,
        ...(hc.maxTokens ? { maxTokens: hc.maxTokens } : {}),
        ...(row.temperature ? { temperature: Number(row.temperature) } : {}),
      },
    },
    systemPrompt: [{ text: row.systemPrompt }],
    tools,
    // Only our inline functions — withholds the harness's built-in
    // shell/file_operations from the model. Same posture as
    // excludeTools on the local provider, default-deny here.
    // Pattern note: plain names in allowedTools match BUILTINS only;
    // inline functions need the cross-server glob form `@*/<name>`
    // (verified live 2026-07 — plain names silently hid our tools).
    allowedTools: tools.map(t => `@*/${t.name!}`),
  };

  const name = harnessNameFor(agentSlug);
  const listed = await control().send(new ListHarnessesCommand({}));
  const existing = (listed.harnesses ?? []).find(h => h.harnessName === name);

  let harnessId: string;
  let arn: string;
  if (existing?.harnessId) {
    await control().send(new UpdateHarnessCommand({ harnessId: existing.harnessId, ...shared }));
    harnessId = existing.harnessId;
    arn = existing.arn!;
  } else {
    const created = await control().send(new CreateHarnessCommand({
      harnessName: name,
      // v1: no AgentCore Memory — continuity comes from caller-supplied
      // history, matching the local provider (see module header).
      memory: { disabled: {} },
      ...shared,
    }));
    harnessId = created.harness!.harnessId!;
    arn = created.harness!.arn!;
  }

  // Wait until the harness (a Runtime under the hood) is invocable.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { harness } = await control().send(new GetHarnessCommand({ harnessId }));
    const status = harness?.status;
    if (status === 'READY') {
      return arn;
    }
    if (status === 'CREATE_FAILED' || status === 'UPDATE_FAILED') {
      throw new Error(`agentcore: harness ${name} entered ${status}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`agentcore: harness ${name} did not reach READY within 180s`);
}

/* ------------------------------------------------------------------ */
/* Invocation — InvokeHarness stream + inline-tool dispatch loop       */
/* ------------------------------------------------------------------ */

export type HarnessRunOptions = {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  allowedSourceSlugs?: string[];
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onEvent?: (event: AgentEvent) => void;
};

type PendingToolUse = { toolUseId: string; name: string; inputJson: string };

export async function runAgentOnAgentCoreHarness(opts: HarnessRunOptions): Promise<{
  response: string;
  traceId: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>;
}> {
  const emit = opts.onEvent ?? (() => {});

  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, opts.agentSlug)));
  if (!row) {
    throw new Error(`agent ${opts.agentSlug} not found`);
  }
  if (!row.harnessArn) {
    throw new Error(`agent ${opts.agentSlug} is provider: agentcore but has no harness ARN — run workspace:apply to provision it`);
  }

  // Same RuntimeContext the local provider builds — the inline tools
  // are the local tool implementations, so gating/ACL/emit all match.
  const ctx: RuntimeContext = {
    orgId: opts.orgId,
    userId: opts.userId,
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    allowedSourceSlugs: opts.allowedSourceSlugs,
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    operationSlugs: row.skillSlugs ?? [],
    harnessConfig: row.harnessConfig ?? {},
    emit,
  };
  // The SAME LangChain tool objects the local provider wires into its
  // graph — invoked directly here with the harness's inline-call args.
  const searchTool = searchKnowledgeTool(ctx);
  const opTool = runOperationTool(ctx);
  const invokeInlineTool = async (name: string, input: Record<string, unknown>): Promise<string | null> => {
    if (name === 'search_knowledge') {
      return String(await searchTool.invoke(input as Parameters<typeof searchTool.invoke>[0]));
    }
    if (name === 'run_operation') {
      return String(await opTool.invoke(input as Parameters<typeof opTool.invoke>[0]));
    }
    return null;
  };

  // ≥33 chars required; a UUID is 36. Fresh session per user turn —
  // context comes from the messages we send (see module header).
  const sessionId = randomUUID();

  let messages: HarnessMessage[] = [
    ...(opts.conversationHistory ?? []).map((m): HarnessMessage => ({
      role: m.role,
      content: [{ text: m.content }],
    })),
    { role: 'user', content: [{ text: opts.message }] },
  ];

  emit({ type: 'thinking' });

  let responseText = '';
  let sawText = false;
  const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; output: string }> = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await data().send(new InvokeHarnessCommand({
      harnessArn: row.harnessArn,
      runtimeSessionId: sessionId,
      ...(opts.userId ? { runtimeUserId: opts.userId } : {}),
      messages,
    }));

    // Reassemble the assistant message from the stream: ordered content
    // blocks (text / toolUse) — needed verbatim for the continuation
    // messages when an inline tool fires.
    const assistantBlocks: SdkContentBlock[] = [];
    let currentText = '';
    let currentTool: PendingToolUse | null = null;
    let stopReason: string | undefined;

    for await (const event of resp.stream ?? []) {
      const e = event as Record<string, any>;
      if (e.contentBlockStart?.start?.toolUse) {
        const tu = e.contentBlockStart.start.toolUse;
        currentTool = { toolUseId: tu.toolUseId, name: tu.name, inputJson: '' };
      } else if (e.contentBlockDelta?.delta) {
        const delta = e.contentBlockDelta.delta;
        if (typeof delta.text === 'string') {
          if (!sawText) {
            emit({ type: 'answering' });
            sawText = true;
          }
          currentText += delta.text;
          responseText += delta.text;
          emit({ type: 'response_delta', delta: delta.text });
        }
        if (currentTool && typeof delta.toolUse?.input === 'string') {
          currentTool.inputJson += delta.toolUse.input;
        }
        const reasoning = delta.reasoningContent?.text;
        if (typeof reasoning === 'string') {
          emit({ type: 'thinking_delta', delta: reasoning });
        }
      } else if (e.contentBlockStop) {
        if (currentTool) {
          let input: Record<string, unknown> = {};
          try {
            input = currentTool.inputJson ? JSON.parse(currentTool.inputJson) : {};
          } catch { /* malformed input JSON — execute with {} */ }
          assistantBlocks.push({ toolUse: { toolUseId: currentTool.toolUseId, name: currentTool.name, input } } as SdkContentBlock);
          currentTool = null;
        } else if (currentText) {
          assistantBlocks.push({ text: currentText } as SdkContentBlock);
          currentText = '';
        }
      } else if (e.messageStop) {
        stopReason = e.messageStop.stopReason;
      } else if (e.runtimeClientError) {
        throw new Error(`agentcore: ${e.runtimeClientError.message ?? 'runtime client error'}`);
      }
    }
    if (currentText) {
      assistantBlocks.push({ text: currentText } as SdkContentBlock);
    }

    const pendingUses = assistantBlocks
      .map(b => (b as { toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> } }).toolUse)
      .filter((tu): tu is { toolUseId: string; name: string; input: Record<string, unknown> } => !!tu);

    if (stopReason !== 'tool_use' || pendingUses.length === 0) {
      break;
    }

    // Execute the inline calls locally and resume the SAME session with
    // the assistant toolUse turn + our toolResult turn (the harness
    // intentionally does not persist the inline turn until we do this).
    const resultBlocks: SdkContentBlock[] = [];
    for (const use of pendingUses) {
      emit({ type: 'tool_start', tool: use.name, input: use.input });
      let output: string;
      try {
        output = (await invokeInlineTool(use.name, use.input)) ?? `Tool "${use.name}" is not available.`;
      } catch (err) {
        output = `Tool error: ${(err as Error).message ?? 'unknown'}`;
      }
      emit({ type: 'tool_end', tool: use.name, input: use.input, output });
      toolCallLog.push({ tool: use.name, input: use.input, output });
      resultBlocks.push({
        toolResult: {
          toolUseId: use.toolUseId,
          content: [{ text: output }],
          status: 'success',
        },
      } as SdkContentBlock);
    }

    messages = [
      { role: 'assistant', content: assistantBlocks },
      { role: 'user', content: resultBlocks },
    ];
  }

  emit({ type: 'done', response: responseText, traceId: '' });
  return { response: responseText, traceId: '', toolCalls: toolCallLog };
}

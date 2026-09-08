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
 *     (searchKnowledgeTool) and resume with the result.
 *
 * Provisioning (`syncAgentCoreHarness`) is idempotent per org and agent slug:
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
 *     tool calls land in the tool_call activity record.
 */

import type { HarnessMessage, HarnessContentBlock as SdkContentBlock } from '@aws-sdk/client-bedrock-agentcore';
import type { HarnessSummary, HarnessTool } from '@aws-sdk/client-bedrock-agentcore-control';
import type { AgentEvent, RuntimeContext } from '../types';
import { createHash, randomUUID } from 'node:crypto';
import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore';
import {
  BedrockAgentCoreControlClient,
  CreateHarnessCommand,
  DeleteHarnessCommand,
  GetHarnessCommand,
  ListHarnessesCommand,
  ResourceNotFoundException,
  UpdateHarnessCommand,
} from '@aws-sdk/client-bedrock-agentcore-control';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema } from '@/models/Schema';
import { withToolCallRecord } from '../toolCallRecord';
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
 * AWS caps a harness name at 40 characters and accepts
 * `[a-zA-Z][a-zA-Z0-9_]{0,39}` — a letter first, then alphanumerics and
 * underscores (verified against the CreateHarness API reference).
 */
const MAX_HARNESS_NAME_LENGTH = 40;
const HARNESS_NAME_PREFIX = 'vocion_';
/** Hex characters of the org+slug digest kept in a harness name. */
const HARNESS_NAME_DIGEST_LENGTH = 10;

/**
 * The harness name for one agent, unique per org as well as per slug.
 *
 * Agent slugs are unique within an org, not within a deployment. A name built
 * from the slug alone therefore collided across orgs: two orgs each with a
 * `support-lead` both resolved to `vocion_support_lead`, so the second org's
 * apply found the first org's harness by name and called `UpdateHarness` on
 * it, replacing that org's system prompt, model and allowed tools.
 *
 * The digest of `<orgId>:<slug>` is what makes the name unique; the readable
 * slug fragment in front of it is for whoever is reading the AgentCore
 * console, and is truncated to whatever the 40-character cap leaves over.
 * @param orgId - Org the agent belongs to.
 * @param agentSlug - The agent's slug within that org.
 * @returns A name AWS accepts, distinct for every (org, slug) pair.
 */
function harnessNameFor(orgId: string, agentSlug: string): string {
  const digest = createHash('sha256')
    .update(`${orgId}:${agentSlug}`)
    .digest('hex')
    .slice(0, HARNESS_NAME_DIGEST_LENGTH);
  const roomForSlug
    = MAX_HARNESS_NAME_LENGTH - HARNESS_NAME_PREFIX.length - HARNESS_NAME_DIGEST_LENGTH - 1;
  const readableSlug = agentSlug.replace(/[^a-z0-9]/gi, '_').slice(0, roomForSlug);
  return `${HARNESS_NAME_PREFIX}${readableSlug}_${digest}`;
}

/**
 * The harness id inside a harness ARN, or undefined when there is none.
 * @param harnessArn - A `.../harness/<id>` ARN.
 */
function harnessIdFromArn(harnessArn: string): string | undefined {
  return harnessArn.split('/').pop() || undefined;
}

/**
 * Turn a rejected harness write into an error that names the execution role.
 *
 * Nothing creates `VocionAgentCoreHarnessRole` any more — the parent project
 * that used to make it on every deploy stopped, deliberately, so choosing our
 * own container no longer provisions harness scaffolding. A client who then
 * picks `aws-managed-harness` gets AWS's own wording about a role they have
 * never heard of, with no hint of what should have created it or that an
 * override exists. This says both, and keeps AWS's message inside.
 * @param err - Whatever the Create/Update call threw.
 * @param executionRoleArn - The role that was passed.
 * @returns The error to throw instead.
 */
function describeHarnessWriteFailure(err: unknown, executionRoleArn: string): unknown {
  const message = err instanceof Error ? err.message : String(err);
  const isAboutTheRole = message.includes(executionRoleArn)
    || message.includes(EXECUTION_ROLE_NAME)
    || message.includes('PassRole')
    || message.includes('executionRoleArn');
  if (!isAboutTheRole) {
    return err;
  }
  return new Error(
    `agentcore: the harness execution role ${executionRoleArn} was rejected. `
    + `Create that role (trusting bedrock-agentcore.amazonaws.com) in this account, `
    + `or set VOCION_AGENTCORE_ROLE_ARN to a role that already exists. AWS said: ${message}`,
  );
}

/* ------------------------------------------------------------------ */
/* Provisioning — agent row → CreateHarness / UpdateHarness            */
/* ------------------------------------------------------------------ */

type AgentRow = typeof agentSchema.$inferSelect;

/**
 * The vocion tool surface, declared as harness inline functions. The
 * harness never executes these — it pauses and returns the call to us.
 * Schemas mirror the local tools (tools/searchKnowledge.ts) so both
 * providers behave identically.
 * @param row
 */
function buildInlineTools(row: AgentRow): HarnessTool[] {
  const sources = (row.connectorSources ?? []).join(', ');

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
  ];
}

/**
 * Find a harness by name, reading every page.
 *
 * `ListHarnesses` returns one page plus a `nextToken`. Asking for a single
 * page and dropping the token means a harness past the first page reads as
 * absent, and the caller then creates a second one under the same name.
 * @param name - Harness name to look for.
 * @returns The matching summary, or undefined when there is none.
 */
async function findHarnessByName(name: string): Promise<HarnessSummary | undefined> {
  let nextToken: string | undefined;
  do {
    const page = await control().send(new ListHarnessesCommand({ nextToken }));
    const match = (page.harnesses ?? []).find(h => h.harnessName === name);
    if (match) {
      return match;
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return undefined;
}

/**
 * The harness this agent should update, or undefined when it needs a new one.
 *
 * The ARN already recorded on the agent row is tried first, so an agent
 * provisioned under an older naming scheme keeps the harness it has instead of
 * being abandoned — the old one left running and chargeable — while a second
 * one appears under the new name. The name lookup is the fallback, for an
 * agent whose harness exists but was never recorded.
 * @param row - The agent row, whose `harnessArn` may point at a live harness.
 * @param name - The name this agent's harness has under the current scheme.
 */
async function readHarnessToUpdate(
  row: AgentRow,
  name: string,
): Promise<{ harnessId: string; arn: string } | undefined> {
  const recordedId = row.harnessArn ? harnessIdFromArn(row.harnessArn) : undefined;
  if (recordedId) {
    try {
      const { harness } = await control().send(new GetHarnessCommand({ harnessId: recordedId }));
      if (harness?.harnessId && harness.arn) {
        return { harnessId: harness.harnessId, arn: harness.arn };
      }
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) {
        throw err;
      }
      console.warn(
        `agentcore: ${row.slug} points at harness ${recordedId}, which no longer exists — provisioning a new one`,
      );
    }
  }
  const byName = await findHarnessByName(name);
  if (byName?.harnessId && byName.arn) {
    return { harnessId: byName.harnessId, arn: byName.arn };
  }
  return undefined;
}

/**
 * Create or update the AgentCore harness for one agent. Idempotent — the
 * harness is found by the ARN on the agent row, or failing that by a name
 * derived from the org id and the slug together. Returns the harness ARN
 * once READY.
 * @param orgId - Org the agent belongs to.
 * @param agentSlug - The agent's slug within that org.
 */
export async function syncAgentCoreHarness(orgId: string, agentSlug: string): Promise<string> {
  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug)));
  if (!row) {
    throw new Error(`agentcore: agent ${agentSlug} not found for org ${orgId}`);
  }

  const hc = row.harnessConfig ?? {};
  const tools = buildInlineTools(row);
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

  const name = harnessNameFor(orgId, agentSlug);
  const existing = await readHarnessToUpdate(row, name);

  let harnessId: string;
  let arn: string;
  try {
    if (existing) {
      await control().send(new UpdateHarnessCommand({ harnessId: existing.harnessId, ...shared }));
      harnessId = existing.harnessId;
      arn = existing.arn;
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
  } catch (err) {
    throw describeHarnessWriteFailure(err, shared.executionRoleArn);
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
    citationSeq: { current: 0 },
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    allowedSourceSlugs: opts.allowedSourceSlugs,
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    harnessConfig: row.harnessConfig ?? {},
    provider: 'agentcore',
    emit,
  };
  // The SAME LangChain tool objects the local provider wires into its
  // graph — invoked directly here with the harness's inline-call args.
  // Wrapped so each invocation writes a tool_call row, like the others.
  const searchTool = withToolCallRecord(searchKnowledgeTool(ctx), ctx);
  const invokeInlineTool = async (name: string, input: Record<string, unknown>): Promise<string | null> => {
    if (name === 'search_knowledge') {
      return String(await searchTool.invoke(input as Parameters<typeof searchTool.invoke>[0]));
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

/**
 * Delete the managed harness recorded on an agent row.
 *
 * Called when an agent moves OFF `aws-managed-harness`. Without it the harness
 * stays `READY` and invisible — AWS's harness image, still chargeable, still
 * reachable by anyone holding its ARN — while every actual turn goes to
 * whatever the agent now names. That happened: `Veerio-Life/veerio-vocion`
 * moved `event-ingestion-lead` to `agentcore-container` and its harness sat
 * live for days, found only by reading the AgentCore console.
 *
 * Addressed by the id inside the stored ARN, deliberately, rather than by
 * looking a name up:
 *
 * - The ARN came from that org's own row, so this can only ever reach that
 *   org's harness. Names are org-scoped now, but an agent provisioned before
 *   that change still carries a bare `vocion_<slug>` name, which a lookup
 *   could match for a different org.
 * - It needs no `ListHarnesses`, so a harness past the first page cannot read
 *   as absent — which on this path would mean reporting success and leaving it
 *   running.
 *
 * The harness owns the runtime underneath it, so `DeleteHarness` takes both;
 * `DeleteAgentRuntime` on that runtime is refused with "This agent runtime is
 * managed by harness ... Use DeleteHarness".
 * @param harnessArn - The `harnessArn` stored on the agent row.
 * @returns `deleted` false when the harness was already gone — the caller may
 * still clear its ARN, since there is nothing left to point at.
 */
export async function deleteAgentCoreHarness(harnessArn: string): Promise<{ deleted: boolean; harnessId: string }> {
  const harnessId = harnessIdFromArn(harnessArn);
  if (!harnessId) {
    throw new Error(`agentcore: cannot read a harness id out of ${harnessArn}`);
  }

  try {
    await control().send(new DeleteHarnessCommand({ harnessId }));
    return { deleted: true, harnessId };
  } catch (err) {
    // Already gone — someone deleted it in the console, or a previous apply
    // deleted it and failed before clearing the row. Either way the desired
    // state is the actual state.
    if (err instanceof ResourceNotFoundException) {
      return { deleted: false, harnessId };
    }
    throw err;
  }
}

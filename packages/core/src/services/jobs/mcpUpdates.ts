/**
 * A CONNECTED SYSTEM TELLS THE THREAD THAT ASKED.
 *
 * A request made of a connected system through `mcp.act` carries the
 * conversation it was asked in (`libs/actions/mcp-act.ts`, `origin`). The
 * system then has things to say to that conversation over days: it needs an
 * answer, it stopped, it shipped. It cannot call in (no inbound credential,
 * nothing to sign), so the workspace asks: a source that declares an
 * `updatesTool` is read on a schedule, each update is said once in the
 * conversation it names, in the app's chat and in its Slack thread
 * (`tellConversation`), and the ids told are acknowledged on the same call
 * next time, so the provider stops returning them.
 *
 * The contract is the source's, not core's: the tool is a declared read the
 * provider marks read-only, it returns `{updates: [{id, conversation, text,
 * url?, asks?}]}`, and it takes `{ack: [ids]}`. Nothing here names a product.
 *
 * AN UPDATE THAT ASKS goes to the agent first. The agent that holds the
 * conversation reads the question with the thread's history: when the record
 * settles it, it answers the system itself (through `mcp.act`, on the
 * workspace's trust rule) and says what it answered; when it is a person's
 * call, it asks the people in the thread in its own words. Either way the
 * thread hears one message. If the agent cannot run, the provider's own
 * words are said instead, so a question is never dropped.
 */
import type { TellResult } from '@/services/chat/tellConversation';

export type McpUpdate = { id: string; conversation: number; text: string; url: string | null; asks: boolean };

/**
 * The updates in a tool result, kept only when well formed: an id, a
 * conversation that is a whole number, and words.
 * @param result - The provider's tool result.
 */
export function updatesOf(result: Record<string, unknown>): McpUpdate[] {
  let body: unknown = result.structuredContent;
  if (!body || typeof body !== 'object') {
    const text = Array.isArray(result.content) ? (result.content as Array<{ type?: string; text?: unknown }>).find(b => b.type === 'text' && typeof b.text === 'string')?.text : undefined;
    try {
      body = typeof text === 'string' ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
  }
  const list = body && typeof body === 'object' && Array.isArray((body as { updates?: unknown }).updates) ? (body as { updates: unknown[] }).updates : [];
  return list.flatMap((raw) => {
    const u = raw as { id?: unknown; conversation?: unknown; text?: unknown; url?: unknown; asks?: unknown };
    const conversation = Number(u?.conversation);
    if (typeof u?.id !== 'string' || !u.id || !Number.isInteger(conversation) || conversation <= 0 || typeof u.text !== 'string' || !u.text.trim()) {
      return [];
    }
    return [{ id: u.id.slice(0, 300), conversation, text: u.text.trim().slice(0, 4000), url: typeof u.url === 'string' && u.url.startsWith('https://') ? u.url : null, asks: u.asks === true }];
  });
}

/**
 * What the agent is handed for an update that asks.
 * @param sourceName - The connected system, as people call it.
 * @param sourceSlug - Its slug, for the tools.
 * @param update - The update.
 */
export function askBrief(sourceName: string, sourceSlug: string, update: McpUpdate): string {
  return [
    `${sourceName} sent this about a request made in this conversation. Nobody here has seen it yet; your reply is what the thread will read.`,
    '',
    update.text,
    '',
    `Read what it waits on first (mcp_read on ${sourceSlug}). If what was already said in this conversation, or what you can read, settles it, answer it now with propose_action mcp.act and say in two lines what was asked and what you answered. If it is a person's decision (a yes to spend, an approval, a choice nobody made yet) or you are not sure, do not answer for them: say what is needed, from whom, and that a reply here mentioning you will be passed on. Keep the link.`,
  ].join('\n');
}

export type McpUpdatesDeps = {
  sources: (orgId: string) => Promise<Array<{ slug: string; name: string; updatesTool: string }>>;
  /** Call the source's updates tool with the ids told last time; the updates it returns now. */
  read: (orgId: string, sourceSlug: string, tool: string, ack: string[]) => Promise<McpUpdate[]>;
  tell: (orgId: string, conversationId: number, text: string, opts: { key: string; url?: string | null }) => Promise<TellResult>;
  /** The conversation's agent reads an update that asks and writes what the thread hears; null when it could not. */
  answer: (orgId: string, conversationId: number, brief: string) => Promise<string | null>;
};

const defaultDeps: McpUpdatesDeps = {
  async sources(orgId) {
    const { listMcpSources } = await import('@/libs/outboundMcp/sources');
    return (await listMcpSources(orgId)).flatMap(s => (s.config.updatesTool && s.config.auth === 'token' ? [{ slug: s.slug, name: s.name, updatesTool: s.config.updatesTool }] : []));
  },
  async read(orgId, sourceSlug, tool, ack) {
    const { callMcpTool, listMcpTools, mcpCredentialsOf, withMcp } = await import('@/libs/outboundMcp/client');
    const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
    const credentials = mcpCredentialsOf(await getCredentialsForSource(orgId, sourceSlug, 'any'));
    return withMcp(credentials, async (client) => {
      const remote = (await listMcpTools(client)).find(t => t.name === tool);
      // The same bar as mcp_read: a tool the provider does not call read-only is not read here.
      if (!remote || remote.annotations?.readOnlyHint !== true) {
        throw new Error(`${tool} is not a read-only tool on ${sourceSlug}`);
      }
      return updatesOf(await callMcpTool(client, remote, ack.length > 0 ? { ack } : {}) as Record<string, unknown>);
    });
  },
  async tell(orgId, conversationId, text, opts) {
    const { tellConversation } = await import('@/services/chat/tellConversation');
    return tellConversation(orgId, conversationId, text, opts);
  },
  async answer(orgId, conversationId, brief) {
    const { getConversation, listMessages, toHistoryTurns } = await import('@/services/ConversationService');
    const conversation = await getConversation({ orgId, id: conversationId });
    if (!conversation?.agentSlug) {
      return null;
    }
    const { runAgentDeep } = await import('@/services/AgentService');
    const { withRunCost } = await import('@/services/budget/runCost');
    const history = toHistoryTurns(await listMessages({ orgId, conversationId }));
    const { result } = await withRunCost({ conversationId }, async () => ({ result: await runAgentDeep({ orgId, agentSlug: conversation.agentSlug!, message: brief, conversationId, conversationHistory: history }) }));
    const text = (result.lastAnswer ?? result.response ?? '').trim();
    return text || null;
  },
};

/**
 * Read every source that reports updates, tell each conversation once, acknowledge what was told.
 * @param orgId - The workspace.
 * @param _input - Unused: the schedule hands nothing over.
 * @param deps - Seams for tests.
 */
export async function runMcpUpdatesJob(orgId: string, _input: Record<string, unknown> = {}, deps: McpUpdatesDeps = defaultDeps): Promise<{ sources: number; told: number; waiting: number; failed: string[] }> {
  const out = { sources: 0, told: 0, waiting: 0, failed: [] as string[] };
  for (const source of await deps.sources(orgId)) {
    out.sources++;
    try {
      const updates = await deps.read(orgId, source.slug, source.updatesTool, []);
      const done: string[] = [];
      for (const update of updates) {
        const key = `mcp:${source.slug}:${update.id}`;
        // The agent's words when the update asks and it could write them; the provider's otherwise.
        const words = update.asks ? await deps.answer(orgId, update.conversation, askBrief(source.name, source.slug, update)).catch(() => null) : null;
        const said = await deps.tell(orgId, update.conversation, words ?? update.text, { key, url: update.url });
        // Told, told before, or nobody left to tell: the provider can stop returning it.
        if (said.said || said.reason === 'already said here' || said.reason === 'the conversation is gone') {
          done.push(update.id);
          out.told += said.said ? 1 : 0;
        } else {
          out.waiting++;
        }
      }
      if (done.length > 0) {
        await deps.read(orgId, source.slug, source.updatesTool, done);
      }
    } catch (error) {
      out.failed.push(`${source.slug}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  return out;
}

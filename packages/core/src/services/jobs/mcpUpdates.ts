/**
 * A CONNECTED SYSTEM TELLS THE THREAD THAT ASKED.
 *
 * A request made of a connected system through `mcp.act` carries the
 * conversation it was asked in (`libs/actions/mcp-act.ts`, `origin`). The
 * system then has things to say to that conversation over days: it needs an
 * answer, it stopped, it shipped. It says so the moment it happens: the
 * provider pings the workspace (`services/outboundMcp/updatesPing.ts`, a
 * signed "check now" at the address this job registered with the source's
 * `updatesWatchTool`) and the source's `updatesTool` is read then. A slow
 * sweep on a schedule is only the net under a lost ping. Each update is said once in the
 * conversation it names, in the app's chat and in its Slack thread
 * (`tellConversation`), and the ids told are acknowledged on the same call
 * next time, so the provider stops returning them.
 *
 * The contract is the source's, not core's: the tool is a declared read the
 * provider marks read-only, it returns `{updates: [{id, conversation, text,
 * url?, asks?}]}`, and it takes `{ack: [ids]}`. Nothing here names a product.
 *
 * THE MESSAGE IS BUILT FROM PARTS (`composeUpdate`). A provider sends a
 * headline, at most one note, links and pictures, and they are posted as
 * sent. AN UPDATE THAT ASKS goes to the agent first: it reads the question
 * with the thread's history and the linked recording, answers the provider
 * itself when the record settles it (through `mcp.act`, on the trust rule),
 * and adds ONE line: what it answered, or its recommendation to the person
 * who decides. The length is set in code. If the agent cannot run, the
 * provider's parts are posted without its line, so a question is never dropped.
 */
import type { TellResult } from '@/services/chat/tellConversation';

export type McpUpdate = {
  id: string;
  conversation: number;
  /** The update in plain words, with the detail the agent reads before it recommends. Posted only when there is no headline. */
  text: string;
  url: string | null;
  asks: boolean;
  /** The one line to show, as the provider wrote it (markdown). With it the message is built from parts, not prose. */
  headline?: string;
  /** At most one more line of fact. */
  note?: string;
  /** What helps the reader act, each a short label. */
  links?: Array<{ label: string; url: string }>;
  /** Public pictures to show under it. */
  images?: Array<{ url: string; caption: string }>;
  /** The page it is about, drawn as a card: the title is the link. */
  preview?: { title: string; url: string; description?: string; imageUrl?: string };
};

/** The longest line an agent may add to a provider's message: its recommendation and the reason. */
export const LINE_MAX = 240;

/**
 * The one line an agent adds: its first line, whole. A line that runs long keeps the sentences
 * that fit; when not even one fits, nothing is added (a recommendation cut mid-thought misleads).
 * @param words - What the agent wrote.
 */
export function oneLine(words: string | null | undefined): string | null {
  const first = (words ?? '').split('\n').map(l => l.trim()).find(Boolean);
  if (!first) {
    return null;
  }
  if (first.length <= LINE_MAX) {
    return first;
  }
  let kept = '';
  for (const sentence of first.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? []) {
    if ((kept + sentence).length > LINE_MAX) {
      break;
    }
    kept += sentence;
  }
  return kept.trim() || null;
}

/**
 * What the thread reads. A provider that sends parts gets them posted as sent, in this order:
 * its headline, the agent's one line (only when a person has to decide), its note, its links.
 * So the length is set here, not by how a model felt that day (Chris, 2026-11-10: nine long
 * messages in one thread). A provider that sends only text is posted as before.
 * @param update - The provider's update.
 * @param agent - What the conversation's agent wrote, and whether it answered the provider itself.
 * @param agent.words - Its words.
 * @param agent.acted - It answered the provider in this turn, so the ask no longer stands.
 */
export function composeUpdate(update: McpUpdate, agent: { words: string; acted: boolean } | null): { text: string; files: Array<{ url: string; caption: string }>; preview?: McpUpdate['preview'] } {
  const files = (update.images ?? []).slice(0, 3);
  const preview = update.preview ? { preview: update.preview } : {};
  if (!update.headline) {
    return { text: agent?.words ?? update.text, files, ...preview };
  }
  const links = (update.links ?? []).map(l => `[${l.label}](${l.url})`).join(' · ');
  const line = oneLine(agent?.words);
  // It answered the provider itself: what it did is the news, not a request that no longer stands.
  if (agent?.acted && line) {
    return { text: [line, links].filter(Boolean).join('\n'), files, ...preview };
  }
  return { text: [update.headline, update.asks ? line : null, update.note, links].filter(Boolean).join('\n'), files, ...preview };
}

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
    const u = raw as { id?: unknown; conversation?: unknown; text?: unknown; url?: unknown; asks?: unknown; headline?: unknown; note?: unknown; links?: unknown; images?: unknown; preview?: { title?: unknown; url?: unknown; description?: unknown; image?: unknown } };
    const conversation = Number(u?.conversation);
    if (typeof u?.id !== 'string' || !u.id || !Number.isInteger(conversation) || conversation <= 0 || typeof u.text !== 'string' || !u.text.trim()) {
      return [];
    }
    const https = (v: unknown): v is string => typeof v === 'string' && v.startsWith('https://');
    const line = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s*\n\s*/g, ' ').trim().slice(0, max) : undefined);
    const links = Array.isArray(u.links) ? u.links.flatMap((l: { label?: unknown; url?: unknown }) => (https(l?.url) && typeof l.label === 'string' && l.label.trim() ? [{ label: l.label.trim().slice(0, 40), url: l.url }] : [])).slice(0, 5) : [];
    const images = Array.isArray(u.images) ? u.images.flatMap((i: { url?: unknown; caption?: unknown }) => (https(i?.url) ? [{ url: i.url, caption: typeof i.caption === 'string' ? i.caption.slice(0, 200) : '' }] : [])).slice(0, 3) : [];
    const card = u.preview && https(u.preview.url) && line(u.preview.title, 200) ? { title: line(u.preview.title, 200)!, url: u.preview.url, ...(line(u.preview.description, 400) ? { description: line(u.preview.description, 400)! } : {}), ...(https(u.preview.image) ? { imageUrl: u.preview.image } : {}) } : null;
    const headline = line(u.headline, 300);
    const note = line(u.note, 300);
    return [{ id: u.id.slice(0, 300), conversation, text: u.text.trim().slice(0, 4000), url: https(u.url) ? u.url : null, asks: u.asks === true, ...(headline ? { headline } : {}), ...(note ? { note } : {}), ...(links.length > 0 ? { links } : {}), ...(images.length > 0 ? { images } : {}), ...(card ? { preview: card } : {}) }];
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
    `${sourceName} says a request made in this conversation is waiting on a person. The thread has not seen it yet.`,
    '',
    update.text,
    '',
    `Read what it waits on first (mcp_read on ${sourceSlug}), and the recording the request came with if a recordings source is connected. If what was already said here, or what you can read, settles it, answer it now with mcp_act.`,
    '',
    // The message is built from the provider's parts; this turn adds one line to it (`composeUpdate`).
    'Then reply with ONE line and nothing else, at most 25 words. No links, no key, no greeting, nothing about how to reply:',
    '- if you answered it yourself: what was asked and what you answered;',
    '- if a person has to decide: their name, your recommendation and the single reason that matters most ("Chris: I\'d approve. It now covers the phone app.");',
    '- if somebody has to answer one thing first: that one question, to them by name.',
  ].join('\n');
}

export type McpUpdatesDeps = {
  sources: (orgId: string) => Promise<Array<{ slug: string; name: string; updatesTool: string; watchTool?: string }>>;
  /** Give the provider the address to ping when it has an update. Idempotent on the provider's side. */
  watch: (orgId: string, sourceSlug: string, tool: string) => Promise<void>;
  /** Call the source's updates tool with the ids told last time; the updates it returns now. */
  read: (orgId: string, sourceSlug: string, tool: string, ack: string[]) => Promise<McpUpdate[]>;
  tell: (orgId: string, conversationId: number, text: string, opts: { key: string; url?: string | null; files?: Array<{ url: string; caption: string }>; preview?: McpUpdate['preview'] }) => Promise<TellResult>;
  /** The conversation's agent reads an update that asks: its words, and whether it answered the provider itself in that turn. Null when it could not run. */
  answer: (orgId: string, conversationId: number, brief: string, sourceSlug: string) => Promise<{ words: string; acted: boolean } | null>;
};

const defaultDeps: McpUpdatesDeps = {
  async sources(orgId) {
    const { listMcpSources } = await import('@/libs/outboundMcp/sources');
    return (await listMcpSources(orgId)).flatMap(s => (s.config.updatesTool && s.config.auth === 'token' ? [{ slug: s.slug, name: s.name, updatesTool: s.config.updatesTool, ...(s.config.updatesWatchTool ? { watchTool: s.config.updatesWatchTool } : {}) }] : []));
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
  async watch(orgId, sourceSlug, tool) {
    const { updatesHookUrl } = await import('@/services/outboundMcp/updatesPing');
    const url = updatesHookUrl(orgId, sourceSlug);
    if (!url) {
      return;
    }
    const { callMcpTool, listMcpTools, mcpCredentialsOf, withMcp } = await import('@/libs/outboundMcp/client');
    const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
    const credentials = mcpCredentialsOf(await getCredentialsForSource(orgId, sourceSlug, 'any'));
    await withMcp(credentials, async (client) => {
      const remote = (await listMcpTools(client)).find(t => t.name === tool);
      if (remote) {
        await callMcpTool(client, remote, { url });
      }
    });
  },
  async tell(orgId, conversationId, text, opts) {
    const { tellConversation } = await import('@/services/chat/tellConversation');
    return tellConversation(orgId, conversationId, text, opts);
  },
  async answer(orgId, conversationId, brief, sourceSlug) {
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
    if (!text) {
      return null;
    }
    // Whether it answered the provider itself, read off the turn's own tool calls, never off its words.
    // "is DONE" is our own proposal tool's line for an action that ran (`proposeAction.ts`), not a model's.
    const acted = (result.toolCalls ?? []).some((c) => {
      const args = JSON.stringify(c.input ?? {});
      const ran = typeof c.output === 'string' && c.output.includes('mcp.act is DONE');
      return ran && args.includes(`"${sourceSlug}"`) && (c.tool === 'mcp_act' || (c.tool === 'propose_action' && args.includes('"mcp.act"')));
    });
    return { words: text, acted };
  },
};

/**
 * Read every source that reports updates, tell each conversation once, acknowledge what was told.
 * @param orgId - The workspace.
 * @param input - `source` when one source pinged (only it is read); nothing on the sweep, which reads every source and renews each one's ping address.
 * @param deps - Seams for tests.
 */
export async function runMcpUpdatesJob(orgId: string, input: Record<string, unknown> = {}, deps: McpUpdatesDeps = defaultDeps): Promise<{ sources: number; told: number; waiting: number; failed: string[] }> {
  const out = { sources: 0, told: 0, waiting: 0, failed: [] as string[] };
  const only = typeof input.source === 'string' && input.source ? input.source : null;
  for (const source of (await deps.sources(orgId)).filter(s => !only || s.slug === only)) {
    out.sources++;
    // The sweep is also where the provider learns (again) where to ping; a ping-driven read does not repeat it.
    if (!only && source.watchTool) {
      await deps.watch(orgId, source.slug, source.watchTool).catch((error) => {
        out.failed.push(`${source.slug}: could not register for pings (${error instanceof Error ? error.message : 'failed'})`);
      });
    }
    try {
      const updates = await deps.read(orgId, source.slug, source.updatesTool, []);
      const done: string[] = [];
      for (const update of updates) {
        const key = `mcp:${source.slug}:${update.id}`;
        // The agent adds its one line when the update asks and it could run; the provider's parts stand without it.
        const agent = update.asks ? await deps.answer(orgId, update.conversation, askBrief(source.name, source.slug, update), source.slug).catch(() => null) : null;
        const message = composeUpdate(update, agent);
        const said = await deps.tell(orgId, update.conversation, message.text, { key, url: update.url, ...(message.files.length > 0 ? { files: message.files } : {}), ...(message.preview ? { preview: message.preview } : {}) });
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

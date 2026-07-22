/**
 * Phase 4 SSE route — agent stream with the deepagents runtime.
 *
 * Wire format: true `text/event-stream` (vs. the legacy
 * `/rpc/agent` route which streams newline-delimited JSON). Each
 * agent event is one `data: <json>\n\n` block. 15-second keepalive
 * comments (`: keepalive\n\n`) defeat proxy idle-drops on Tailscale
 * Funnel, Cloudflare, mobile carriers, iOS Safari. Pattern ports
 * from rev-ai's server/main.py:1285-1379.
 *
 * Opt-in: only the front-end paths that target this route get the
 * new runtime. The legacy `/rpc/agent` route keeps the old
 * `runAgent` engine until we flip the default.
 */

import type { AgentEvent } from '@/services/agents/types';
import type { ConversationRun } from '@/services/ConversationService';
import { clerkAuth as auth } from '@/libs/Auth';
import { listAgents, runAgentDeep } from '@/services/AgentService';
import {
  appendMessage,

  createConversation,
  getConversation,
  listMessages,
  toHistoryTurns,
} from '@/services/ConversationService';

const KEEPALIVE_INTERVAL_MS = 15_000;

/**
 * Buffer streaming text + tool events into the runsJson shape so the
 * assistant turn can be persisted at end-of-stream. Mirrors rev-ai's
 * `_RunCollector` (server/main.py:1182-1212).
 */
type CollectedDoc = { document_id: string; semantic_identifier: string; link: string; source_type: string; blurb: string; citationIndex?: number; foundBy?: string };

class RunCollector {
  private runs: ConversationRun[] = [];
  private currentText: string | null = null;
  private documents: CollectedDoc[] = [];
  private readonly docKeys = new Set<string>();

  onDocuments(docs: CollectedDoc[]): void {
    for (const d of docs) {
      const key = `${d.citationIndex ?? ''}:${d.document_id}:${d.semantic_identifier}`;
      if (!this.docKeys.has(key)) {
        this.docKeys.add(key);
        this.documents.push(d);
      }
    }
  }

  onTextDelta(delta: string): void {
    if (!delta) {
      return;
    }
    this.currentText = (this.currentText ?? '') + delta;
  }

  onToolStart(name: string, input: Record<string, unknown>): void {
    this.flushText();
    this.runs.push({ type: 'tool', name, input });
  }

  onToolEnd(name: string, output: string): void {
    // Attach the output to the most recent matching tool run, if found.
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i];
      if (r && r.type === 'tool' && r.name === name && !r.output) {
        r.output = output.slice(0, 4000);
        return;
      }
    }
  }

  private flushText(): void {
    if (this.currentText !== null) {
      const t = this.currentText;
      if (t.trim()) {
        this.runs.push({ type: 'text', text: t });
      }
      this.currentText = null;
    }
  }

  finalise(): { text: string; runs: ConversationRun[]; documents: CollectedDoc[] } {
    this.flushText();
    const text = this.runs
      .filter((r): r is { type: 'text'; text: string } => r.type === 'text')
      .map(r => r.text)
      .join('\n\n')
      .trim();
    return { text, runs: this.runs, documents: this.documents };
  }
}

export async function POST(request: Request): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  // Per-user connection ACL: everything this member's chat retrieves is
  // constrained to their granted sources (restricted connections drop out).
  const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
  const allowedSourceSlugs = await allowedSourceSlugsForUser(orgId, userId);

  const body = await request.json();
  const message = body.message as string;
  // Resolve the agent. Explicit `agent_slug` wins; otherwise fall back
  // to the first agent for this project. 404 when zero agents authored
  // — the pre-v0.5.2 hardcoded "sales-assistant" fallback is gone.
  let agentSlug = body.agent_slug as string | undefined;
  if (!agentSlug) {
    const agents = await listAgents(orgId);
    if (agents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No agents authored for this project. See /dashboard/chat for setup.' }),
        { status: 404 },
      );
    }
    agentSlug = agents[0]!.slug;
  }
  const clientHistory = (body.conversation_history as Array<{ role: 'user' | 'assistant'; content: string }>) ?? [];
  // Optional persistence — when the client supplies a conversation_id
  // we replay server-side history (authoritative) and persist the new
  // turn(s) on stream completion. When omitted, the route still works
  // but the conversation is ephemeral.
  const conversationIdRaw = body.conversation_id;
  let conversationId: number | null = null;
  if (typeof conversationIdRaw === 'number') {
    const existing = await getConversation({ orgId, id: conversationIdRaw });
    conversationId = existing ? existing.id : null;
  }
  if (conversationId === null && body.create_conversation === true) {
    const conv = await createConversation({
      orgId,
      agentSlug,
      createdBy: userId,
    });
    conversationId = conv.id;
  }

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: 'Message required' }), { status: 400 });
  }

  // Authoritative history: when a conversation is attached, use the
  // persisted message log and ignore whatever the client sent. Tool
  // entries are dropped via toHistoryTurns so the agent doesn't see
  // its own UI ornaments echoed back.
  let conversationHistory = clientHistory;
  if (conversationId !== null) {
    const msgs = await listMessages({ orgId, conversationId });
    conversationHistory = toHistoryTurns(msgs);
    await appendMessage({
      orgId,
      conversationId,
      role: 'user',
      content: message,
      userId,
    });
  }

  const collector = conversationId !== null ? new RunCollector() : null;
  const encoder = new TextEncoder();

  // Multiplex the agent event stream + a 15s keepalive timer into one
  // ReadableStream. Whichever fires first gets written; on disconnect
  // we cancel both. (See ADR 0001 §2 — keepalives.)
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (!closed) {
          try {
            controller.enqueue(chunk);
          } catch {
            closed = true;
          }
        }
      };

      const sendEvent = (event: AgentEvent) => {
        // Tee certain events into the RunCollector for persistence.
        if (collector) {
          if (event.type === 'response_delta') {
            collector.onTextDelta(event.delta);
          } else if (event.type === 'tool_start') {
            collector.onToolStart(event.tool, event.input);
          } else if (event.type === 'tool_end') {
            collector.onToolEnd(event.tool, event.output);
          } else if (event.type === 'documents') {
            collector.onDocuments(event.documents as CollectedDoc[]);
          }
        }
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const keepaliveTimer = setInterval(() => {
        safeEnqueue(encoder.encode(': keepalive\n\n'));
      }, KEEPALIVE_INTERVAL_MS);

      try {
        await runAgentDeep({
          allowedSourceSlugs,
          orgId,
          agentSlug,
          message,
          userId,
          conversationId: conversationId ?? undefined,
          conversationHistory,
          onEvent: sendEvent,
        });
      } catch (err) {
        const m = (err as Error).message ?? 'agent error';
        sendEvent({ type: 'error', message: m });
      } finally {
        clearInterval(keepaliveTimer);
        // Persist the assistant turn now that the stream is closing.
        if (collector && conversationId !== null) {
          const { text, runs, documents } = collector.finalise();
          if (text || runs.length > 0) {
            try {
              await appendMessage({
                orgId,
                conversationId,
                role: 'assistant',
                content: text,
                runs,
                documents,
              });
            } catch {
              /* conversation may have been deleted mid-stream */
            }
          }
        }
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      // Client disconnected; the producer above will see `closed`
      // turn true on the next emit and stop writing. We rely on the
      // outer Promise to settle before the route returns.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Prevent compression buffers from holding events. Some proxies
      // require this header on text/event-stream specifically.
      'X-Accel-Buffering': 'no',
    },
  });
}

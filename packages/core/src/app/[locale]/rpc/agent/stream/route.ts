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
import type { CollectedDoc } from '@/services/chat/runCollector';
import { clerkAuth as auth } from '@/libs/Auth';
import { openStream } from '@/libs/streams/buffer';
import { track } from '@/services/adoption/track';
import { listAgents, runAgentDeep } from '@/services/AgentService';
import { stampArtifactsWithMessage } from '@/services/ArtifactService';
import { RunCollector } from '@/services/chat/runCollector';
import {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
  setConversationContextIfEmpty,
  toHistoryTurns,
} from '@/services/ConversationService';

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function POST(request: Request): Promise<Response> {
  const { userId, orgId, role } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  // Per-user connection ACL: everything this member's chat retrieves is
  // constrained to their granted sources (restricted connections drop out).
  const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
  const allowedSourceSlugs = await allowedSourceSlugsForUser(orgId, userId);

  const body = await request.json();
  const message = body.message as string;
  // Where the person is when they ask (058): the everything-scoped dock off a
  // record page sends it; the model reads it under the message, the log
  // keeps the message as typed.
  const { mergeScopeRef, readContextRefs, readPageContext, withPageContext } = await import('@/services/chat/pageContext');
  const { autoProposeRecommendation, readAutonomy } = await import('@/services/chat/autoPropose');
  // Structured (R4): page + record + highlighted passage + @-mentions. A
  // scoped dock's `scope_ref` folds in as a ref instead of excluding it.
  const pageContext = mergeScopeRef(readPageContext(body.page_context), typeof body.scope_ref === 'string' ? body.scope_ref : null);
  // `@` tags (§9.10): besides routing the turn's `agent_slug`, the tagged
  // records reach the model as a note under the message.
  const contextRefs = readContextRefs(body.context_refs);
  // P0 (personalization-v2): the ARTIFACTS the page is showing travel with the
  // turn, resolved from the store under this org rather than described by the
  // client, and declared canonical. This is what stops the rail answering
  // "there's no brief or proposal to review here" beside a page rendering one.
  // Grounding, not rendering: #378's rule that the rail never re-draws the
  // page is untouched.
  const { buildGrounding } = await import('@/services/chat/grounding');
  const grounding = await buildGrounding(orgId, pageContext);
  // What the turn OWES (0102): the composer's `@artifact` tag, sent as a typed
  // field so "did this turn produce an artifact" is a contract the harness
  // enforces rather than something the model decided while it was busy.
  const { readDeliverable } = await import('@/libs/chat/deliverable');
  const deliverable = readDeliverable(body.deliverable);
  // Resolve the agent. Explicit `agent_slug` wins (an `@mention` routes one
  // turn); otherwise the WORKSPACE AGENT answers — the project's lead
  // (agent-chat-surface.md §9.10), falling back to the first agent when no
  // lead is configured. 404 when zero agents authored.
  let agentSlug = body.agent_slug as string | undefined;
  if (!agentSlug) {
    const agents = await listAgents(orgId);
    if (agents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No agents authored for this project. See /dashboard/chat for setup.' }),
        { status: 404 },
      );
    }
    const { getWorkspaceLead } = await import('@/services/TeamService');
    const lead = await getWorkspaceLead(orgId);
    agentSlug = (lead.leadAgentSlug && agents.some(a => a.slug === lead.leadAgentSlug)) ? lead.leadAgentSlug : agents[0]!.slug;
  }
  const clientHistory = (body.conversation_history as Array<{ role: 'user' | 'assistant'; content: string }>) ?? [];
  // Optional persistence — when the client supplies a conversation_id
  // we replay server-side history (authoritative) and persist the new
  // turn(s) on stream completion. When omitted, the route still works
  // but the conversation is ephemeral.
  const conversationIdRaw = body.conversation_id;
  let conversationId: number | null = null;
  // Conversation autonomy (R2 adds the column; until then the client may send
  // it per turn). `act-within-bounds` files recommendations into the review
  // queue as they are emitted — still pending, still a person's decision.
  let autonomy = readAutonomy(body.autonomy);
  if (typeof conversationIdRaw === 'number') {
    const existing = await getConversation({ orgId, id: conversationIdRaw, requestedBy: userId });
    conversationId = existing ? existing.id : null;
    if (existing && 'autonomy' in existing) {
      autonomy = readAutonomy((existing as { autonomy?: unknown }).autonomy);
    }
    if (existing && pageContext && !existing.contextJson) {
      await setConversationContextIfEmpty({ orgId, id: existing.id, context: pageContext });
    }
  }
  if (conversationId === null && body.create_conversation === true) {
    const conv = await createConversation({
      orgId,
      agentSlug,
      createdBy: userId,
      context: pageContext,
    });
    conversationId = conv.id;
  }
  if (pageContext?.openedFrom && pageContext.record) {
    void track({ orgId, userId }, 'chat.opened_from_context', {
      agentSlug,
      meta: { recordType: pageContext.record.type },
      ...(conversationId !== null ? { resource: ['conversation', conversationId] as [string, number] } : {}),
    });
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
    const msgs = await listMessages({ orgId, conversationId, requestedBy: userId });
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

  // Resumable stream: buffer every event of this turn so a client that drops
  // (refresh / phone lock) can replay what it missed and re-attach LIVE via
  // /rpc/agent/stream/resume. stream_meta tells the client its stream id.
  const streamId = crypto.randomUUID();
  const buffered = openStream(streamId);

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

      const writeEvent = (event: AgentEvent) => {
        buffered.append(JSON.stringify(event));
        // Tee certain events into the RunCollector for persistence.
        if (collector) {
          if (event.type === 'response_delta') {
            collector.onTextDelta(event.delta);
          } else if (event.type === 'tool_start') {
            collector.onToolStart(event.tool, event.input);
          } else if (event.type === 'tool_end') {
            collector.onToolEnd(event.tool, event.output);
          } else if (event.type === 'tool_error') {
            collector.onToolError(event.tool, event.message);
          } else if (event.type === 'documents') {
            collector.onDocuments(event.documents as CollectedDoc[]);
          } else if (event.type === 'trace_node') {
            collector.onTraceNode(event as unknown as Record<string, unknown>);
          } else if (event.type === 'artifact' && !event.pending) {
            collector.onArtifact(event.artifact.id);
          }
        }
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      // Recommendations under `act-within-bounds` are filed first, then sent
      // with their run id, so the card renders queue status from frame one.
      // The proposal is awaited before the frame goes out; the turn's other
      // events keep flowing — `pending` tracks the in-flight ones so the
      // finaliser waits for them before closing the stream.
      const pending: Promise<void>[] = [];
      const sendEvent = (event: AgentEvent) => {
        if (event.type === 'recommended_action' && autonomy === 'act-within-bounds' && event.recommendation.runId === undefined) {
          pending.push((async () => {
            const runId = await autoProposeRecommendation({ orgId, userId, rec: event.recommendation });
            writeEvent(runId === null ? event : { ...event, recommendation: { ...event.recommendation, runId } });
          })());
          return;
        }
        writeEvent(event);
      };

      const keepaliveTimer = setInterval(() => {
        safeEnqueue(encoder.encode(': keepalive\n\n'));
      }, KEEPALIVE_INTERVAL_MS);

      // First frame: the resume handle (not part of the AgentEvent union —
      // the client stashes it and never reduces it into the transcript).
      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'stream_meta', streamId })}\n\n`));

      // Resume (0123). The connector the last turn needed is connected now, so
      // the call the stub intercepted is MADE — here, with the arguments the
      // model already chose — and its output is handed to the turn as
      // grounding. The turn that showed the card is the turn that answers, and
      // the model never has to decide the same thing twice.
      //
      // Failure is never fatal: every `ok: false` reason falls through to an
      // ordinary turn, which is resume v1 and still correct.
      //
      // `resume_intent` is either the id the card held, or `'pending'` — which
      // is what the OAuth return uses, because the browser left the page and
      // came back and no longer holds the id. Either way the intent is looked
      // up server-side for THIS person in THIS thread, so the request cannot
      // name somebody else's.
      let replayGrounding = '';
      if (typeof body.resume_intent === 'number' || body.resume_intent === 'pending') {
        const { pendingIntent } = await import('@/services/agents/connectionIntent');
        const { groundingFromReplay, replayIntent } = await import('@/services/agents/resume');
        const intent = await pendingIntent({ orgId, userId, conversationId });
        if (intent && (body.resume_intent === 'pending' || intent.id === body.resume_intent)) {
          const replayed = await replayIntent({
            orgId,
            agentSlug,
            actor: { kind: 'user', id: userId },
            role,
            intent,
          });
          if (replayed.ok) {
            replayGrounding = `\n\n${groundingFromReplay(replayed.tool, replayed.output)}`;
            for (const event of replayed.events) {
              sendEvent(event);
            }
          }
        }
      }

      try {
        await runAgentDeep({
          allowedSourceSlugs,
          orgId,
          agentSlug,
          message: withPageContext(message, pageContext, contextRefs, grounding.text) + replayGrounding,
          userId,
          // The one caller that holds a verified session. Everything else runs
          // as the system and reaches no personal grant.
          actor: { kind: 'user', id: userId },
          role,
          conversationId: conversationId ?? undefined,
          conversationHistory,
          pageContext: pageContext ?? undefined,
          ...(deliverable ? { deliverable } : {}),
          onEvent: sendEvent,
        });
      } catch (err) {
        const m = (err as Error).message ?? 'agent error';
        sendEvent({ type: 'error', message: m });
      } finally {
        clearInterval(keepaliveTimer);
        await Promise.allSettled(pending);
        // Tell the client the turn is OVER before doing anything slow.
        //
        // This route used to signal completion only by closing the stream —
        // and the close happens after an awaited database write. So between
        // the last token and that write landing, the client held an open
        // connection with no events and no terminal signal, and the rail
        // showed "Working…" over a turn that had visibly finished. Chris,
        // 2026-09-17: *"this chat action, stuck in 'working…' I think it's
        // done."* It was.
        //
        // `done` is already the client's terminal event (`useChatSession`
        // finalises the trace and clears the phase on it), so emitting it here
        // costs nothing and decouples "the answer is complete" from "the row
        // is persisted" — which were never the same fact.
        // `response` is the turn's text; the collector already holds it, and
        // the client backfills from its own streamed runs anyway.
        sendEvent({ type: 'done', response: collector?.finalise().text ?? '' });
        buffered.close();
        // Persist the assistant turn now that the stream is closing.
        if (collector && conversationId !== null) {
          const { text, runs, documents, trace } = collector.finalise();
          if (text || runs.length > 0) {
            try {
              const msg = await appendMessage({
                orgId,
                conversationId,
                role: 'assistant',
                content: text,
                runs,
                documents,
                trace,
              });
              const touched = collector.touchedArtifactIds;
              if (touched.length > 0) {
                await stampArtifactsWithMessage({ orgId, artifactIds: touched, messageId: msg.id });
              }
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

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

import type { Card } from '@/libs/cards/card';
import type { AgentEvent } from '@/services/agents/types';
import type { RunCostScope } from '@/services/budget/runCost';
import type { HistoryTurn } from '@/services/chat/historyTools';
import type { CollectedDoc } from '@/services/chat/runCollector';
import type { TurnStatus } from '@/services/chat/turnStatus';
import { clerkAuth as auth } from '@/libs/Auth';
import { cardFromRecommendation } from '@/libs/cards/card';
import { openStream, wasStopped } from '@/libs/streams/buffer';
import { track } from '@/services/adoption/track';
import { isTurnRefusal } from '@/services/agents/turnRefusal';
import { listAgents, runAgentDeep } from '@/services/AgentService';
import { claimAttachments, listArtifactsByIds, listAttachmentsByMessage, stampArtifactsWithMessage } from '@/services/ArtifactService';
import { withRunCost } from '@/services/budget/runCost';
import { cardAsRecommendation, surfaceCard } from '@/services/cards/surface';
import { historyMarker, loadedFromArtifact } from '@/services/chat/attachments';
import { scheduleConversationTitle } from '@/services/chat/conversationTitle';
import { RunCollector } from '@/services/chat/runCollector';
import { beginTurn, finishTurn, recordTurnProgress } from '@/services/chat/turnLedger';
import { stoppedShort } from '@/services/chat/turnStatus';
import {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
  setConversationAutonomy,
  setConversationContextIfEmpty,
  toHistoryTurns,
} from '@/services/ConversationService';

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function POST(request: Request): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const body = await request.json();
  // The reads that do not depend on who answers start now, together, and are
  // awaited where they are used: before they ran one after another, and the
  // first turn's routing read (a model call) waited behind all of them.
  // `started` keeps a read that an early return never awaits from surfacing
  // as an unhandled rejection; the await below still throws.
  const started = <T>(promise: Promise<T>): Promise<T> => {
    promise.catch(() => {});
    return promise;
  };
  const conversationIdAsked = typeof body.conversation_id === 'number' ? body.conversation_id as number : null;
  // Per-user connection ACL: everything this member's chat retrieves is
  // constrained to their granted sources (restricted connections drop out).
  const allowedSourceSlugsRead = started(import('@/services/SourceAccessService').then(m => m.allowedSourceSlugsForUser(orgId, userId)));
  const rosterRead = started(listAgents(orgId));
  const leadRead = started(import('@/services/TeamService').then(m => m.getWorkspaceLead(orgId)));
  const existingRead = started(conversationIdAsked !== null ? getConversation({ orgId, id: conversationIdAsked, viewerId: userId }) : Promise.resolve(null));
  // The thread's log is read before this turn's message is appended below,
  // so it is the history up to, not including, this turn.
  const historyRead = started(conversationIdAsked !== null
    ? Promise.all([listMessages({ orgId, conversationId: conversationIdAsked }), listAttachmentsByMessage({ orgId, conversationId: conversationIdAsked })])
    : Promise.resolve(null));
  const message = body.message as string;
  // Where the person is when they ask (058): the everything-scoped dock off a
  // record page sends it; the model reads it under the message, the log
  // keeps the message as typed.
  const { mergeScopeRef, readContextRefs, readPageContext, withPageContext } = await import('@/services/chat/pageContext');
  const { fileRecommendation, readAutonomy } = await import('@/services/chat/autoPropose');
  // Structured (R4): page + record + highlighted passage + @-mentions. A
  // scoped dock's `scope_ref` folds in as a ref instead of excluding it.
  // The page's record, typed: `/dashboard/p/feature/124` is request 124, read
  // off the workspace's page manifest and the row — never "a feature record"
  // (`services/chat/pageRecord.ts`, conversation 355).
  const { pageRecordDepsFor, typePageRecord } = await import('@/services/chat/pageRecord');
  const pageContext = mergeScopeRef(await typePageRecord(readPageContext(body.page_context), pageRecordDepsFor(orgId)), typeof body.scope_ref === 'string' ? body.scope_ref : null);
  // The person's zone, from the browser — the day boundary for this turn's
  // dates. Invalid or missing falls back to the workspace's.
  const { isValidTimeZone } = await import('@/libs/time/zone');
  const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
  const timeZone: string = isValidTimeZone(body.time_zone) ? body.time_zone : await workspaceTimeZone(orgId);
  // `@` tags (§9.10): besides routing the turn's `agent_slug`, the tagged
  // records reach the model as a note under the message.
  const contextRefs = readContextRefs(body.context_refs);
  // P0 (personalization-v2): the ARTIFACTS the page is showing travel with the
  // turn, resolved from the store under this org rather than described by the
  // client, and declared canonical. This is what stops the rail answering
  // "there's no brief or proposal to review here" beside a page rendering one.
  // Grounding, not rendering: #378's rule that the rail never re-draws the
  // page is untouched.
  const groundingRead = started(import('@/services/chat/grounding').then(m => m.buildGrounding(orgId, pageContext)));
  // What the turn OWES (0102): the composer's `@artifact` tag, sent as a typed
  // field so "did this turn produce an artifact" is a contract the harness
  // enforces rather than something the model decided while it was busy.
  const { readDeliverable } = await import('@/libs/chat/deliverable');
  const deliverable = readDeliverable(body.deliverable);
  // Resolve the agent. Explicit `agent_slug` wins (an `@mention` routes one
  // turn); otherwise the WORKSPACE AGENT answers — the project's lead
  // (agent-chat-surface.md §9.10), falling back to the first agent when no
  // lead is configured. 404 when zero agents authored.
  //
  // `route: true` asks the workspace to choose: a small model reads the
  // message against the roster and what each seat owns, and the lead answers
  // when it is unsure; the keyword scorer is only its fallback
  // (`services/agents/router.ts`, conversation 397). The decision is the turn's first frame and
  // is written on the person's message, so "why did this agent answer" has an
  // answer a person can read. Sent by the composer when the person picked no
  // agent; absent, the lead answers as before.
  let agentSlug = body.agent_slug as string | undefined;
  let routing: import('@/services/agents/router').RoutingDecision | null = null;
  // The first turn's model read, when nothing structural decided. Not awaited
  // here: the lead's turn starts while it reads (`headStart` below).
  let routerRead: Promise<import('@/services/agents/router').RoutingDecision | null> | null = null;
  const roster = await rosterRead;
  if (!agentSlug || body.route === true) {
    const agents = roster;
    if (agents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No agents authored for this project. See /dashboard/chat for setup.' }),
        { status: 404 },
      );
    }
    const lead = await leadRead;
    if (body.route === true && typeof message === 'string' && message.trim()) {
      const { followUpDecision, pageOwnerDecision, recordOwnerSlug, routableFromRow, routeFirstTurn } = await import('@/services/agents/router');
      // A follow-up stays with the agent the thread is with; the router
      // picks only a conversation's first turn, or an agent the person names
      // (conversation 349: "Please file it now." left the product manager's
      // thread for change-reviewer on a keyword score).
      const { threadAgentOf } = await import('@/services/ConversationService');
      const threadAgent = typeof body.conversation_id === 'number' ? await threadAgentOf({ orgId, id: body.conversation_id }) : null;
      const routable = agents.map(routableFromRow);
      // On a record's page the record's owner answers the first turn — the
      // page is the context, a keyword is not (conversation 362).
      const pageRecord = pageContext?.record?.objectType ? { objectType: pageContext.record.objectType, id: pageContext.record.id } : null;
      routing = followUpDecision({ agents: routable, message, threadAgent, surface: 'chat' })
        ?? pageOwnerDecision({ agents: routable, message, record: pageRecord, ownerSlug: pageRecord ? await recordOwnerSlug(orgId, pageRecord.objectType) : null, surface: 'chat' });
      // Otherwise the first turn is read by a model against the roster and
      // what each seat owns (conversation 397: "file it and build it" went
      // to the wiki researcher on a keyword score).
      if (!routing) {
        routerRead = started(routeFirstTurn({ orgId, agents: routable, message, leadSlug: lead.leadAgentSlug, surface: 'chat' }));
      }
    }
    agentSlug = routing?.chosen
      ?? ((lead.leadAgentSlug && agents.some(a => a.slug === lead.leadAgentSlug)) ? lead.leadAgentSlug : agents[0]!.slug);
  }
  // While the router reads, `agentSlug` is the lead: who answers when it is
  // unsure, and who answers most first turns.
  const clientHistory = (body.conversation_history as HistoryTurn[]) ?? [];
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
  // How strong a model, how much it thinks — the thread's own setting wins
  // over what the client sent, exactly as autonomy does.
  const { readModelPrefs } = await import('@/libs/llm/modelPrefs');
  let modelPrefs = readModelPrefs(body);
  if (typeof conversationIdRaw === 'number') {
    const existing = await existingRead;
    conversationId = existing ? existing.id : null;
    if (existing && 'autonomy' in existing) {
      autonomy = readAutonomy((existing as { autonomy?: unknown }).autonomy);
    }
    if (existing && ((existing as { modelStrength?: unknown }).modelStrength || (existing as { thinkingEffort?: unknown }).thinkingEffort)) {
      modelPrefs = readModelPrefs(existing);
    }
    if (existing && pageContext && !existing.contextJson) {
      await setConversationContextIfEmpty({ orgId, id: existing.id, context: pageContext });
    }
  }
  // A new thread is created here, with its turn, rather than by a round trip
  // of its own before it (`useChatSession`). Its agent is the one the
  // composer named, as that call recorded; the turn's speaker is on the rows.
  if (conversationId === null && body.create_conversation === true) {
    const conv = await createConversation({
      orgId,
      agentSlug: typeof body.agent_slug === 'string' && body.agent_slug ? body.agent_slug : agentSlug,
      createdBy: userId,
      context: pageContext,
      ...(typeof body.scope_ref === 'string' && body.scope_ref ? { scopeRef: body.scope_ref.slice(0, 120) } : {}),
    });
    conversationId = conv.id;
    // The person's standing choice, when it is not the default the row is
    // born with (`conversations.setAutonomy`'s vocabulary).
    if (body.conversation_autonomy === 'ask') {
      await setConversationAutonomy({ orgId, id: conv.id, autonomy: 'ask' });
      autonomy = readAutonomy('ask');
    }
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

  // Files the person attached: artifact ids from `/api/chat/attachments`,
  // resolved under THIS org (an id that is not ours is silently absent) and
  // only if they are human uploads — the model is never handed an agent's
  // artifact because a client named its id here.
  const attachmentIds = Array.isArray(body.attachments)
    ? (body.attachments as unknown[]).filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0).slice(0, 10)
    : [];
  const attachments = attachmentIds.length > 0
    ? (await listArtifactsByIds({ orgId, ids: attachmentIds }))
        .filter(row => row.kind === 'file' && row.lastAuthorKind === 'human')
        .map(loadedFromArtifact)
    : [];

  // Authoritative history: when a conversation is attached, use the
  // persisted message log and ignore whatever the client sent. Tool
  // entries are dropped via toHistoryTurns so the agent doesn't see
  // its own UI ornaments echoed back.
  let conversationHistory = clientHistory;
  if (conversationId !== null) {
    // A conversation created just above for this turn has no log yet.
    const [msgs, uploads] = conversationId === conversationIdAsked && (await historyRead)
      ? (await historyRead)!
      : await Promise.all([listMessages({ orgId, conversationId }), listAttachmentsByMessage({ orgId, conversationId })]);
    // A past message that carried files says so in the replay — the names,
    // not the contents — so the agent asks rather than guesses.
    // Stamped with when each turn was sent, so the model can tell yesterday's
    // question from one asked a minute ago (`toHistoryTurns`).
    // …and each agent turn carries its runs, replayed as the tool calls and
    // cards they were — see `services/chat/historyTools.ts`.
    conversationHistory = toHistoryTurns(msgs.map(m => ({ ...m, content: `${m.content}${historyMarker(uploads.get(m.id) ?? [])}` })), { timeZone });
  }

  // A correction: last turn the agent said something could not be found, and
  // this message hands it over. The agent is told to own it, and a learning
  // candidate is drafted in the background (`correctionReflector.ts`).
  let messageForModel = message;
  let absenceCorrected = false;
  const { correctionNote, detectCorrection, reflectOnCorrection } = await import('@/services/chat/correctionReflector');
  const correction = detectCorrection([...conversationHistory].reverse().find(t => t.role === 'assistant')?.content, message);
  if (correction) {
    absenceCorrected = true;
    messageForModel = `${message}\n\n${correctionNote(correction)}`;
  }

  const [allowedSourceSlugs, grounding] = await Promise.all([allowedSourceSlugsRead, groundingRead]);

  // The turn, for whichever agent answers. Its events go to `sink` once the
  // stream is open; until then they wait in `early`, in order.
  const early: AgentEvent[] = [];
  let sink: ((event: AgentEvent) => void) | null = null;
  const onEvent = (event: AgentEvent) => (sink ? sink(event) : early.push(event));
  // What the turn spent, counted while it runs (`budget/runCost.ts`).
  const turnCost: { cost: RunCostScope | null } = { cost: null };
  const modelMessage = withPageContext(messageForModel, pageContext, contextRefs, grounding.text);
  const runTurn = (slug: string, hold?: Promise<boolean>) => {
    const turn = () => runAgentDeep({
      allowedSourceSlugs,
      orgId,
      agentSlug: slug,
      message: modelMessage,
      userId,
      conversationId: conversationId ?? undefined,
      conversationHistory,
      pageContext: pageContext ?? undefined,
      timeZone,
      ...(deliverable ? { deliverable } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      modelPrefs,
      onEvent,
      ...(hold ? { hold } : {}),
    });
    // What this turn cost — its own model calls and every specialist it
    // delegated to — is counted while it runs and written with the
    // answer (`services/budget/runCost.ts`).
    const id = conversationId;
    return id === null
      ? turn()
      : withRunCost({ conversationId: id }, (scope) => {
          turnCost.cost = scope;
          return turn();
        });
  };

  // A HEAD START. While the router reads (about a second on a small model),
  // the lead's turn is already running: its model starts, no tool runs
  // (`agents/turnGate.ts`), and nothing it says is sent. The router picks the
  // lead on most first turns, and then the answer is that much nearer; when
  // it picks someone else the lead's turn is stopped and dropped, costing the
  // tokens it read. Chris, 2026-10-04: "yes on start default".
  let headStart: ReturnType<typeof runTurn> | null = null;
  let commit: (keep: boolean) => void = () => {};
  if (routerRead) {
    const lead = agentSlug;
    headStart = runTurn(lead, new Promise<boolean>((resolve) => {
      commit = resolve;
    }));
    headStart.catch(() => {});
    routing = await routerRead;
    agentSlug = routing?.chosen ?? lead;
    if (agentSlug !== lead) {
      commit(false);
      headStart = null;
      early.length = 0;
    }
  }
  if (correction) {
    void reflectOnCorrection({ orgId, agentSlug, userId, correction }).catch(() => {});
  }
  const routedAgent = routing ? roster.find(a => a.slug === routing!.chosen) ?? null : null;
  // Who speaks this turn, as a fact the client renders and the row records —
  // never a guess the composer made from its tags before the turn ran
  // (backlog 009). The name is the roster's; a slug the roster no longer
  // knows is sent as itself and the client says so rather than inventing one.
  const turnAgent = { slug: agentSlug, name: roster.find(a => a.slug === agentSlug)?.name ?? agentSlug };

  // The person's message is on the log, with who was picked and why, before
  // any tool of the turn may read the thread.
  let userMessageId: number | null = null;
  if (conversationId !== null) {
    try {
      const userMsg = await appendMessage({
        orgId,
        conversationId,
        role: 'user',
        content: message,
        userId,
        ...(routing ? { routing } : {}),
      });
      userMessageId = userMsg.id;
      if (attachments.length > 0) {
        await claimAttachments({ orgId, artifactIds: attachments.map(a => a.id), conversationId, messageId: userMsg.id });
      }
    } catch (error) {
      commit(false);
      throw error;
    }
  }
  commit(true);

  const collector = conversationId !== null ? new RunCollector() : null;
  const encoder = new TextEncoder();

  // Resumable stream: buffer every event of this turn so a client that drops
  // (refresh / phone lock) can replay what it missed and re-attach LIVE via
  // /rpc/agent/stream/resume. stream_meta tells the client its stream id.
  const streamId = crypto.randomUUID();
  const buffered = openStream(streamId, { orgId, userId }, conversationId);
  // THE TURN IS A RECORD FROM ITS FIRST TOKEN (backlog 056): written now as
  // `running`, with what a restart needs to answer it again, and finished in
  // place below. A ledger that cannot be written changes nothing: the row is
  // then written at the end, as before.
  const turnRow = conversationId !== null
    ? await beginTurn({ orgId, conversationId, agentSlug, turn: { streamId, userMessageId, request: { message, messageForModel: modelMessage, agentSlug, userId, allowedSourceSlugs, timeZone, ...(deliverable ? { deliverable } : {}), attachmentIds, ...(modelPrefs ? { modelPrefs } : {}), ...(pageContext ? { pageContext } : {}), autonomy, ...(clientHistory.length > 0 ? { clientHistory } : {}) } } })
    : null;

  // Multiplex the agent event stream + a 15s keepalive timer into one
  // ReadableStream. Whichever fires first gets written; on disconnect
  // we cancel both. (See ADR 0001 §2 — keepalives.)
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      // How this turn ended, decided as it ends and stored on the row (#114).
      // `complete` until something says otherwise; the catch below and the
      // person's Stop are the two things that say otherwise.
      let ending: TurnStatus = 'complete';
      // Why it ended that way, in the runtime's own words — persisted beside
      // the status so a reloaded turn can still say what happened.
      let endingReason: string | null = null;
      // What the turn spent, counted while it runs (`budget/runCost.ts`).
      const counted = turnCost;
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
          }
          // A finished step goes to the ledger at once, so a re-run after a
          // restart knows what already happened and never does it twice.
          if (turnRow && (event.type === 'tool_end' || event.type === 'tool_error')) {
            void recordTurnProgress(turnRow.id, collector.finalise().runs);
          } else if (event.type === 'documents') {
            collector.onDocuments(event.documents as CollectedDoc[]);
          } else if (event.type === 'trace_node') {
            collector.onTraceNode(event as unknown as Record<string, unknown>);
          } else if (event.type === 'artifact' && !event.pending) {
            collector.onArtifact(event.artifact.id);
          } else if (event.type === 'recommended_action') {
            const r = event.recommendation as { label: string; actionId: string; input?: Record<string, unknown>; runId?: number; href?: string; hrefLabel?: string };
            collector.onCard({ label: r.label, actionId: r.actionId, input: r.input, runId: r.runId, href: r.href, hrefLabel: r.hrefLabel });
          } else if (event.type === 'record_links') {
            collector.onRecordLinks(event.links);
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
        if (event.type === 'recommended_action') {
          // Every recommendation becomes a CARD at this door (backlog 025):
          // on the ledger and on the wire first, filed second under
          // done-for-you, with the proposal id arriving as a `card_update`.
          // The reverse order lost cards on 2026-09-25 (finding 18).
          const card = cardFromRecommendation(event.recommendation);
          pending.push(surfaceCard(card, {
            write: writeEvent,
            collector,
            where: { conversationId, agentSlug },
            // A "Draft needed" card is never filed as it stands (`surfaceCard`).
            ...(autonomy === 'act-within-bounds' && !card.draft
              ? { file: (c: Card) => fileRecommendation({ orgId, userId, rec: cardAsRecommendation(c) }) }
              : {}),
          }));
          return;
        }
        if (event.type === 'card') {
          // A tool's own card (offer_connection, #1080): on the ledger and the
          // wire like a recommendation. It names no action, so nothing is filed.
          pending.push(surfaceCard(event.card, { write: writeEvent, collector, where: { conversationId, agentSlug } }));
          return;
        }
        writeEvent(event);
      };

      const keepaliveTimer = setInterval(() => {
        safeEnqueue(encoder.encode(': keepalive\n\n'));
      }, KEEPALIVE_INTERVAL_MS);

      // First frame: the resume handle (not part of the AgentEvent union —
      // the client stashes it and never reduces it into the transcript).
      // A thread created with this turn names itself here, so the client never
      // spends a round trip creating it first.
      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'stream_meta', streamId, ...(conversationId !== null ? { conversationId } : {}) })}\n\n`));
      // Then who answers, when the workspace decided: the client renders the
      // turn under that agent's name, and the reason rides with it.
      if (routing && routedAgent) {
        writeEvent({ type: 'routed', routing, agent: { slug: routedAgent.slug, name: routedAgent.name } });
      }
      // Always, routed or named: the turn's speaker is a typed frame the
      // transcript consumes, the same fact the assistant row is stamped with.
      writeEvent({ type: 'turn_agent', agent: turnAgent });

      try {
        // The head start, when the lead was picked, has been running all along;
        // what it said while the router read goes out now, in order.
        sink = sendEvent;
        for (const event of early.splice(0)) {
          sendEvent(event);
        }
        await (headStart ?? runTurn(agentSlug));
      } catch (err) {
        const m = (err as Error).message ?? 'agent error';
        // The turn died here. Whatever text the collector holds is a fragment,
        // and the row written below says so — `status: 'incomplete'` (#114).
        //
        // The turn is NOT run again, on purpose, even when the failure is a
        // dropped socket that a second attempt would survive. Retrying means
        // replaying the whole turn — same message, same tools, a model with no
        // memory of what the first attempt already did — and the only thing
        // this route can check before replaying is the event stream: did a
        // `tool_start` go past, an `artifact`, a `record_created`. That makes
        // safety rest on every side effect announcing itself as an event,
        // which nothing in the types or the tests enforces across the three
        // harness targets. One tool that writes without emitting, or one
        // provider path that stops forwarding, and a retry sends the same
        // email twice. A person can ask again knowing what already happened;
        // this route cannot.
        //
        // If a retry is ever worth it, the safe place is inside one model
        // call — the provider SDKs take a retry option (`libs/llm/langchain.ts`
        // builds every model and passes none today), which re-sends the
        // request before a single token is spoken and never replays a tool.
        // Three different endings reach this one catch, and they are not the
        // same thing to the person reading the transcript:
        //   - refused: the workspace declined to run the turn at all (a spent
        //     budget). Nothing broke, and asking again will not help until a
        //     setting changes.
        //   - incomplete: the run threw with text already on screen. What is
        //     stored stops mid-thought.
        //   - failed: the run threw before it said anything, so the row exists
        //     only so the turn does not vanish on reload.
        const spoken = collector?.finalise() ?? { text: '', runs: [] };
        if (isTurnRefusal(err)) {
          ending = 'refused';
        } else {
          ending = spoken.text || spoken.runs.length > 0 ? 'incomplete' : 'failed';
        }
        // What gets WRITTEN DOWN is not always what was thrown. A refusal's
        // message is ours — "Budget exceeded for …, raise the cap under
        // Budgets" — written to be read by the person it is about. Anything
        // else is a provider or database error, and those messages carry
        // hostnames, request ids and occasionally fragments of a payload;
        // stored on the row they would sit in the transcript forever, in front
        // of whoever opens that conversation next. The raw text goes to the
        // log, where it is useful and nobody browses it.
        if (ending === 'refused') {
          endingReason = m;
        } else {
          endingReason = null;
          console.warn('agent stream: the turn ended badly', { conversationId, agentSlug, ending }, err);
        }
        sendEvent({ type: 'error', message: m, ending });
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
          // The person pressed Stop: the answer is short because they chose
          // that, not because anything broke. Read here rather than from the
          // socket closing, because a locked phone closes the socket too and
          // that turn must keep going (`/rpc/agent/stream/stop`). A run that
          // threw keeps its own ending — a turn does not stop being broken
          // because someone gave up on it.
          if (ending === 'complete' && wasStopped(streamId)) {
            ending = 'stopped';
          }
          // A TURN THAT DID WORK AND NEVER ANSWERED IS NOT COMPLETE.
          //
          // `stalled` and the notice that renders it have existed since #114,
          // and `workspaceTurn` has classified it since — but that is the MCP
          // path. THIS is the route a person in a browser uses, and it stored
          // every one of these as `complete`: a silent empty answer under a
          // spinner that stopped, no notice, no reason, and the stalled
          // sentence replayed to the model next turn as though it had been an
          // answer. Production turn 533 (2026-09-24) is the specimen — "I'll
          // look at what's already known about this before writing a
          // contract.", two tool calls, nothing else, stored `complete`.
          //
          // Detection only. The turn is NOT re-run: a stalled turn's text is
          // dropped from history, so asking again would replay its tool calls
          // too, which is the side-effect replay the catch above refuses for
          // exactly the same reason. Continuing from the results already in
          // context has to happen inside the loop, not here.
          const toolCalls = runs.filter(r => r.type === 'tool').length;
          if (ending === 'complete' && stoppedShort({ text, toolCalls })) {
            ending = 'stalled';
            endingReason = `the turn ran ${toolCalls} step${toolCalls === 1 ? '' : 's'} and ended without answering`;
          }
          // A turn that threw before it spoke has nothing to show, but it still
          // happened: without a row the whole turn disappears on reload and the
          // person is left looking at their own question with no answer and no
          // explanation. So a failed turn is always written, empty or not.
          if (turnRow || text || runs.length > 0 || ending !== 'complete') {
            try {
              const cost = counted.cost ? { tokens: counted.cost.tokens, microCents: counted.cost.microCents } : null;
              const msg = turnRow
                ? await finishTurn({ id: turnRow.id, conversationId, content: text, runs, documents, trace, status: ending, statusReason: endingReason, agentSlug, cost })
                : await appendMessage({
                    orgId,
                    conversationId,
                    role: 'assistant',
                    content: text,
                    runs,
                    documents,
                    trace,
                    status: ending,
                    ...(endingReason ? { statusReason: endingReason } : {}),
                    agentSlug,
                    ...(cost ? { cost } : {}),
                  });
              // The features this turn was about are re-totalled with it.
              if (counted.cost && counted.cost.microCents > 0) {
                void import('@/services/factory/featureSpend').then(m => m.scheduleFeatureSpendRefresh(orgId)).catch(() => {});
              }
              // The thread's name, once its first answer has landed — in the
              // background, after the row is written, so the stream never waits
              // on it. It only ever replaces a title nobody chose
              // (`services/chat/conversationTitle.ts`).
              if (ending === 'complete' && text.trim()) {
                scheduleConversationTitle({ orgId, conversationId });
              }
              const touched = collector.touchedArtifactIds;
              if (touched.length > 0) {
                await stampArtifactsWithMessage({ orgId, artifactIds: touched, messageId: msg.id });
              }
              // The learning loop, fed by the work itself: this turn changed a
              // document AND the person's message instructed, so the standing
              // rules in what they said are drafted and put through the trust
              // ladder — adopted above the workspace's learning bar with Undo,
              // asked below it (`services/chat/workCorrections.ts`). After the
              // turn is closed and fire-and-forget, because nothing here may
              // cost the person their answer. Skipped when the absence
              // reflector already filed for this message, so one turn never
              // produces two candidates for the same words.
              if (!absenceCorrected) {
                const { correctionInTurn, learnFromWorkCorrection } = await import('@/services/chat/workCorrections');
                const correction = correctionInTurn({ message, toolNames: runs.filter(r => r.type === 'tool').map(r => r.name) });
                if (correction) {
                  void learnFromWorkCorrection({ orgId, agentSlug, userId, correction })
                    .then(async ({ receipt }) => {
                      if (receipt) {
                        await appendMessage({ orgId, conversationId, role: 'assistant', content: receipt, agentSlug });
                      }
                    })
                    .catch(() => {});
                }
              }
            } catch (error) {
              // Usually the conversation was deleted while the turn ran, which
              // is nothing to report. Anything else means the person's answer
              // is on their screen and nowhere else — and, for a turn that ended badly,
              // that the transcript says "unfinished" now and will say nothing
              // at all after a reload. Say so in the log either way.
              console.warn('agent stream: could not persist the assistant turn', { conversationId, ending }, error);
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

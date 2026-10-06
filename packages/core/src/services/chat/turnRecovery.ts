/**
 * TURN RECOVERY: a chat turn survives a restart (backlog 056, Chris, 2026-10-04:
 * "Have a turn survive a restart").
 *
 * When the executor process starts, every assistant turn still `running` in
 * the ledger from another process (`turnLedger.ts`) is one a restart cut
 * off. Each is answered again, once: the same thread and the same words, with
 * the steps the first attempt had finished handed to the model as what already
 * happened — they ran once and must not run again — and streamed under the
 * SAME stream id, so a client holding it re-attaches through
 * `/rpc/agent/stream/resume` and sees the whole answer (`turn_restarted`
 * first, then every event). A turn interrupted a second time ends
 * `interrupted`, with the reason where the person reads it, and asks nothing
 * more of anyone.
 *
 * Never throws out: a turn that cannot be recovered is finished with its
 * reason and logged, and the next one is tried.
 */

import type { AgentEvent } from '@/services/agents/types';
import type { CollectedDoc } from '@/services/chat/runCollector';
import type { TurnRow } from '@/services/chat/turnLedger';
import type { TurnStatus } from '@/services/chat/turnStatus';
import { logger } from '@/libs/Logger';
import { openStream } from '@/libs/streams/buffer';
import { finishTurn, processInstanceId, runningTurnsOfOtherProcesses, writeTurn } from '@/services/chat/turnLedger';

/** The most attempts a turn gets: the first answer and one re-run after a restart. */
export const TURN_ATTEMPTS = 2;

/** The sentence under a turn the app restarted on twice. */
export const INTERRUPTED_TWICE = 'The app restarted while answering, twice, so this answer did not finish. Ask again.';

/** How the re-run ended, in the route's vocabulary. */
export type RecoveredEnding = { status: TurnStatus; reason: string | null; text: string; runs: unknown[]; documents: CollectedDoc[]; trace: unknown[]; cost: { tokens: number; microCents: number } | null };

/** Runs a turn again and streams its events; the default is the agent runtime, a test stands in. */
export type TurnRunner = (row: TurnRow, onEvent: (event: AgentEvent) => void) => Promise<RecoveredEnding>;

/** The outcome, for the log and the deploy receipt. */
export type RecoveryOutcome = { found: number; resumed: number; gaveUp: number; failed: number };

/**
 * The steps the first attempt finished, in words the model acts on: each tool,
 * what it was given and what it answered, so none runs twice.
 * @param runs - The interrupted attempt's runs.
 */
export function stepsAlreadyDone(runs: ReadonlyArray<{ type: string; name?: string; input?: unknown; output?: string; state?: string }>): string {
  const done = runs.filter(r => r.type === 'tool' && r.state === 'done' && r.name);
  if (done.length === 0) {
    return '';
  }
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const lines = done.map(r => `- ${r.name}(${clip(JSON.stringify(r.input ?? {}), 300)}) → ${clip(String(r.output ?? ''), 600)}`);
  return `\n\n[The app restarted while you were answering this. These steps already ran and their results stand; do not run them again, continue from here and answer:\n${lines.join('\n')}]`;
}

/**
 * Answer an interrupted turn again with the agent runtime, streaming into `onEvent`.
 * @param row - The turn.
 * @param onEvent - Where the events go.
 */
export async function runTurnAgain(row: TurnRow, onEvent: (event: AgentEvent) => void): Promise<RecoveredEnding> {
  const { listMessages, toHistoryTurns } = await import('@/services/ConversationService');
  const { listArtifactsByIds, listAttachmentsByMessage } = await import('@/services/ArtifactService');
  const { historyMarker, loadedFromArtifact } = await import('@/services/chat/attachments');
  const { RunCollector } = await import('@/services/chat/runCollector');
  const { runAgentDeep } = await import('@/services/AgentService');
  const { withRunCost } = await import('@/services/budget/runCost');
  const { isTurnRefusal } = await import('@/services/agents/turnRefusal');
  const { stoppedShort } = await import('@/services/chat/turnStatus');

  const req = row.turn.request;
  const [msgs, uploads] = await Promise.all([listMessages({ orgId: row.orgId, conversationId: row.conversationId }), listAttachmentsByMessage({ orgId: row.orgId, conversationId: row.conversationId })]);
  const before = row.turn.userMessageId ?? row.id;
  const history = msgs.length > 0
    ? toHistoryTurns(msgs.filter(m => m.id < before).map(m => ({ ...m, content: `${m.content}${historyMarker(uploads.get(m.id) ?? [])}` })), { timeZone: req.timeZone })
    : req.clientHistory ?? [];
  const attachments = req.attachmentIds.length > 0
    ? (await listArtifactsByIds({ orgId: row.orgId, ids: req.attachmentIds })).filter(a => a.kind === 'file' && a.lastAuthorKind === 'human').map(loadedFromArtifact)
    : [];

  const collector = new RunCollector();
  const write = (event: AgentEvent) => {
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
    } else if (event.type === 'record_links') {
      collector.onRecordLinks(event.links);
    }
    onEvent(event);
  };

  let status: TurnStatus = 'complete';
  let reason: string | null = null;
  let cost: { tokens: number; microCents: number } | null = null;
  try {
    await withRunCost({ conversationId: row.conversationId }, async (scope) => {
      await runAgentDeep({
        allowedSourceSlugs: req.allowedSourceSlugs,
        orgId: row.orgId,
        agentSlug: req.agentSlug,
        message: `${req.messageForModel}${stepsAlreadyDone(row.runs as never)}`,
        userId: req.userId,
        conversationId: row.conversationId,
        conversationHistory: history,
        ...(req.pageContext ? { pageContext: req.pageContext as never } : {}),
        timeZone: req.timeZone,
        ...(req.deliverable ? { deliverable: req.deliverable as never } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(req.modelPrefs ? { modelPrefs: req.modelPrefs as never } : {}),
        onEvent: write,
      });
      cost = scope.microCents > 0 || scope.tokens > 0 ? { tokens: scope.tokens, microCents: scope.microCents } : null;
    });
  } catch (err) {
    const spoken = collector.finalise();
    if (isTurnRefusal(err)) {
      status = 'refused';
      reason = (err as Error).message;
    } else {
      status = spoken.text || spoken.runs.length > 0 ? 'incomplete' : 'failed';
    }
    onEvent({ type: 'error', message: (err as Error).message ?? 'agent error', ending: status } as AgentEvent);
  }
  const { text, runs, documents, trace } = collector.finalise();
  if (status === 'complete' && stoppedShort({ text, toolCalls: runs.filter(r => r.type === 'tool').length })) {
    status = 'stalled';
    reason = `the turn ran ${runs.filter(r => r.type === 'tool').length} steps and ended without answering`;
  }
  onEvent({ type: 'done', response: text });
  return { status, reason, text, runs, documents, trace, cost };
}

/**
 * Finish every turn a restart left running: answer each again once under its
 * own stream id, or end it `interrupted` with the reason when it already had
 * its re-run.
 * @param deps - This process and the runner; tests pass their own.
 * @param deps.processId - This process (`processInstanceId`).
 * @param deps.run - Answers a turn again.
 * @param deps.now - The clock.
 */
export async function recoverInterruptedTurns(deps: { processId?: string; run?: TurnRunner; now?: () => Date } = {}): Promise<RecoveryOutcome> {
  const processId = deps.processId ?? processInstanceId();
  const run = deps.run ?? runTurnAgain;
  const now = deps.now ?? (() => new Date());
  const outcome: RecoveryOutcome = { found: 0, resumed: 0, gaveUp: 0, failed: 0 };
  let rows: TurnRow[];
  try {
    rows = await runningTurnsOfOtherProcesses(processId);
  } catch (err) {
    logger.warn('turn recovery: the ledger could not be read', { error: (err as Error).message });
    return outcome;
  }
  outcome.found = rows.length;
  for (const row of rows) {
    const at = now().toISOString();
    if (row.turn.attempt >= TURN_ATTEMPTS) {
      try {
        await finishTurn({ id: row.id, conversationId: row.conversationId, content: row.content, runs: row.runs, status: 'interrupted', statusReason: INTERRUPTED_TWICE, agentSlug: row.agentSlug });
        outcome.gaveUp += 1;
      } catch (err) {
        outcome.failed += 1;
        logger.warn('turn recovery: an interrupted turn could not be closed', { id: row.id, error: (err as Error).message });
      }
      continue;
    }
    const turn = { ...row.turn, attempt: row.turn.attempt + 1, interruptedAt: at, resumedAt: at, resumedBy: processId, processId };
    const stream = openStream(row.turn.streamId, { orgId: row.orgId, userId: row.turn.request.userId }, row.conversationId, { recovered: true });
    const send = (event: AgentEvent) => stream.append(JSON.stringify(event));
    try {
      await writeTurn(row.id, turn);
      send({ type: 'turn_restarted', reason: 'the app restarted while answering; answering again from where it stood' });
      send({ type: 'turn_agent', agent: { slug: row.turn.request.agentSlug, name: row.turn.request.agentSlug } });
      const ended = await run({ ...row, turn }, send);
      await finishTurn({ id: row.id, conversationId: row.conversationId, content: ended.text, runs: ended.runs as never, documents: ended.documents, trace: ended.trace as never, status: ended.status, statusReason: ended.reason, agentSlug: row.turn.request.agentSlug, cost: ended.cost });
      outcome.resumed += 1;
      logger.info('turn recovery: a turn cut off by a restart was answered again', { id: row.id, conversationId: row.conversationId, status: ended.status });
    } catch (err) {
      outcome.failed += 1;
      logger.warn('turn recovery: the re-run itself failed', { id: row.id, error: (err as Error).message });
      send({ type: 'error', message: (err as Error).message ?? 'agent error', ending: 'incomplete' } as AgentEvent);
      send({ type: 'done', response: '' });
      await finishTurn({ id: row.id, conversationId: row.conversationId, content: '', runs: row.runs, status: 'incomplete', statusReason: `the app restarted while answering, and answering again failed: ${(err as Error).message}`.slice(0, 500), agentSlug: row.agentSlug }).catch(() => undefined);
    } finally {
      stream.close();
    }
  }
  if (outcome.found > 0) {
    logger.info('turn recovery: done', outcome);
  }
  return outcome;
}

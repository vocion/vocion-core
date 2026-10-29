/**
 * The one place a workflow's `agent` step calls an agent: a durable run's
 * turn, charged to the workflow run (`withCallContext`, `runKind:
 * workflow_run`), on the effort the step names and, when it names tools, only
 * those. Kept apart from the step's logic (`agentStep.ts`) so the logic is
 * tested against a stand-in and this stays a thin call.
 */
import type { HistoryTurn } from '@/services/chat/historyTools';

export type AgentTurnRequest = {
  orgId: string;
  agentSlug: string;
  message: string;
  /** The workflow run the turn belongs to: its spend lands there. */
  runId: number;
  /** Who the turn runs as: `workflow:<slug>:<runId>`. */
  userId: string;
  effort: 'auto' | 'quick' | 'standard' | 'deep';
  toolAllowlist?: string[];
  /** The step's earlier turn, for the corrective retry. */
  history?: HistoryTurn[];
};

export type AgentTurnResult = {
  /** The agent's whole reply. */
  text: string;
  /** Its words after its last tool call, when the loop can tell: where a result is read first. */
  lastAnswer?: string;
  traceId: string;
  /** The model that answered, as the provider named it. */
  model?: string;
  /** The level the turn ran at, once it was decided. */
  effort?: string;
  /** What the turn cost, in micro-cents, when the loop reports it. */
  microCents?: number;
  toolCalls: number;
};

export type AgentTurn = (req: AgentTurnRequest) => Promise<AgentTurnResult>;

/**
 * Run one turn of an agent for a workflow step.
 * @param req - The turn.
 */
export const runAgentTurn: AgentTurn = async (req) => {
  const [{ runAgentDeep }, { withCallContext }] = await Promise.all([
    import('@/services/AgentService'),
    import('@/services/spend/callContext'),
  ]);
  let model: string | undefined;
  let effort: string | undefined;
  const result = await withCallContext({ runKind: 'workflow_run', runId: req.runId }, () => runAgentDeep({
    orgId: req.orgId,
    agentSlug: req.agentSlug,
    message: req.message,
    userId: req.userId,
    modelPrefs: { strength: 'balanced', effort: 'off', level: req.effort },
    ...(req.toolAllowlist?.length ? { toolAllowlist: req.toolAllowlist } : {}),
    ...(req.history?.length ? { conversationHistory: req.history } : {}),
    onEvent: (event) => {
      if (event.type === 'run_meta') {
        model = event.model;
        effort = event.effort?.level ?? effort;
      } else if (event.type === 'effort_result') {
        effort = event.level;
      }
    },
  }));
  return {
    text: result.response ?? '',
    ...(result.lastAnswer?.trim() ? { lastAnswer: result.lastAnswer } : {}),
    traceId: result.traceId,
    model: result.usage?.model ?? model,
    effort,
    microCents: result.usage?.microCents,
    toolCalls: result.toolCalls.length,
  };
};

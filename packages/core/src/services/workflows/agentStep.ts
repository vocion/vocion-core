/**
 * A WORKFLOW'S `agent` STEP (ADR 0011): one agent, one bounded task.
 *
 * The agent runs one turn on its own tools and skills — the step names no
 * skill; which to read is the agent's judgement, as ADR 0003 has it — with the
 * task interpolated from the run. When the step declares an `output` JSON
 * Schema, the turn must end with a JSON object of that shape. It is read from
 * the reply, validated, and on a bad shape the agent is told exactly what
 * failed and answers once more; a second bad shape fails the step with the
 * reason, never a guess.
 *
 * The turn is charged to the workflow run, at the effort the step names
 * (`agentRunner.ts`). What it did — attempts, traces, model, effort, cost — is
 * the step's record, so a person can check the result in one move from the
 * run page. Durability is the run's: the engine persists each finished step,
 * and a step a restart interrupted runs again (`WorkflowService.ts`).
 */
import type { ValidateFunction } from 'ajv';
import type { AgentTurn, AgentTurnResult } from './agentRunner';
import type { AgentWorkflowStep } from '@/libs/workspace/schemas';

/** Corrective turns after a result of the wrong shape. One: a model told the exact problem fixes it on sight, or will not. */
export const SHAPE_RETRIES = 1;

export type AgentStepAttempt = { at: string; traceId: string; ok: boolean; problem?: string };

/** What a finished (or failed) agent step leaves on the run. */
export type AgentStepRecord = {
  output: unknown;
  agent: string;
  attempts: AgentStepAttempt[];
  model?: string;
  effort?: string;
  microCents?: number;
  toolCalls: number;
};

/** The step could not produce its result; carries what it did, for the run's record. */
export class AgentStepError extends Error {
  constructor(message: string, public readonly record: AgentStepRecord) {
    super(message);
    this.name = 'AgentStepError';
  }
}

/**
 * The message the agent reads: the task, where it sits, and the shape its
 * result must take.
 * @param opts - The step and the run.
 * @param opts.task - The interpolated task.
 * @param opts.workflowName - The workflow's name.
 * @param opts.runLabel - The run's label, when it has one.
 * @param opts.stepLabel - The step's label.
 * @param opts.output - The result's JSON Schema, when declared.
 */
export function agentStepMessage(opts: { task: string; workflowName: string; runLabel?: string | null; stepLabel: string; output?: Record<string, unknown> }): string {
  const where = `This is the step "${opts.stepLabel}" of the workflow "${opts.workflowName}"${opts.runLabel ? ` (${opts.runLabel})` : ''}. It is one bounded task: do it with your own tools and skills, then stop. Nobody is reading along, so do not ask questions in your reply; if something stops you, say what in your result.`;
  const shape = opts.output
    ? `When you are done, end your reply with your result as one JSON object in a \`\`\`json block, matching this JSON Schema:\n\`\`\`json\n${JSON.stringify(opts.output, null, 2)}\n\`\`\``
    : null;
  return [opts.task.trim(), where, shape].filter(Boolean).join('\n\n');
}

/**
 * The JSON object a reply ends with: the last fenced block that parses, else
 * the whole reply, else the last brace-delimited object that parses. Null when
 * there is none.
 * @param text - The reply.
 */
export function extractResult(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?([\s\S]*?)```/g)].map(m => m[1]!.trim()).reverse();
  for (const body of fences) {
    const parsed = tryParse(body);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  const whole = tryParse(text.trim());
  if (whole !== undefined) {
    return whole;
  }
  const end = text.lastIndexOf('}');
  for (let start = text.lastIndexOf('{', end); start >= 0 && end > start; start = text.lastIndexOf('{', start - 1)) {
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return null;
}

/**
 * JSON.parse that says undefined instead of throwing.
 * @param s - The text.
 */
function tryParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

const validators = new Map<string, ValidateFunction>();

/**
 * Validate a result against the step's schema: null when it fits, else the
 * problems as one line the model can act on (`path: message; …`).
 * @param schema - The step's `output`.
 * @param value - The result read from the reply.
 */
export async function shapeProblem(schema: Record<string, unknown>, value: unknown): Promise<string | null> {
  if (value === null || value === undefined) {
    return 'no JSON object was found at the end of the reply';
  }
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    const { default: Ajv } = await import('ajv');
    validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    validators.set(key, validate);
  }
  if (validate(value)) {
    return null;
  }
  return (validate.errors ?? []).map(e => `${e.instancePath || '(the result)'} ${e.message ?? 'is wrong'}`.trim()).join('; ') || 'the result does not match the schema';
}

/**
 * Run an agent step to its result.
 * @param opts - The step, the run and the turn to call.
 * @param opts.orgId - The workspace.
 * @param opts.runId - The workflow run.
 * @param opts.workflow - The workflow's slug and name.
 * @param opts.workflow.slug - Its slug.
 * @param opts.workflow.name - Its name.
 * @param opts.runLabel - The run's label.
 * @param opts.stepLabel - The step's label.
 * @param opts.step - The step as authored.
 * @param opts.task - The step's task, interpolated.
 * @param opts.turn - The agent call (`runAgentTurn`; a stand-in under test).
 */
export async function runAgentStep(opts: {
  orgId: string;
  runId: number;
  workflow: { slug: string; name: string };
  runLabel?: string | null;
  stepLabel: string;
  step: AgentWorkflowStep;
  task: string;
  turn: AgentTurn;
}): Promise<AgentStepRecord> {
  const { step } = opts;
  const message = agentStepMessage({ task: opts.task, workflowName: opts.workflow.name, runLabel: opts.runLabel, stepLabel: opts.stepLabel, output: step.output });
  const record: AgentStepRecord = { output: undefined, agent: step.agent, attempts: [], toolCalls: 0 };
  const base = {
    orgId: opts.orgId,
    agentSlug: step.agent,
    runId: opts.runId,
    userId: `workflow:${opts.workflow.slug}:${opts.runId}`,
    effort: step.effort ?? 'auto' as const,
    ...(step.tools?.length ? { toolAllowlist: step.tools } : {}),
  };
  const note = (r: AgentTurnResult, problem: string | null) => {
    record.attempts.push({ at: new Date().toISOString(), traceId: r.traceId, ok: problem === null, ...(problem ? { problem } : {}) });
    record.model = r.model ?? record.model;
    record.effort = r.effort ?? record.effort;
    record.toolCalls += r.toolCalls;
    if (typeof r.microCents === 'number') {
      record.microCents = (record.microCents ?? 0) + r.microCents;
    }
  };

  let reply = await opts.turn({ ...base, message });
  if (!step.output) {
    note(reply, null);
    record.output = reply.lastAnswer?.trim() || reply.text;
    return record;
  }

  for (let retry = 0; ; retry++) {
    const value = extractResult(reply.lastAnswer ?? '') ?? extractResult(reply.text);
    const problem = await shapeProblem(step.output, value);
    note(reply, problem);
    if (problem === null) {
      record.output = value;
      return record;
    }
    if (retry >= SHAPE_RETRIES) {
      throw new AgentStepError(`${step.agent}'s result did not match the step's output after ${retry + 1} ${retry === 0 ? 'try' : 'tries'}: ${problem}`, record);
    }
    // Told exactly what failed, with its own turn in front of it.
    reply = await opts.turn({
      ...base,
      message: `Your result did not match the shape this step needs: ${problem}. Reply with only the corrected JSON object in a \`\`\`json block. Do not redo the work unless the result needs something you do not have.`,
      history: [{ role: 'user', content: message }, { role: 'assistant', content: reply.text }],
    });
  }
}

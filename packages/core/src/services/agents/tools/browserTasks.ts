/**
 * `browser_task`, `browser_task_check`, `browser_task_stop` — hand a task to
 * the person's browser from chat, follow it, stop it
 * (`services/browser/BrowserRunService.ts`).
 *
 * The run opens beside the conversation as it starts (a `record_created`,
 * like every other thing a turn starts) and a follow chip with its live
 * status sits under the answer; the pane shows the browser as it works, the
 * steps, what it waits on and what it found.
 *
 * Whose word starts it. A person who asked for it in this turn: it starts at
 * once, as theirs (`saidToDecide`, a model reading their own words). An agent
 * that thought of it: it is filed as a suggestion with a Start button, and
 * nothing runs until the person presses it.
 *
 * The call waits a while for the run (inside the turn's deadline; on the
 * container, under the tool timeout) and hands back the result when it is
 * done in time, or where it stands — still going, or waiting on the person —
 * when it is not. A run that outlives the call says its result in the
 * conversation itself when it ends.
 *
 * Who has it: an agent granted `browser` tasks (`harness.grantTools:
 * [browser_tasks]`), or every agent in a person's turn when
 * `VOCION_BROWSER_RUNS=on`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { browserRunLabel } from '@/libs/browser/run';
import { browserRunsOn } from '@/services/browser/enabled';
import { containerWaitMs } from './teamThread';

/** The grant that puts browser tasks on an agent's belt. */
const BROWSER_TASKS_GRANT = 'browser_tasks';

/** How long `browser_task` waits for its run in this process. */
const IN_PROCESS_WAIT_MS = 4 * 60_000;

function enabled(ctx: RuntimeContext): boolean {
  if ((ctx.harnessConfig.grantTools ?? []).includes(BROWSER_TASKS_GRANT)) {
    return true;
  }
  return browserRunsOn() && Boolean(ctx.userId);
}

/**
 * The run, as the model hands it on: where it stands, and what it found.
 * @param v
 * @param note
 */
/**
 * A run's outputs as the agent receives them. When the run is done its outputs are drawn under the
 * answer by the run itself (`BrowserRunResult`), so a list of rows reaches the agent as a count and
 * its columns, not the rows: an agent that restated rows put them in its own order (2026-10-21),
 * and rows it never holds it cannot reorder. Single values come through, to answer with.
 * `rows: true` (browser_task_check) hands the rows over, numbered in the page's order, for an agent
 * that has to work something out from them.
 * @param result - The run's outputs.
 * @param rows - Hand list rows over in full.
 */
export function outputsForAgent(result: Record<string, unknown> | null, rows = false): Record<string, unknown> | null {
  if (!result) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    const isTable = Array.isArray(v) && v.length > 0 && v.every(x => x && typeof x === 'object' && !Array.isArray(x));
    if (!isTable) {
      out[k] = v;
    } else if (rows) {
      out[k] = (v as Array<Record<string, unknown>>).map((row, i) => ({ '#': i + 1, ...row }));
    } else {
      out[k] = { shown_under_your_answer: true, rows: v.length, columns: [...new Set((v as Array<Record<string, unknown>>).flatMap(x => Object.keys(x)))] };
    }
  }
  return out;
}

/**
 * The run, as the model hands it on: where it stands, and what it found.
 * @param v - The run.
 * @param note - What to do with it.
 * @param rows - Hand list rows over in full (`outputsForAgent`).
 */
function answerOf(v: import('@/libs/browser/run').BrowserRunView, note: string, rows = false): string {
  const result = outputsForAgent(v.result, rows || v.status !== 'done');
  return JSON.stringify({
    browserRunId: v.id,
    run: browserRunLabel(v.id),
    status: v.status,
    ...(v.summary ? { summary: v.summary } : {}),
    ...(result ? { result } : {}),
    ...(v.waiting ? { waiting_on_person: v.waiting.kind === 'approval' ? `approve or decline: ${v.waiting.text}` : v.waiting.text } : {}),
    ...(v.error ? { error: v.error } : {}),
    steps: v.steps.length,
    page: v.url,
    note,
  });
}

function noteFor(status: string): string {
  switch (status) {
    case 'done':
      return 'Done. Its outputs are drawn under your answer by the run itself, tables included, in the order the page gave them. Answer what the person asked in a sentence or two from the summary and the values here; never write the rows out. To work something out from the rows, call browser_task_check with rows: true.';
    case 'failed':
      return 'It could not finish. Say why plainly, and what it did get.';
    case 'waiting':
      return 'It is waiting on the person (the pane beside the conversation shows what, with Approve and Decline). Tell them in one line; it carries on when they answer, and says its result here when done. Do not wait for it.';
    case 'stopped':
      return 'The person stopped it.';
    case 'proposed':
      return 'Filed as a suggestion: nothing runs until the person presses Start on it, beside the conversation. Tell them in one line what it would do.';
    default:
      return 'Still going, in the pane beside the conversation. Tell the person it is working; it says its result here when done. Do not wait for it or make up its result.';
  }
}

// Plain JSON Schema, not zod: three tools' worth of zod inference is real weight in a type check
// that runs at its heap limit in CI, and the registry serves either (`registry.ts` inputSchema).
const NAME = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,40}$' };

type TaskArgs = { task: string; start_url?: string; inputs?: Array<{ name: string; value: string; secret?: boolean }>; outputs?: Array<{ name: string; description: string }>; continue_from_current_page?: boolean };
type CheckArgs = { run_id: number; wait_seconds?: number; rows?: boolean };

export function browserTaskTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!enabled(ctx) || !ctx.userId) {
    return [];
  }
  const userId = ctx.userId;
  const svc = () => import('@/services/browser/BrowserRunService');
  const waitMs = ctx.provider === 'runtime' ? containerWaitMs() : IN_PROCESS_WAIT_MS;
  return [
    tool(
      async (raw: unknown) => {
        const args = raw as TaskArgs;
        const { createBrowserRun, waitForBrowserRun, BrowserRunBusyError } = await svc();
        // The person's word starts it; an agent's idea waits for their Start.
        // The person's word: a tagged @browser, a token caller of their own, or a model reading their words.
        let asked = Boolean(ctx.pageContext?.askedFor?.includes('browser')) || (userId.startsWith('token:') && !ctx.turnIntent);
        if (!asked) {
          const { personSaidToDecide } = await import('../owedDecision');
          asked = (await personSaidToDecide(ctx, `use a browser to do this task: ${args.task}`)).said;
        }
        const inputs = Object.fromEntries((args.inputs ?? []).map(i => [i.name, i.value]));
        const secretNames = (args.inputs ?? []).filter(i => i.secret).map(i => i.name);
        let view;
        try {
          view = await createBrowserRun({
            orgId: ctx.orgId,
            userId,
            conversationId: ctx.conversationId ?? null,
            agentSlug: ctx.agentSlug ?? null,
            task: args.task,
            startUrl: args.start_url ?? null,
            inputs,
            secretNames,
            outputs: args.outputs ?? [],
            proposedBy: asked ? 'person' : `agent:${ctx.agentSlug ?? 'assistant'}`,
            start: asked,
            continuing: args.continue_from_current_page ?? false,
          });
        } catch (e) {
          if (e instanceof BrowserRunBusyError) {
            return `Not started: ${e.message} Its run is ${browserRunLabel(e.runId)}.`;
          }
          throw e;
        }
        const { recordRef } = await import('@/services/chat/recordContext');
        ctx.emit({ type: 'record_created', record: recordRef('browser_run', view.id, browserRunLabel(view.id)) });
        if (!asked) {
          return answerOf(view, noteFor('proposed'));
        }
        ctx.emit({ type: 'step_progress', tool: 'browser_task', note: `${browserRunLabel(view.id)} · started` });
        const after = await waitForBrowserRun(ctx.orgId, view.id, waitMs) ?? view;
        return answerOf(after, noteFor(after.status));
      },
      {
        name: 'browser_task',
        description: [
          'Hand a task to a web browser that works on its own, in the person\'s own browser session, while they watch it beside the conversation: open pages, sign in, click, fill forms, read tables, and bring back named outputs. For work on a site with no API or connector (a vendor or customer portal, a government site, a site that needs a sign-in), or when the person asks to "use the browser".',
          'Prefer a connector or web_search when one can answer; a browser is slower. Steps that submit, send, pay, save or delete wait for the person\'s approval in the pane, so include them in the task when the task needs them.',
          'When the person tagged @browser, use this tool for their ask. One task per call, written as the person would brief an assistant. Give the inputs it needs (mark passwords and codes secret: the browser types them without the model reading them) and the outputs you want back, each named. When the person asked for it, it starts now; when it is your idea, it is filed for them to Start.',
          'One run at a time per person; the browser stays open between their runs, so continue_from_current_page carries on where the last one left off.',
        ].join(' '),
        schema: {
          type: 'object',
          properties: {
            task: { type: 'string', minLength: 10, maxLength: 2000, description: 'What to do, start to finish, as you would brief a person.' },
            start_url: { type: 'string', maxLength: 2000, description: 'Where to start: a full address.' },
            inputs: { type: 'array', maxItems: 20, description: 'What it needs: account email, a password (secret: true), the new address…', items: { type: 'object', properties: { name: NAME, value: { type: 'string', maxLength: 2000 }, secret: { type: 'boolean' } }, required: ['name', 'value'] } },
            outputs: { type: 'array', maxItems: 12, description: 'What it brings back, each named.', items: { type: 'object', properties: { name: { ...NAME, description: 'A key, snake_case: unpaid_invoices.' }, description: { type: 'string', minLength: 3, maxLength: 200, description: 'What it holds, and its shape when it is a list: "each open invoice: number, due date, amount".' } }, required: ['name', 'description'] } },
            continue_from_current_page: { type: 'boolean', description: 'Carry on from the page the person\'s browser is on now, instead of start_url.' },
          },
          required: ['task'],
        },
      },
    ),
    tool(
      async (raw: unknown) => {
        const args = raw as CheckArgs;
        const { getBrowserRun, waitForBrowserRun } = await svc();
        const first = await getBrowserRun(ctx.orgId, args.run_id);
        if (!first || first.proposedBy === undefined) {
          return `No ${browserRunLabel(args.run_id)} in this workspace.`;
        }
        const wait = Math.min(args.wait_seconds ?? 0, Math.round(waitMs / 1000)) * 1000;
        const v = wait > 0 && ['queued', 'running'].includes(first.status) ? await waitForBrowserRun(ctx.orgId, args.run_id, wait) ?? first : first;
        return answerOf(v, args.rows ? 'The rows, numbered in the order the page gave them, for you to work from. The person already sees them under the answer: use them, do not write them out again.' : noteFor(v.status), args.rows === true);
      },
      {
        name: 'browser_task_check',
        description: 'Where a browser run stands, with its result once it is done. wait_seconds waits for it to finish first.',
        schema: { type: 'object', properties: { run_id: { type: 'integer', minimum: 1 }, wait_seconds: { type: 'integer', minimum: 0, maximum: 240 }, rows: { type: 'boolean', description: 'Hand over the rows of its table outputs, numbered in the page\'s order, to work something out from them.' } }, required: ['run_id'] },
      },
    ),
    tool(
      async (raw: unknown) => {
        const args = raw as { run_id: number };
        const { stopBrowserRun, BrowserRunError } = await svc();
        try {
          await stopBrowserRun(ctx.orgId, userId, args.run_id);
        } catch (e) {
          if (e instanceof BrowserRunError) {
            return `Not stopped: ${e.message}`;
          }
          throw e;
        }
        return `${browserRunLabel(args.run_id)} is stopping.`;
      },
      {
        name: 'browser_task_stop',
        description: 'Stop the person\'s browser run, when they ask to.',
        schema: { type: 'object', properties: { run_id: { type: 'integer', minimum: 1 } }, required: ['run_id'] },
      },
    ),
  ];
}

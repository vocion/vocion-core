/**
 * `routine_teach`, `routine_update`, `routine_run`, `routine_check`, `routine_report`,
 * `routine_list` — routines from chat (`services/routines/RoutineService.ts`).
 *
 * A person pastes a Slate recording and asks to teach a routine from it: the
 * routine opens beside the conversation as the analyst reads the recording,
 * and its draft lands there — steps, rules, escalation points and the
 * questions for its expert. The expert answers and approves in their own
 * words; a batch runs for the rows they hand over, each row a browser run,
 * watched as one queue beside the conversation. Escalations dock in the
 * conversation as Decisions; the batch says its result here when it ends.
 *
 * Whose word: approving a version, changing trust and running a batch are the
 * expert's or the person's own decisions — an agent never takes them on its
 * own idea (`personSaidToDecide`).
 *
 * Who has it: every agent in a person's turn when the `routines` plugin is on
 * (or `VOCION_ROUTINES=on`), or an agent granted `routines`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { RoutineView } from '@/libs/routines/types';
import process from 'node:process';
import { tool } from '@langchain/core/tools';
import { batchLabel, clock, TRUST_LABEL } from '@/libs/routines/types';

const ROUTINES_GRANT = 'routines';

/** How long `routine_teach` waits for the draft in this process. */
const TEACH_WAIT_MS = 3 * 60_000;

function enabled(ctx: RuntimeContext): boolean {
  if ((ctx.harnessConfig.grantTools ?? []).includes(ROUTINES_GRANT)) {
    return true;
  }
  if (!ctx.userId) {
    return false;
  }
  return (process.env.VOCION_ROUTINES ?? '').trim().toLowerCase() === 'on' || (ctx.enabledPlugins ?? []).includes('routines');
}

function specBrief(r: RoutineView): Record<string, unknown> {
  const v = r.draft ?? r.version;
  if (!v) {
    return { routineId: r.id, name: r.name, status: r.status, teaching: r.teaching?.state ?? null, error: r.error };
  }
  return {
    routineId: r.id,
    name: r.name,
    status: r.status,
    trust: TRUST_LABEL[r.trust],
    expert: r.expert?.name ?? null,
    version: v.n,
    versionStatus: v.status,
    recording: r.source?.url ?? null,
    summary: v.spec.summary,
    steps: v.spec.steps.map(s => `${s.n}. ${s.text}${s.at !== null ? ` [${clock(s.at)}]` : ''}`),
    rules: v.spec.rules.map(x => x.text),
    escalations: v.spec.escalations.map(e => `${e.when} → ${e.ask}`),
    inputs: v.spec.inputs.map(i => `${i.name}${i.secret ? ' (secret)' : ''}${i.shared ? ' (same for every row)' : ''}${i.key ? ' (identifies the row)' : ''}: ${i.description}`),
    writes: v.spec.writes.map(w => w.button),
    reconcile: v.spec.reconcile ? `After a batch, it checks ${v.spec.reconcile.listUrl ?? 'the list'} against the rows by ${v.spec.reconcile.matchOn}.` : null,
    open_questions: v.spec.questions.filter(q => !q.answer).map(q => ({ id: q.id, question: q.question })),
    answered: v.spec.questions.filter(q => q.answer).map(q => `${q.question} → ${q.answer}`),
  };
}

/**
 * CSV or tab-separated text with a header line, as rows.
 * @param text - The rows.
 */
export function parseRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const sep = lines[0]!.includes('\t') ? '\t' : ',';
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of l) {
      if (ch === '"') {
        q = !q;
      } else if (ch === sep && !q) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]!);
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [head[i] ?? `col${i + 1}`, v])));
}

export function routineTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!ctx.userId || !enabled(ctx)) {
    return [];
  }
  const userId = ctx.userId;
  const svc = () => import('@/services/routines/RoutineService');
  const reads = () => import('@/services/routines/routineReads');
  const said = async (what: string) => {
    if (userId.startsWith('token:') && !ctx.turnIntent) {
      return true;
    }
    const { personSaidToDecide } = await import('../owedDecision');
    return (await personSaidToDecide(ctx, what)).said;
  };
  const find = async (ref: string | number) => (await reads()).findRoutine(ctx.orgId, ref);
  const ref = async (type: 'routine' | 'routine_batch' | 'artifact', id: number, label: string) => (await import('@/services/chat/recordContext')).recordRef(type, id, label);
  return [
    tool(
      async (raw: unknown) => {
        const args = raw as { slate_url: string; name?: string; note?: string; start_url?: string };
        const { startTeaching, waitForDraft, RoutineError, UNNAMED } = await svc();
        let out;
        try {
          out = await startTeaching({ orgId: ctx.orgId, userId, name: args.name?.trim() || UNNAMED, targetUrl: args.start_url?.trim() || null, note: args.note ?? null, slateUrl: args.slate_url, conversationId: ctx.conversationId ?? null });
        } catch (e) {
          if (e instanceof RoutineError) {
            return `Not started: ${e.message}`;
          }
          throw e;
        }
        ctx.emit({ type: 'record_created', record: await ref('routine', out.routine.id, out.routine.name) });
        ctx.emit({ type: 'step_progress', tool: 'routine_teach', note: 'Reading the recording' });
        const r = await waitForDraft(ctx.orgId, out.routine.id, TEACH_WAIT_MS) ?? out.routine;
        if (r.error) {
          return JSON.stringify({ routineId: r.id, error: r.error, note: 'Teaching failed. Say why in one line and what would fix it (for Slate: connect it on the Connections page with a session token).' });
        }
        if (r.teaching) {
          return JSON.stringify({ routineId: r.id, status: 'still reading the recording', note: 'Still drafting, beside the conversation. Say so in one line; the draft lands there and in this conversation when it is done.' });
        }
        return JSON.stringify({ ...specBrief(r), note: 'Drafted, beside the conversation. Tell the person in two or three sentences what the routine does, then list the open questions for its expert, numbered, word for word. Their answers and their approval go through routine_update. Do not answer the questions yourself.' });
      },
      {
        name: 'routine_teach',
        description: 'Teach a routine from a Slate recording: a person recorded themselves doing repeatable work in a web app and narrated why; the Routine analyst reads the recording (transcript, what was on screen, frames) and drafts the routine — steps linked to moments in the recording, rules, escalation points, inputs and outputs, and questions for its expert. Use when the person shares a Slate link and asks to teach, learn or make a routine from it. The person who asks is the routine\'s expert.',
        schema: { type: 'object', properties: { slate_url: { type: 'string', minLength: 8, maxLength: 2000, description: 'The Slate share link.' }, name: { type: 'string', maxLength: 120, description: 'What the person calls the routine, if they said.' }, note: { type: 'string', maxLength: 2000, description: 'Anything else they said about it.' }, start_url: { type: 'string', maxLength: 2000, description: 'The address the work starts at, when the person gave it (the site the recording was made on).' } }, required: ['slate_url'] },
      },
    ),
    tool(
      async (raw: unknown) => {
        const args = raw as { routine: string; answers?: Array<{ question_id: string; answer: string }>; rule?: string; approve?: boolean; trust?: 'drafted' | 'approved' | 'autonomous' };
        const r = await find(args.routine);
        if (!r) {
          return `No routine “${args.routine}” in this workspace.`;
        }
        const s = await svc();
        const done: string[] = [];
        try {
          for (const a of args.answers ?? []) {
            await s.answerRoutineQuestion(ctx.orgId, userId, r.id, a.question_id, a.answer);
            done.push(`answered ${a.question_id}`);
          }
          if (args.rule) {
            await s.addRoutineRule(ctx.orgId, userId, r.id, args.rule);
            done.push('added the rule');
          }
          if (args.approve) {
            if (!(await said(`approve the routine "${r.name}" so it can run`))) {
              return 'Not approved: approving a routine is its expert\'s own decision. Ask them.';
            }
            await s.approveRoutineVersion(ctx.orgId, userId, r.id);
            done.push('approved the draft');
          }
          if (args.trust) {
            if (!(await said(`set the routine "${r.name}" to ${args.trust} trust`))) {
              return 'Not changed: the trust level is its expert\'s own decision. Ask them.';
            }
            await s.setRoutineTrust(ctx.orgId, userId, r.id, args.trust);
            done.push(`set trust to ${TRUST_LABEL[args.trust]}`);
          }
        } catch (e) {
          if (e instanceof s.RoutineError) {
            return `Stopped after ${done.length > 0 ? done.join(', ') : 'nothing'}: ${e.message}`;
          }
          throw e;
        }
        ctx.emit({ type: 'record_created', record: await ref('routine', r.id, r.name) });
        const after = await (await reads()).getRoutine(ctx.orgId, r.id);
        return JSON.stringify({ done, ...(after ? specBrief(after) : {}), note: 'Say what changed in one line. At Approved trust the writes the spec names run without waiting; anything else still waits for a person.' });
      },
      {
        name: 'routine_update',
        description: 'Change a routine as its expert says: record their answers to the analyst\'s open questions (by question id, in their words), add a rule they give, approve the draft so it can run, or set its trust level (Drafted: every save waits; Approved: the saves the spec names run unattended). Only what the person said in this conversation; never answer or approve on their behalf.',
        schema: {
          type: 'object',
          properties: {
            routine: { type: 'string', description: 'The routine\'s id, slug or name.' },
            answers: { type: 'array', maxItems: 10, items: { type: 'object', properties: { question_id: { type: 'string' }, answer: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['question_id', 'answer'] } },
            rule: { type: 'string', maxLength: 600, description: 'A new rule, in the expert\'s words.' },
            approve: { type: 'boolean' },
            trust: { type: 'string', enum: ['drafted', 'approved', 'autonomous'] },
          },
          required: ['routine'],
        },
      },
    ),
    tool(
      async (raw: unknown) => {
        const args = raw as { routine: string; rows?: Array<Record<string, string>>; rows_csv?: string; shared?: Record<string, string> };
        const r = await find(args.routine);
        if (!r) {
          return `No routine “${args.routine}” in this workspace.`;
        }
        const rows = [...(args.rows ?? []), ...(args.rows_csv ? parseRows(args.rows_csv) : [])];
        if (rows.length === 0) {
          return 'No rows: give the rows (or the CSV with its header line) to run it for.';
        }
        if (!(await said(`run the routine "${r.name}" for ${rows.length} rows`))) {
          return `Not started: running “${r.name}” for ${rows.length} rows is the person's decision. Ask them to confirm.`;
        }
        const { startRoutineBatch, RoutineError } = await svc();
        let batch;
        try {
          batch = await startRoutineBatch({ orgId: ctx.orgId, userId, routineId: r.id, rows, shared: args.shared ?? {}, conversationId: ctx.conversationId ?? null });
        } catch (e) {
          if (e instanceof RoutineError) {
            return `Not started: ${e.message}`;
          }
          throw e;
        }
        ctx.emit({ type: 'record_created', record: await ref('routine_batch', batch.id, batchLabel(batch.id)) });
        const { batchStatusLine } = await reads();
        return JSON.stringify({ routineBatchId: batch.id, batch: batchLabel(batch.id), rows: batch.total, status: batchStatusLine(batch), skipped: batch.runs.filter(x => x.status === 'skipped').map(x => `${x.label}: ${x.summary}`), note: 'Started, beside the conversation: one browser run per row, several at once. Tell the person in one line. Escalations dock here as decisions for the expert; the batch says its result here when it ends. Do not wait for it or make up results.' });
      },
      {
        name: 'routine_run',
        description: 'Run an approved routine for many rows at once — one browser run per row (e.g. every person on a roster), in parallel, under the routine\'s version, rules and trust level. Rows this routine already did are skipped. Inputs every row shares (the sign-in email and password, the campaign) go in shared. Only when the person asked for it.',
        schema: {
          type: 'object',
          properties: {
            routine: { type: 'string', description: 'The routine\'s id, slug or name.' },
            rows: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: { type: 'string' } }, description: 'One object per row, keyed by the routine\'s input names.' },
            rows_csv: { type: 'string', maxLength: 200_000, description: 'Or the rows as CSV / tab-separated text with a header line, exactly as the person gave them.' },
            shared: { type: 'object', additionalProperties: { type: 'string' }, description: 'Inputs every row shares, by input name (sign-in email, password, the campaign).' },
          },
          required: ['routine'],
        },
      },
    ),
    tool(
      async (raw: unknown) => {
        const args = raw as { batch_id: number };
        const v = await (await reads()).getBatch(ctx.orgId, args.batch_id);
        if (!v) {
          return `No ${batchLabel(args.batch_id)} in this workspace.`;
        }
        const { batchStatusLine } = await reads();
        return JSON.stringify({
          routineBatchId: v.id,
          routine: v.routine.name,
          status: v.status,
          summary: batchStatusLine(v),
          waiting_on_expert: v.runs.filter(x => x.waiting).map(x => `${x.label}: ${x.waiting!.text.split('\n')[0]}`),
          not_done: v.runs.filter(x => ['failed', 'unknown_outcome', 'stopped'].includes(x.status)).map(x => `${x.label}: ${x.status} — ${x.error ?? x.summary ?? ''}`),
          findings: v.findings.map(f => ({ title: f.title, state: f.state, answer: f.answer, records: f.items.length })),
          cost: `$${(v.cents / 100).toFixed(2)}`,
          report: v.report?.url ?? null,
        });
      },
      {
        name: 'routine_check',
        description: 'Where a routine batch stands: how many rows are done and verified, what waits on the expert, what failed, and what it found.',
        schema: { type: 'object', properties: { batch_id: { type: 'integer', minimum: 1 } }, required: ['batch_id'] },
      },
    ),
    tool(
      async (raw: unknown) => {
        const args = raw as { batch_id: number };
        const { buildRoutineReport, RoutineError } = await svc();
        try {
          const rep = await buildRoutineReport(ctx.orgId, userId, args.batch_id);
          ctx.emit({ type: 'record_created', record: await ref('artifact', rep.artifactId, `${batchLabel(args.batch_id)} report`) });
          return JSON.stringify({ artifactId: rep.artifactId, url: rep.url, report: rep.markdown.slice(0, 6_000), note: 'The report is beside the conversation. Give the person its headline in three or four sentences: results, time against the manual baseline, cost, and any finding with the question it asks. Do not paste the tables.' });
        } catch (e) {
          if (e instanceof RoutineError) {
            return `No report: ${e.message}`;
          }
          throw e;
        }
      },
      {
        name: 'routine_report',
        description: 'Write the summary report of a routine batch, by batch id: results verified by read-back, escalations and how they were answered, human minutes against the manual baseline, run cost, and findings (records in the system that are not on the list). Filed as an artifact.',
        schema: { type: 'object', properties: { batch_id: { type: 'integer', minimum: 1 } }, required: ['batch_id'] },
      },
    ),
    tool(
      async () => {
        const all = await (await reads()).listRoutines(ctx.orgId);
        return JSON.stringify(all.slice(0, 30).map(r => ({ id: r.id, name: r.name, status: r.status, trust: TRUST_LABEL[r.trust], expert: r.expert?.name ?? null, version: r.version?.n ?? null, runs: r.stats.runs, lastBatchId: r.stats.lastBatchId })));
      },
      { name: 'routine_list', description: 'The workspace\'s routines: name, status, trust level, expert, version, runs.', schema: { type: 'object', properties: {} } },
    ),
  ];
}

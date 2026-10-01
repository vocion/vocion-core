/**
 * WHERE A PRODUCT RUNS, KEPT TRUE BY THE PIPELINE ITSELF (backlog 049; Chris,
 * 2026-09-30: "After a deploy, the environment record gets lastDeployedSha,
 * lastDeployedAt, lastDeployRunUrl and lastHealth from the run and a health
 * check, so drift is visible on the product page").
 *
 *   recordDeploy       a deploy-branch run finished (`run.succeeded`,
 *                      `run.failed`): every environment whose `deploy` names
 *                      that workflow — and, when it names one, the step that
 *                      deploys it, which must have run and passed — takes the
 *                      run's commit, time and URL, and its health is read.
 *   readHealth         the environment's `healthCheck` (its URL, and what the
 *                      answer must say): an address that does not answer or
 *                      answers 5xx is down, 4xx is degraded, and one that
 *                      answers is ok. Whether the answer says what `expect`
 *                      asks (the text itself, or a classifier's typed read,
 *                      never a match over prose) is advice on the record for
 *                      an operator, never the verdict.
 *   watchMissedDeploys a merge on the deploy branch with no run of its deploy
 *                      workflow after MISSED_DEPLOY_MS: the workflow is started
 *                      (`repo.dispatch_pipeline`, done for you) once per
 *                      commit — only for a workflow the branch's pushes always
 *                      start, read from its own `on:` block.
 *
 * Every line lands on the record's own `pipelineLog`, where its page and the
 * product's "Where it runs" read it. No product, stage or surface is named
 * here: the records say which workflow and step deploy them.
 */

import type { WorkflowRunSummary } from './githubChecks';
import { createHash } from 'node:crypto';

type Meta = Record<string, unknown>;
type Result = { recordId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Meta | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : null);

/** A merge the deploy branch took with no run of its deploy after this long is a missed deploy. */
export const MISSED_DEPLOY_MS = 20 * 60_000;
/** The most lines a record's pipeline log keeps. */
const LOG_MAX = 20;
/** How much of a health answer is read. */
const BODY_MAX = 20_000;

export type Health = 'ok' | 'degraded' | 'down';
/**
 * One health read. `read` is the classifier's verdict on `expect`, when it
 * was asked; `advice` is what the answer did not say, a note for an operator
 * that never changes `health`.
 */
export type HealthReading = { health: Health; status: number | null; detail: string; url: string; checkedAt: string; bodyHash: string | null; read?: { meets: boolean; why: string }; advice?: string };

/** One environment with the repository it is deployed from, resolved to `owner/name`. */
export type EnvironmentRow = { id: number; title: string; meta: Meta; repo: string | null };

/**
 * One line on a record's own pipeline log — what the pipeline did to it, with
 * the action run behind it (its Undo) and the link that proves it.
 * @param orgId - The workspace.
 * @param recordId - The record.
 * @param line - What happened, in a sentence.
 * @param o - Where it came from.
 * @param o.runId - The action run, when an action did it.
 * @param o.url - The run, pull request or page that shows it.
 * @param o.at - When.
 */
export async function noteOnRecord(orgId: string, recordId: number, line: string, o: { runId?: number | null; url?: string | null; at?: string } = {}): Promise<void> {
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  const record = await readRecord(orgId, recordId);
  if (!record) {
    return;
  }
  const at = o.at ?? new Date().toISOString();
  const prior = Array.isArray(record.meta.pipelineLog) ? record.meta.pipelineLog as Meta[] : [];
  const entry = { at, line: line.slice(0, 600), ...(o.runId ? { actionRunId: o.runId } : {}), ...(o.url ? { url: o.url } : {}) };
  await writeMeta(orgId, recordId, { pipelineLog: [...prior, entry].slice(-LOG_MAX), lastPipelineLine: entry.line, lastPipelineAt: at });
}

/**
 * `owner/name` from a repository URL or name.
 * @param v - `https://github.com/owner/name`, `owner/name`, or anything else.
 */
export function fullNameOf(v: unknown): string | null {
  const s = str(v);
  if (!s) {
    return null;
  }
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Every environment record, each with the repository it deploys from:
 * `repo` names a repository record by slug (its `url` says which), or is
 * `owner/name` itself.
 * @param orgId - The workspace.
 */
export async function environmentRows(orgId: string): Promise<EnvironmentRow[]> {
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const types = await (await import('@/libs/factory/types')).factoryTypes(orgId);
  const [envs, repos] = await Promise.all([
    listBusinessObjects(orgId, types.environment).catch(() => []) as Promise<Array<{ id: number; title: string; metadata: unknown }>>,
    listBusinessObjects(orgId, types.repo).catch(() => []) as Promise<Array<{ id: number; title: string; metadata: unknown }>>,
  ]);
  const bySlug = new Map(repos.map((r) => {
    const m = (r.metadata ?? {}) as Meta;
    return [str(m.slug) ?? r.title, fullNameOf(m.url) ?? fullNameOf(r.title)] as const;
  }));
  return envs.map((e) => {
    const meta = (e.metadata ?? {}) as Meta;
    const named = str(meta.repo);
    return { id: e.id, title: e.title, meta, repo: named ? (bySlug.get(named) ?? fullNameOf(named)) : null };
  });
}

/**
 * Whether a run is of the workflow an environment's `deploy` names: the
 * workflow's file (`.github/workflows/deploy.yml` or `deploy.yml`), or its name.
 * @param deploy - The environment's `deploy`.
 * @param run - The run.
 * @param run.path - Its workflow file.
 * @param run.name - Its workflow's name.
 */
export function deploysWith(deploy: Meta | null, run: { path?: string | null; name?: string | null }): boolean {
  const workflow = str(deploy?.workflow);
  if (!workflow) {
    return false;
  }
  const file = (p: string) => p.split('/').pop()!.toLowerCase();
  if (run.path && file(run.path) === file(workflow)) {
    return true;
  }
  return !!run.name && run.name.toLowerCase() === workflow.toLowerCase();
}

/**
 * Whether a run deployed this environment: the step its `deploy` names ran and
 * passed (in the job it names, when it names one); with no step named, the run
 * itself succeeded. `failed` when that step failed.
 * @param deploy - The environment's `deploy`.
 * @param conclusion - The run's conclusion.
 * @param jobs - The run's jobs and steps.
 */
export function deployedBy(deploy: Meta | null, conclusion: string | null, jobs: Array<{ name: string; steps: Array<{ name: string; conclusion: string | null }> }>): 'deployed' | 'failed' | 'not-this' {
  const step = str(deploy?.step);
  if (!step) {
    return conclusion === 'success' ? 'deployed' : 'failed';
  }
  const job = str(deploy?.job);
  const steps = jobs.filter(j => !job || j.name === job).flatMap(j => j.steps).filter(s => s.name === step);
  if (steps.some(s => s.conclusion === 'failure')) {
    return 'failed';
  }
  return steps.some(s => s.conclusion === 'success') ? 'deployed' : 'not-this';
}

/** What `readHealth` reads and asks, injected in tests. */
export type HealthDeps = {
  fetch: (url: string) => Promise<{ status: number; body: string }>;
  meets: (o: { orgId: string; expect: string; status: number; body: string }) => Promise<{ meets: boolean; why: string } | null>;
};

async function publicFetch(url: string): Promise<{ status: number; body: string }> {
  const { resolvesPublicly } = await import('@/libs/net/publicUrl');
  let at = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const verdict = await resolvesPublicly(at);
    if (!verdict.ok) {
      throw new Error(verdict.reason);
    }
    const res = await fetch(at, { redirect: 'manual', headers: { 'user-agent': 'vocion-health', 'accept': '*/*' }, signal: AbortSignal.timeout(15_000) });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (next) {
      at = new URL(next, at).toString();
      continue;
    }
    return { status: res.status, body: (await res.text().catch(() => '')).slice(0, BODY_MAX) };
  }
  throw new Error('it redirected more than three times');
}

/**
 * Whether a health answer says what `expect` asks, read by the classifier as
 * typed fields. Null when the read failed.
 * @param o - The expectation and the answer.
 * @param o.orgId - The workspace.
 * @param o.expect - What the answer must say, as the record words it.
 * @param o.status - The HTTP status.
 * @param o.body - The answer, cut.
 */
export async function expectationMet(o: { orgId: string; expect: string; status: number; body: string }): Promise<{ meets: boolean; why: string } | null> {
  try {
    const { z } = await import('zod');
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const schema = z.object({
      meets: z.boolean().describe('True when the response says what the expectation asks.'),
      why: z.string().max(200).describe('One line: what in the response settles it.'),
    });
    const model = await buildChatModelForOrg('classifier', o.orgId, { temperature: 0, streaming: false, maxTokens: 200 }) as unknown as { bindTools: (tools: unknown[], opts: unknown) => { invoke: (m: unknown[]) => Promise<{ tool_calls?: Array<{ name: string; args: unknown }> }> } };
    const report = tool(async () => 'recorded', { name: 'report_health', description: 'Report whether the health response meets the expectation.', schema: schema as never });
    const res = await model.bindTools([report], { tool_choice: 'report_health' }).invoke([
      new SystemMessage('You check a service\'s health response against what its record says the response must say. Judge only from the response, and only the parts of the expectation one response from this URL can show: what it says about other hosts, other paths or redirects elsewhere is not shown here and is not held against it. Answer only through the tool.'),
      new HumanMessage(`Expectation: ${o.expect}\n\nHTTP ${o.status}\n\nResponse (first ${BODY_MAX} characters):\n${o.body.slice(0, 8_000)}`),
    ]);
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const { FEATURES } = await import('@/libs/Langfuse/features');
    await chargeModelCall({ orgId: o.orgId, feature: FEATURES.HEALTH_READ, role: 'classifier', response: res as never }).catch(() => undefined);
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_health');
    const parsed = call ? schema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  } catch (err) {
    console.warn('health read: the expectation read failed', { orgId: o.orgId, message: (err as Error).message });
    return null;
  }
}

/**
 * Read an environment's health: its `healthCheck.url` (or its `url`), and
 * whether the answer says what `healthCheck.expect` asks. Null when it names
 * nothing to read.
 * @param orgId - The workspace.
 * @param env - The environment's metadata.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function readHealth(orgId: string, env: Meta, now: Date = new Date(), deps?: Partial<HealthDeps>): Promise<HealthReading | null> {
  const check = obj(env.healthCheck);
  const url = str(check?.url) ?? str(env.url);
  if (!url) {
    return null;
  }
  const checkedAt = now.toISOString();
  const get = deps?.fetch ?? publicFetch;
  let res: { status: number; body: string };
  try {
    res = await get(url);
  } catch (err) {
    return { health: 'down', status: null, detail: `${url} did not answer: ${(err as Error).message}`.slice(0, 300), url, checkedAt, bodyHash: null };
  }
  const bodyHash = createHash('sha256').update(`${res.status}\n${res.body}`).digest('hex').slice(0, 16);
  if (res.status >= 500) {
    return { health: 'down', status: res.status, detail: `${url} answered HTTP ${res.status}`, url, checkedAt, bodyHash };
  }
  if (res.status >= 400) {
    return { health: 'degraded', status: res.status, detail: `${url} answered HTTP ${res.status}`, url, checkedAt, bodyHash };
  }
  // AN ADDRESS THAT ANSWERS IS UP (2026-10-01: two production sites answering
  // HTTP 200 were filed as degraded incidents, because their `expect` also
  // described redirects on other hosts, which one answer cannot show). What
  // the answer says against `expect` is advice on the record, never the
  // verdict, so it cannot start a recovery or file an incident.
  const expect = str(check?.expect);
  const answered = `${url} answered HTTP ${res.status}`;
  if (!expect || res.body.includes(expect)) {
    return { health: 'ok', status: res.status, detail: expect ? `${answered} and says ${expect.slice(0, 80)}` : answered, url, checkedAt, bodyHash };
  }
  // The same answer as last time is the same read: the model reads each answer once.
  const last = obj(env.lastHealthRead);
  const read = last && last.bodyHash === bodyHash && last.expect === expect && typeof last.meets === 'boolean'
    ? { meets: last.meets, why: bareWhy(str(last.why) ?? '') }
    : await (deps?.meets ?? expectationMet)({ orgId, expect, status: res.status, body: res.body });
  if (!read) {
    return { health: 'ok', status: res.status, detail: `${answered}; whether it says "${expect.slice(0, 60)}" could not be read`, url, checkedAt, bodyHash };
  }
  return { health: 'ok', status: res.status, detail: read.meets ? `${answered}: ${read.why}` : answered, url, checkedAt, bodyHash, read, ...(read.meets ? {} : { advice: read.why }) };
}

/**
 * The model's own sentence, without the "<url> answered HTTP <n>:" prefixes
 * an earlier version stored with it and then wrapped again on every pass.
 * @param why - The stored reason.
 */
export function bareWhy(why: string): string {
  return why.replace(/^(?:\S+ answered HTTP \d{3}:\s*)+/, '').trim();
}

/**
 * The reading as the record keeps it.
 * @param r - The reading.
 * @param expect - The expectation it was read against.
 * @param meets - The model's verdict, when it read one.
 */
export function healthFields(r: HealthReading, expect?: string | null): Meta {
  return {
    lastHealth: r.health,
    lastHealthCheckedAt: r.checkedAt,
    lastHealthDetail: r.detail,
    lastHealthAdvice: r.advice ?? null,
    ...(expect && r.bodyHash && r.read ? { lastHealthRead: { bodyHash: r.bodyHash, expect, meets: r.read.meets, why: r.read.why } } : {}),
  };
}

/** Where `recordDeploy` reads GitHub, injected in tests. */
export type DeployDeps = {
  runJobs: (orgId: string, repo: string, runId: number) => Promise<Array<{ name: string; steps: Array<{ name: string; conclusion: string | null }> }>>;
  health: (orgId: string, env: Meta) => Promise<HealthReading | null>;
};

/**
 * A deploy-branch run finished: every environment it deployed takes its
 * commit, time and URL, and its health is read.
 * @param orgId - The workspace.
 * @param payload - The `run.succeeded` / `run.failed` payload.
 * @param deps - Injected in tests.
 */
export async function recordDeploy(orgId: string, payload: Meta, deps?: Partial<DeployDeps>): Promise<Result[]> {
  const repo = fullNameOf(payload.repo);
  const runId = Number(payload.runId);
  if (!repo || !Number.isInteger(runId) || runId <= 0) {
    return [{ recordId: null, did: 'no run named', line: null }];
  }
  const run = { path: str(payload.path), name: str(payload.name) };
  const envs = (await environmentRows(orgId)).filter(e => e.repo?.toLowerCase() === repo.toLowerCase() && deploysWith(obj(e.meta.deploy), run));
  if (envs.length === 0) {
    return [{ recordId: null, did: 'no environment deploys with this workflow', line: null }];
  }
  const gh = await import('./githubChecks');
  const jobs = await (deps?.runJobs ?? gh.runJobs)(orgId, repo, runId).catch(() => []);
  const { writeMeta } = await import('@/libs/actions/factory-dispatch');
  const out: Result[] = [];
  const conclusion = str(payload.conclusion);
  const sha = str(payload.headSha);
  const url = str(payload.url);
  const at = str(payload.completedAt) ?? new Date().toISOString();
  for (const env of envs) {
    const deploy = obj(env.meta.deploy);
    const verdict = deployedBy(deploy, conclusion, jobs);
    if (verdict === 'not-this') {
      continue;
    }
    const name = str(env.meta.slug) ?? env.title;
    if (verdict === 'failed') {
      const line = `Deploy run #${payload.runNumber ?? runId} on ${sha?.slice(0, 7) ?? '?'} did not deploy ${name}${str(deploy?.step) ? ` (step "${str(deploy?.step)}" failed)` : ` (${conclusion ?? 'failed'})`}; it is still on ${str(env.meta.lastDeployedSha)?.slice(0, 7) ?? 'its last deploy'}.`;
      await noteOnRecord(orgId, env.id, line, { url });
      out.push({ recordId: env.id, did: 'deploy failed', line });
      continue;
    }
    if (str(env.meta.lastDeployRunUrl) === url && str(env.meta.lastDeployedSha) === sha && env.meta.lastHealthCheckedAt) {
      out.push({ recordId: env.id, did: 'already recorded', line: null });
      continue;
    }
    const set: Meta = { lastDeployedSha: sha, lastDeployedAt: at, lastDeployRunUrl: url };
    const health = await (deps?.health ?? ((o, m) => readHealth(o, m)))(orgId, { ...env.meta, ...set }).catch(() => null);
    await writeMeta(orgId, env.id, { ...set, ...(health ? healthFields(health, str(obj(env.meta.healthCheck)?.expect)) : {}), ...(health?.health === 'ok' && sha ? { lastHealthySha: sha } : {}) });
    const line = `Deployed ${sha?.slice(0, 7) ?? '?'} to ${name} (run #${payload.runNumber ?? runId})${health ? `; ${health.health === 'ok' ? 'healthy' : health.health}: ${health.detail}` : '; no health check is recorded'}.`;
    await noteOnRecord(orgId, env.id, line, { url, at });
    out.push({ recordId: env.id, did: `deployed: ${health?.health ?? 'unchecked'}`, line });
  }
  return out;
}

/** Where `watchMissedDeploys` reads and acts, injected in tests. */
export type MissedDeps = {
  branchHead: (orgId: string, repo: string, branch: string) => Promise<{ sha: string; committedAt: string | null }>;
  runs: (orgId: string, repo: string, workflow: string, branch: string) => Promise<WorkflowRunSummary[]>;
  triggers: (orgId: string, repo: string, workflow: string, ref: string) => Promise<WorkflowTriggers | null>;
  deployBranch: (orgId: string, repo: string) => Promise<string | null>;
  dispatch: (orgId: string, o: { repo: string; workflow: string; ref: string; sha: string; recordId: number; reason: string; owner: string | null }) => Promise<{ runId: number; status: string; error?: string }>;
};

/** What a workflow's own `on:` block says starts it. */
export type WorkflowTriggers = { dispatchable: boolean; pushBranches: string[] | null; pathFiltered: boolean };

/**
 * The triggers a workflow file declares, read from its YAML.
 * @param text - The workflow file.
 * @param parse
 */
export function triggersOf(text: string, parse: (t: string) => unknown): WorkflowTriggers | null {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return null;
  }
  const on = (doc as Meta | null)?.on ?? (doc as Meta | null)?.true;
  const events: Meta = typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map(e => [String(e), null])) : (obj(on) ?? {});
  const push = 'push' in events ? obj(events.push) ?? {} : null;
  const branches = push ? (Array.isArray(push.branches) ? (push.branches as unknown[]).map(String) : []) : null;
  return {
    dispatchable: 'workflow_dispatch' in events,
    pushBranches: branches,
    pathFiltered: !!push && ('paths' in push || 'paths-ignore' in push),
  };
}

/**
 * A workflow's triggers, read from its file on a branch.
 * @param orgId - The workspace.
 * @param repo - `owner/name`.
 * @param workflow - The workflow file.
 * @param ref - The branch.
 */
export async function readWorkflowTriggers(orgId: string, repo: string, workflow: string, ref: string): Promise<WorkflowTriggers | null> {
  const { call, ghFor } = await import('./githubChecks');
  const path = workflow.includes('/') ? workflow.replace(/^\.?\//, '') : `.github/workflows/${workflow}`;
  const gh = await ghFor(orgId, repo);
  const res = await call<{ content?: string; encoding?: string }>(gh, `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
  if (!res.ok || !res.data.content) {
    return null;
  }
  const { Buffer } = await import('node:buffer');
  const { parse } = await import('yaml');
  return triggersOf(res.data.encoding === 'base64' ? Buffer.from(res.data.content, 'base64').toString('utf8') : res.data.content, parse);
}

async function defaultMissedDeps(): Promise<MissedDeps> {
  const gh = await import('./githubChecks');
  return {
    branchHead: gh.branchHead,
    runs: (orgId, repo, workflow, branch) => gh.listWorkflowRuns(orgId, repo, { workflow, branch, limit: 20 }),
    triggers: readWorkflowTriggers,
    deployBranch: async (orgId, repo) => {
      const { sourceConfigForRepo } = await import('@/services/agents/tools/githubPullRead');
      return str((await sourceConfigForRepo(orgId, repo))?.deployBranch);
    },
    dispatch: async (orgId, o) => {
      const { proposeAction } = await import('@/services/ActionService');
      const { DISPATCH_WORKFLOW_ACTION_ID } = await import('@/libs/actions/github-dispatch');
      return await proposeAction({
        orgId,
        actionId: DISPATCH_WORKFLOW_ACTION_ID,
        input: { repo: o.repo, workflow: o.workflow, ref: o.ref, sha: o.sha, recordId: o.recordId, reason: o.reason },
        principal: { kind: 'agent', id: `agent:${o.owner ?? 'system'}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: `agent:${o.owner ?? 'system'}`,
        internal: true,
        proposal: { confidence: 0.9, rationale: o.reason.slice(0, 500), agentSlug: o.owner ?? undefined, suggestedDecision: 'approve', suggestedDecisionReason: 'The merge was the decision; its deploy did not run.' },
      } as never) as { runId: number; status: string; error?: string };
    },
  };
}

/**
 * A merge on the deploy branch that its deploy never ran for: the deploy
 * workflow is started once for that commit, done for you. Only for a workflow
 * every push to the branch starts (no path filter) and that can be started by
 * hand; anything else says why it was not read.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param owner - The seat that owns the pipeline.
 * @param deps - Injected in tests.
 */
export async function watchMissedDeploys(orgId: string, now: Date, owner: string | null, deps?: MissedDeps): Promise<Result[]> {
  const envs = (await environmentRows(orgId)).filter(e => e.repo && str(obj(e.meta.deploy)?.workflow));
  if (envs.length === 0) {
    return [];
  }
  const d = deps ?? await defaultMissedDeps();
  const groups = new Map<string, EnvironmentRow[]>();
  for (const e of envs) {
    const key = `${e.repo!.toLowerCase()}|${str(obj(e.meta.deploy)?.workflow)!.split('/').pop()!.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: Result[] = [];
  for (const rows of groups.values()) {
    const first = rows[0]!;
    const repo = first.repo!;
    const workflow = str(obj(first.meta.deploy)?.workflow)!;
    try {
      const branch = await d.deployBranch(orgId, repo) ?? await (await import('./githubChange')).defaultBranch(orgId, repo);
      const head = await d.branchHead(orgId, repo, branch);
      const landed = head.committedAt ? Date.parse(head.committedAt) : Number.NaN;
      if (!Number.isFinite(landed) || now.getTime() - landed < MISSED_DEPLOY_MS) {
        continue;
      }
      const runs = await d.runs(orgId, repo, workflow, branch);
      if (runs.some(r => r.headSha === head.sha)) {
        continue;
      }
      // Already on this commit, or already started for it: nothing missed.
      if (rows.some(r => str(r.meta.lastDeployedSha) === head.sha || str(obj(r.meta.missedDeploy)?.sha) === head.sha)) {
        continue;
      }
      const triggers = await d.triggers(orgId, repo, workflow, branch);
      const { writeMeta } = await import('@/libs/actions/factory-dispatch');
      const minutes = Math.round((now.getTime() - landed) / 60_000);
      // Only a workflow every push to this branch starts can have missed one.
      const everyPush = !!triggers && triggers.pushBranches !== null && !triggers.pathFiltered && (triggers.pushBranches.length === 0 || triggers.pushBranches.includes(branch));
      if (!everyPush || !triggers!.dispatchable) {
        const why = !triggers ? 'its workflow file could not be read' : !everyPush ? 'not every push to the branch starts it' : 'it declares no workflow_dispatch, so it cannot be started from here';
        for (const r of rows) {
          await writeMeta(orgId, r.id, { missedDeploy: { sha: head.sha, at: now.toISOString(), started: false, why } });
        }
        if (everyPush) {
          const line = `${branch} of ${repo} is at ${head.sha.slice(0, 7)} for ${minutes} min with no run of ${workflow.split('/').pop()}, and ${why}.`;
          for (const r of rows) {
            await noteOnRecord(orgId, r.id, line);
          }
          out.push({ recordId: first.id, did: 'missed deploy: cannot start', line });
        }
        continue;
      }
      const reason = `${branch} of ${repo} took ${head.sha.slice(0, 7)} ${minutes} min ago and ${workflow.split('/').pop()} never ran for it.`;
      const res = await d.dispatch(orgId, { repo, workflow, ref: branch, sha: head.sha, recordId: first.id, reason, owner }).catch((err: Error) => ({ runId: 0, status: 'failed', error: err.message }));
      for (const r of rows) {
        await writeMeta(orgId, r.id, { missedDeploy: { sha: head.sha, at: now.toISOString(), started: res.status !== 'failed', actionRunId: res.runId || null } });
      }
      const line = res.status === 'failed'
        ? `${reason} Starting it failed: ${res.error ?? 'no reason given'}.`
        : res.status === 'pending'
          ? `${reason} Its start is on a card for a person (action #${res.runId}).`
          : `${reason} It was started (action #${res.runId}; Undo cancels the run).`;
      // The action notes the environment it names; the others that share the workflow hear it here.
      for (const r of rows.slice(res.status === 'done' ? 1 : 0)) {
        await noteOnRecord(orgId, r.id, line, { runId: res.runId || null });
      }
      out.push({ recordId: first.id, did: `missed deploy: ${res.status}`, line });
    } catch (err) {
      console.warn('missed-deploy watch: could not read', { orgId, repo, workflow, message: (err as Error).message });
    }
  }
  return out;
}

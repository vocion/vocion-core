import type { DurableContext } from './types';
import { z } from 'zod';
import { defineDurable } from './registry';
import { MAX_WAIT_SECONDS } from './types';

/**
 * A FLOW: A DURABLE RUN WRITTEN AS DATA (backlog 054).
 *
 * A plugin ships what a process does as a declarative definition (YAML), and
 * this interpreter runs it on the durable context. Core knows only the step
 * kinds; every name, event, action and sentence comes from the definition. So
 * the meaning of a process lives in its plugin and core stays a mechanism.
 *
 * Step kinds (each a map with one of these keys):
 *   - `do`: run a registered action through ActionService and its trust ladder;
 *     inputs with no value are left out; the output (`status`, `result`,
 *     `error`) is kept under `as`.
 *   - `wait_event`: the first `event_log` event matching any spec, with a
 *     timeout and a catch-up `since`; the event (or null) is kept under `as`.
 *   - `wait_message`: the next message on a topic (a person's word, a cancel).
 *   - `set`: assign variables from values, paths and a few typed operations.
 *   - `status`: what a page shows for the run.
 *   - `when`: the first branch whose condition holds runs.
 *   - `loop`: a bounded loop; `next` and `break` steer the innermost loop.
 *   - `child`: run another flow and keep its result.
 *   - `end`: finish the run with a stage.
 *
 * Values are read by path (`vars.x.y`, `input.x`), and strings may carry
 * `{{path}}` templates; a string that is one whole template keeps the value's
 * type. Conditions compare typed values. Nothing reads meaning out of text.
 *
 * Determinism: the definition is snapshotted into the run's input at start, so
 * a replay after a deploy walks the same steps; every effect and every clock
 * read is a recorded step, named in execution order.
 */

export const FLOW_RUN = 'vocion.flow';

type Value = unknown;
type Scope = { input: Record<string, Value>; vars: Record<string, Value> };

const PathCondition = z.object({
  path: z.string().min(1),
  equals: z.unknown().optional(),
  notEquals: z.unknown().optional(),
  in: z.array(z.unknown()).optional(),
  exists: z.boolean().optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
});
export type FlowCondition = z.infer<typeof PathCondition> | { all: FlowCondition[] } | { any: FlowCondition[] } | { not: FlowCondition };
const Condition: z.ZodType<FlowCondition> = z.lazy(() => z.union([
  z.object({ all: z.array(Condition) }).strict(),
  z.object({ any: z.array(Condition) }).strict(),
  z.object({ not: Condition }).strict(),
  PathCondition.strict(),
]));

const EventSpec = z.object({ types: z.array(z.string().min(1)).min(1), match: z.record(z.string(), z.unknown()).default({}) });

export type FlowStep = Record<string, unknown>;
const Step: z.ZodType<FlowStep> = z.lazy(() => z.union([
  z.object({ do: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}), as: z.string().optional(), by: z.string().optional() }).strict(),
  z.object({ wait_event: z.object({ any: z.array(EventSpec).min(1), timeout: z.union([z.number().positive(), z.string()]), since: z.string().optional() }).strict(), as: z.string().min(1) }).strict(),
  z.object({ wait_message: z.object({ topic: z.string().min(1), timeout: z.union([z.number().positive(), z.string()]) }).strict(), as: z.string().min(1) }).strict(),
  z.object({ set: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ status: z.object({ stage: z.string().min(1), line: z.string(), with: z.record(z.string(), z.unknown()).optional() }).strict() }).strict(),
  z.object({ when: z.array(z.union([z.object({ if: Condition, then: z.array(Step) }).strict(), z.object({ else: z.array(Step) }).strict()])).min(1) }).strict(),
  z.object({ loop: z.object({ max: z.number().int().positive(), while: Condition.optional(), steps: z.array(Step) }).strict() }).strict(),
  z.object({ child: z.object({ flow: z.string().min(1), id: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) }).strict(), as: z.string().optional() }).strict(),
  z.object({ next: z.literal(true) }).strict(),
  z.object({ break: z.literal(true) }).strict(),
  z.object({ end: z.object({ stage: z.string().min(1) }).strict() }).strict(),
]));

export const FlowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** Variables every run starts with. */
  vars: z.record(z.string(), z.unknown()).default({}),
  /** Merged into every `status` step (e.g. the attempt and base a page shows). */
  status_with: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(Step),
});
export type Flow = z.infer<typeof FlowSchema>;

/** What a flow does in the world, injected in tests. */
export type FlowEffects = {
  runAction: (orgId: string, actionId: string, input: Record<string, Value>, invokedBy: string) => Promise<{ status: string; result: Record<string, Value> | null; error: string | null }>;
};

export type FlowRunInput = { orgId: string; flowRef: string; flow: Flow; input: Record<string, Value> };

// ---------- values ----------

/**
 * The value at a dotted path, or undefined.
 * @param scope - Input and variables.
 * @param path - `input.x`, `vars.x.y`.
 */
export function readPath(scope: Scope, path: string): Value {
  const parts = path.split('.');
  let cur: Value = parts[0] === 'input' ? scope.input : parts[0] === 'vars' ? scope.vars : undefined;
  for (const p of parts.slice(1)) {
    if (cur === null || cur === undefined || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, Value>)[p];
  }
  return cur;
}

const WHOLE = /^\{\{\s*([\w.]+)\s*\}\}$/;
const ANY = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * A value with its templates filled from the scope: a string that is one
 * whole `{{path}}` keeps the value's type; mixed text becomes text; maps and
 * lists are filled through.
 * @param v - The value.
 * @param scope - Input and variables.
 */
export function fill(v: Value, scope: Scope): Value {
  if (typeof v === 'string') {
    const whole = WHOLE.exec(v);
    if (whole) {
      return readPath(scope, whole[1]!);
    }
    return v.replace(ANY, (_m, p: string) => {
      const x = readPath(scope, p);
      return x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x);
    });
  }
  if (Array.isArray(v)) {
    return v.map(x => fill(x, scope));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, Value>).map(([k, x]) => [k, fill(x, scope)]));
  }
  return v;
}

/**
 * Whether a condition holds over typed values.
 * @param c - The condition.
 * @param scope - Input and variables.
 */
export function holds(c: FlowCondition, scope: Scope): boolean {
  if ('all' in c) {
    return c.all.every(x => holds(x, scope));
  }
  if ('any' in c) {
    return c.any.some(x => holds(x, scope));
  }
  if ('not' in c) {
    return !holds(c.not, scope);
  }
  const v = readPath(scope, c.path);
  if (c.exists !== undefined && (v !== null && v !== undefined) !== c.exists) {
    return false;
  }
  if ('equals' in c && c.equals !== undefined && v !== fill(c.equals, scope)) {
    return false;
  }
  if ('notEquals' in c && c.notEquals !== undefined && v === fill(c.notEquals, scope)) {
    return false;
  }
  if (c.in && !c.in.map(x => fill(x, scope)).includes(v)) {
    return false;
  }
  if (c.gt !== undefined && !(typeof v === 'number' && v > c.gt)) {
    return false;
  }
  if (c.lt !== undefined && !(typeof v === 'number' && v < c.lt)) {
    return false;
  }
  return true;
}

/**
 * A value with its null and missing entries left out, so an optional input a
 * run has no value for is absent rather than null.
 * @param v - The value.
 */
export function compact(v: Value): Value {
  if (Array.isArray(v)) {
    return v.map(compact);
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, Value>).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, compact(x)]));
  }
  return v;
}

const OPS = new Set(['value', 'from', 'first', 'add', 'now', 'if']);

// ---------- the interpreter ----------

type Signal = 'next' | 'break' | { end: string } | undefined;

class Runner {
  private seq = 0;
  constructor(private ctx: DurableContext, private flow: Flow, private orgId: string, private effects: FlowEffects, private scope: Scope) {}

  private name(kind: string): string {
    return `${kind}-${this.seq++}`;
  }

  private async evaluate(v: Value): Promise<Value> {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && OPS.has(keys[0]!)) {
        const op = keys[0]!;
        const arg = (v as Record<string, Value>)[op];
        if (op === 'value') {
          return fill(arg, this.scope);
        }
        if (op === 'from') {
          return readPath(this.scope, String(arg));
        }
        if (op === 'first') {
          for (const x of arg as Value[]) {
            const got = await this.evaluate(x);
            if (got !== null && got !== undefined) {
              return got;
            }
          }
          return null;
        }
        if (op === 'add') {
          let sum = 0;
          for (const x of arg as Value[]) {
            sum += Number(await this.evaluate(x)) || 0;
          }
          return sum;
        }
        if (op === 'now') {
          return this.ctx.step(this.name('now'), async () => new Date().toISOString());
        }
        const branch = arg as { cond: FlowCondition; then: Value; else?: Value };
        return holds(branch.cond, this.scope) ? this.evaluate(branch.then) : this.evaluate(branch.else ?? null);
      }
    }
    return fill(v, this.scope);
  }

  private async waitChunks<T>(timeout: number, wait: (seconds: number, first: boolean) => Promise<T | null>): Promise<T | null> {
    for (let waited = 0; waited < timeout; waited += MAX_WAIT_SECONDS) {
      const got = await wait(Math.min(MAX_WAIT_SECONDS, timeout - waited), waited === 0);
      if (got !== null) {
        return got;
      }
    }
    return null;
  }

  async steps(list: FlowStep[]): Promise<Signal> {
    for (const s of list) {
      const signal = await this.one(s);
      if (signal) {
        return signal;
      }
    }
    return undefined;
  }

  private async one(s: FlowStep): Promise<Signal> {
    const st = s as Record<string, any>;
    if ('do' in st) {
      const input = compact(fill(st.input ?? {}, this.scope)) as Record<string, Value>;
      const by = st.by ? String(fill(st.by, this.scope)) : `workflow:${this.flow.name}`;
      const out = await this.ctx.step(this.name('do'), () => this.effects.runAction(this.orgId, st.do, input, by));
      if (st.as) {
        this.scope.vars[st.as] = out;
      }
      return undefined;
    }
    if ('wait_event' in st) {
      const w = st.wait_event as { any: Array<{ types: string[]; match: Record<string, Value> }>; timeout: number | string; since?: string };
      const any = w.any.map(spec => ({ types: spec.types, match: fill(spec.match, this.scope) as Record<string, unknown> }));
      const since = w.since ? fill(w.since, this.scope) : undefined;
      const label = this.name('wait');
      let chunk = 0;
      const ev = await this.waitChunks(Number(fill(w.timeout, this.scope)), (seconds, first) => this.ctx.waitForEvent(`${label}.${chunk++}`, {
        orgId: this.orgId,
        any,
        timeoutSeconds: seconds,
        since: first && typeof since === 'string' && since ? since : undefined,
      }));
      this.scope.vars[st.as] = ev;
      return undefined;
    }
    if ('wait_message' in st) {
      const w = st.wait_message as { topic: string; timeout: number | string };
      const msg = await this.waitChunks(Number(fill(w.timeout, this.scope)), seconds => this.ctx.waitFor<Value>(String(fill(w.topic, this.scope)), seconds));
      this.scope.vars[st.as] = msg;
      return undefined;
    }
    if ('set' in st) {
      for (const [k, v] of Object.entries(st.set as Record<string, Value>)) {
        this.scope.vars[k] = await this.evaluate(v);
      }
      return undefined;
    }
    if ('status' in st) {
      const extra = fill({ ...(this.flow.status_with ?? {}), ...(st.status.with ?? {}) }, this.scope) as Record<string, Value>;
      await this.ctx.setStatus({ ...extra, stage: String(fill(st.status.stage, this.scope)), line: String(fill(st.status.line, this.scope)) });
      return undefined;
    }
    if ('when' in st) {
      for (const branch of st.when as Array<{ if?: FlowCondition; then?: FlowStep[]; else?: FlowStep[] }>) {
        if (branch.else) {
          return this.steps(branch.else);
        }
        if (branch.if && holds(branch.if, this.scope)) {
          return this.steps(branch.then ?? []);
        }
      }
      return undefined;
    }
    if ('loop' in st) {
      const l = st.loop as { max: number; while?: FlowCondition; steps: FlowStep[] };
      for (let i = 0; i < l.max; i++) {
        if (l.while && !holds(l.while, this.scope)) {
          break;
        }
        const signal = await this.steps(l.steps);
        if (signal === 'break') {
          break;
        }
        if (signal && signal !== 'next') {
          return signal;
        }
      }
      return undefined;
    }
    if ('child' in st) {
      const c = st.child as { flow: string; id: string; input: Record<string, Value> };
      const { loadFlow } = await import('./flowDefinitions');
      const flow = await this.ctx.step(this.name('child-def'), async () => loadFlow(c.flow));
      const out = await this.ctx.child<FlowRunInput, { stage: string }>(FLOW_RUN, String(fill(c.id, this.scope)), { orgId: this.orgId, flowRef: c.flow, flow, input: fill(c.input, this.scope) as Record<string, Value> });
      if (st.as) {
        this.scope.vars[st.as] = out;
      }
      return undefined;
    }
    if ('next' in st) {
      return 'next';
    }
    if ('break' in st) {
      return 'break';
    }
    if ('end' in st) {
      return { end: String(fill(st.end.stage, this.scope)) };
    }
    throw new Error(`flow "${this.flow.name}": a step with no kind (${Object.keys(st).join(', ')})`);
  }
}

/**
 * Run a flow to its end on the durable context.
 * @param ctx - The durable context.
 * @param run - The workspace, the snapshotted flow and its input.
 * @param effects - How actions are run.
 */
export async function runFlow(ctx: DurableContext, run: FlowRunInput, effects: FlowEffects): Promise<{ stage: string }> {
  const flow = FlowSchema.parse(run.flow);
  const scope: Scope = { input: { ...run.input, orgId: run.orgId }, vars: structuredClone(flow.vars) };
  const signal = await new Runner(ctx, flow, run.orgId, effects, scope).steps(flow.steps);
  return { stage: signal && typeof signal === 'object' ? signal.end : 'done' };
}

/** Actions run through ActionService and its trust ladder, as the flow's own principal. */
export const productionFlowEffects: FlowEffects = {
  async runAction(orgId, actionId, input, invokedBy) {
    const { proposeAction } = await import('@/services/ActionService');
    try {
      const res = await proposeAction({
        orgId,
        actionId,
        input,
        principal: { kind: 'agent', id: 'agent:workflow', scope: { orgId }, grants: ['*'], autonomy: 5 },
        invokedBy,
        internal: true,
      }) as { status: string; result?: Record<string, Value> | null; error?: string | null };
      return { status: res.status, result: (res.result ?? null) as Record<string, Value> | null, error: res.error ?? null };
    } catch (err) {
      return { status: 'refused', result: null, error: (err as Error).message };
    }
  },
};

export const flowRunDefinition = defineDurable<FlowRunInput, { stage: string }>({
  name: FLOW_RUN,
  run: (ctx, input) => runFlow(ctx, input, productionFlowEffects),
});

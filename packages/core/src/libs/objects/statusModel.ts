/**
 * ONE STATUS FIELD, READ FROM THE TYPE (Chris, 2026-10-02: "Can we get one
 * enum list. Or maybe a hierarchy of status labels that run the logic for
 * those 3 tabs. And manage that field on the feature object.").
 *
 * A record's place used to be rebuilt by each view from half a dozen fields
 * (a state, a recovery stage, a recommendation, ship and reopen times, a
 * delivery, a workflow's status), and the views drifted: FE-224 shipped while
 * its state read `building`; FE-130 waited on a person's merge while Work read
 * "Awaiting dispatch". Now a type declares one enum field whose every value
 * belongs to exactly one GROUP, and the group is where the record stands. The
 * writers set the field at each transition; every view reads it.
 *
 * Core holds the mechanism only. The values, their labels, their groups and
 * which transition writes which value are the type's (the software factory's
 * request type declares them); nothing here names one.
 *
 *     status:
 *       type: string
 *       enum: [new, building, shipped, …]
 *       x-display: {label: Status, format: badge, tones: {building: info, …}}
 *       x-labels: {new: Not triaged, awaiting_merge: Waiting on your merge, …}
 *       x-groups:
 *         - {key: progress, label: In progress, role: progress, default: true, in: [building, …]}
 *         - {key: proposed, label: Proposed, role: proposed, in: [new, …], last: [deferred]}
 *         - {key: done, label: Done, role: done, in: [shipped, …]}
 *         - {key: archived, label: Archived, role: archived, in: [out_of_scope, …]}
 *       x-needs-you: [awaiting_merge, …]
 *       x-transitions: {building: building, 'state:shipped': shipped, …}
 *       x-tell: {stopped: 'Blocked, needs you: {line}', live: 'Done: {title} is live. {line}', …}
 *
 * A null or unknown value belongs to the group marked `default` (Chris: "Stick
 * nulls together with the in progress column").
 */

/** What a group does on a page: drawn as work under way, a queue, finished, or not drawn. */
export type StatusRole = 'progress' | 'proposed' | 'done' | 'archived';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export type StatusGroup = {
  key: string;
  label: string;
  role: StatusRole;
  in: string[];
  /** Values that sort after the rest of the group (a person's "not now"). */
  last: string[];
  default: boolean;
};

export type StatusModel = {
  /** The metadata key that holds the status (`<field>Line` and `<field>At` ride beside it). */
  field: string;
  groups: StatusGroup[];
  labels: Record<string, string>;
  tones: Record<string, StatusTone>;
  needsYou: ReadonlySet<string>;
  /** Transition name → value, in declared order (the first match wins when a write fires several). */
  transitions: Array<[string, string]>;
  /**
   * Transition name → what the person who asked is told, where they asked (`x-tell`). `{line}` is
   * the step's sentence and `{title}` the record's. A transition not named here is not said.
   */
  tell: Record<string, string>;
};

/** Where a value stands: its group, its words and its tone. */
export type StatusPlace = {
  value: string | null;
  group: StatusGroup;
  label: string;
  tone: StatusTone;
  needsYou: boolean;
};

const ROLES = new Set<StatusRole>(['progress', 'proposed', 'done', 'archived']);
const TONES = new Set<StatusTone>(['ok', 'warn', 'bad', 'info', 'muted']);

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s !== '') : [];
}

/**
 * The status model a type declares: the first property carrying `x-groups`.
 * Null when the type declares none, or declares one that cannot be read (no
 * group, or no default group for a null value to land in).
 * @param schema - The type's JSON schema.
 */
export function readStatusModel(schema: unknown): StatusModel | null {
  const properties = obj(obj(schema).properties);
  for (const [field, raw] of Object.entries(properties)) {
    const prop = obj(raw);
    if (!Array.isArray(prop['x-groups'])) {
      continue;
    }
    const groups: StatusGroup[] = (prop['x-groups'] as unknown[]).map(obj).flatMap((g) => {
      const key = typeof g.key === 'string' ? g.key : '';
      const role = (typeof g.role === 'string' ? g.role : key) as StatusRole;
      if (!key || !ROLES.has(role)) {
        return [];
      }
      return [{ key, label: typeof g.label === 'string' && g.label ? g.label : key, role, in: strings(g.in), last: strings(g.last), default: g.default === true }];
    });
    if (groups.length === 0 || !groups.some(g => g.default)) {
      return null;
    }
    const labels = Object.fromEntries(Object.entries(obj(prop['x-labels'])).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const tones = Object.fromEntries(Object.entries(obj(obj(prop['x-display']).tones)).filter(([, v]) => TONES.has(v as StatusTone))) as Record<string, StatusTone>;
    const transitions = Object.entries(obj(prop['x-transitions'])).filter((e): e is [string, string] => typeof e[1] === 'string');
    const tell = Object.fromEntries(Object.entries(obj(prop['x-tell'])).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as Record<string, string>;
    return { field, groups, labels, tones, needsYou: new Set(strings(prop['x-needs-you'])), transitions, tell };
  }
  return null;
}

/**
 * The group a value belongs to; a null or unknown value is the default group's.
 * @param model - The model.
 * @param value - The value.
 */
export function groupOf(model: StatusModel, value: unknown): StatusGroup {
  const v = typeof value === 'string' ? value : '';
  return model.groups.find(g => g.in.includes(v)) ?? model.groups.find(g => g.default)!;
}

/**
 * Where a record stands, read off its status field.
 * @param model - The model.
 * @param meta - The record's metadata.
 */
export function placeOf(model: StatusModel, meta: Record<string, unknown> | null | undefined): StatusPlace {
  const raw = (meta ?? {})[model.field];
  const value = typeof raw === 'string' && raw !== '' ? raw : null;
  const group = groupOf(model, value);
  const known = value !== null && group.in.includes(value);
  return {
    value,
    group,
    // An unknown value says itself rather than borrowing a label; no value
    // reads as its group.
    label: known ? (model.labels[value] ?? value.replace(/_/g, ' ')) : value ?? group.label,
    tone: (value && model.tones[value]) || 'muted',
    needsYou: value !== null && model.needsYou.has(value),
  };
}

/**
 * The value a named transition writes, or null when the type declares none.
 * @param model - The model.
 * @param transition - The transition, e.g. `building` or `state:shipped`.
 */
export function valueFor(model: StatusModel, transition: string): string | null {
  return model.transitions.find(([name]) => name === transition)?.[1] ?? null;
}

/**
 * The status a write of other fields carries with it, for writers that speak
 * in the type's other fields (an agent setting `state: triaged`, a person
 * dismissing a proposal). A write of field F to value V fires the transition
 * `F:V`, and `F:*` for any non-empty V; the first declared match wins. Null
 * when the write sets the status itself, or fires nothing.
 * @param model - The model.
 * @param set - The fields being written.
 */
export function followedStatus(model: StatusModel, set: Record<string, unknown>): string | null {
  if (model.field in set) {
    return null;
  }
  const fired = new Set<string>();
  for (const [k, v] of Object.entries(set)) {
    if (v === null || v === undefined || v === '' || v === 0 || v === false) {
      continue;
    }
    fired.add(`${k}:*`);
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      fired.add(`${k}:${String(v)}`);
    }
  }
  return model.transitions.find(([name]) => fired.has(name))?.[1] ?? null;
}

/**
 * `set` with the status it carries, when it carries one (`followedStatus`).
 * @param model - The model, or null when the type declares none.
 * @param set - The fields being written.
 * @param at - When.
 */
export function withFollowedStatus<T extends Record<string, unknown>>(model: StatusModel | null, set: T, at: string = new Date().toISOString()): T {
  const value = model ? followedStatus(model, set) : null;
  return value === null ? set : { ...set, [model!.field]: value, [`${model!.field}Line`]: null, [`${model!.field}At`]: at };
}

/**
 * Whether a write would move a finished record back into the work. An
 * automatic step never does that (FE-224: a late QA verdict wrote `building`
 * over a shipped request); a person's word does, by saying so.
 * @param model - The model.
 * @param from - The current value.
 * @param to - The value being written.
 */
export function reopens(model: StatusModel, from: unknown, to: string): boolean {
  const before = typeof from === 'string' && from !== '' ? groupOf(model, from) : null;
  const after = groupOf(model, to);
  return before !== null && (before.role === 'done' || before.role === 'archived') && (after.role === 'progress' || after.role === 'proposed');
}

/**
 * A new record's metadata with its first status: what its fields carry, else
 * the type's `created` transition. Unchanged when the type declares no
 * status or the record names one.
 * @param schema - The type's JSON schema.
 * @param meta - The new record's metadata.
 * @param at - When.
 */
export function createdStatus<T extends Record<string, unknown>>(schema: unknown, meta: T, at: string = new Date().toISOString()): T {
  const model = readStatusModel(schema);
  if (!model || model.field in meta) {
    return meta;
  }
  const value = followedStatus(model, meta) ?? valueFor(model, 'created');
  return value === null ? meta : { ...meta, [model.field]: value, [`${model.field}At`]: at };
}

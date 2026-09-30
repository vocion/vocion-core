/**
 * EVERY NEW FEATURE WITH A UI GETS ITS MOCKUP, HANDS-OFF — the decisions
 * (pure). The reads, writes and the event are `services/factory/mockupDefault.ts`.
 *
 * Chris, 2026-09-30, of the 09-25 mockups (#124, #130): *"I love this style of
 * generated images in mocks for feature cards. As the primary … that should be
 * the standard for all new features and mocks … build that capability and
 * default into new features."* On production none of the eleven requests filed
 * since #224 had a mockup: drawing one waited on somebody asking the designer.
 *
 * So a record that owes a mockup gets one without anyone asking, beside the
 * work and never in front of it:
 *
 *   - WHO OWES ONE is the plugin's to say, never core's. The automation's
 *     `do.input` carries the rule — `owedWhen: {field: surface, oneOf: [ui,
 *     flow]}` and `skipWhen` (a bug wants a reproduction, a closed request
 *     nothing) — so core names no type, field or value.
 *   - IT NEVER HOLDS ANYTHING. Filing, triage, planning and the build carry
 *     on; the drawing runs as its own fire.
 *   - NOTHING FAILS SILENTLY. The record carries where the drawing stands
 *     (`visuals.mockupDraw`): drawing since when, or why it drew nothing.
 *     A first attempt that draws nothing is tried once more, carrying its
 *     reason; a second is written down and left — the feature page says so,
 *     and asking the designer draws it.
 */

import { z } from 'zod';

/** One condition on a record field: its value is one of these. */
export const FieldRuleSchema = z.object({
  /** A metadata field, dotted for a nested one (`visuals.surfaceUrl`). */
  field: z.string().min(1),
  oneOf: z.array(z.string()).min(1),
});
export type FieldRule = z.infer<typeof FieldRuleSchema>;

/** The plugin's rule, as the automation's `do.input` carries it. */
export const MockupRuleSchema = z.object({
  /** The record owes a mockup when this holds (the surface a person sees). */
  owedWhen: FieldRuleSchema,
  /** ...and none of these do. */
  skipWhen: z.array(FieldRuleSchema).default([]),
  /** Attempts in all: the first, and the one retry. */
  attempts: z.number().int().min(1).max(3).default(2),
});
export type MockupRule = z.infer<typeof MockupRuleSchema>;

/** Where the default drawing stands, on the record (`visuals.mockupDraw`). */
export type MockupDraw = {
  state: 'drawing' | 'failed';
  attempt: number;
  /** When this attempt started, or when it failed. */
  at: string;
  /** Why it drew nothing — on a failure, and carried into the retry. */
  reason?: string;
  /** The fire that drew (or did not), so the reason is one move from its run. */
  automationRunId?: number;
  /**
   * Where it failed, as the drawing tool typed it (`MockupFailure.cause`):
   * `infrastructure` — this installation cannot draw (its operator is told,
   * a person reads only that); `content` — the drawing was refused.
   */
  cause?: 'infrastructure' | 'content';
};

/** A drawing that started this long ago and never ended is lost, not running. */
export const DRAW_LOST_MS = 60 * 60_000;

type Meta = Record<string, unknown>;

function bag(v: unknown): Meta {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Meta : {};
}

/**
 * A field's value, dotted paths included, as the string a rule compares.
 * @param meta - The record's metadata.
 * @param field - The field.
 */
export function fieldValue(meta: Meta, field: string): string | null {
  let at: unknown = meta;
  for (const part of field.split('.')) {
    at = bag(at)[part];
  }
  return typeof at === 'string' && at.trim() !== '' ? at.trim() : typeof at === 'number' || typeof at === 'boolean' ? String(at) : null;
}

/**
 * The drawing's state on the record, or null.
 * @param meta - The record's metadata.
 */
export function readMockupDraw(meta: Meta): MockupDraw | null {
  const d = bag(bag(meta.visuals).mockupDraw);
  if ((d.state !== 'drawing' && d.state !== 'failed') || typeof d.at !== 'string') {
    return null;
  }
  return {
    state: d.state,
    attempt: Number.isInteger(d.attempt) ? Number(d.attempt) : 1,
    at: d.at,
    ...(typeof d.reason === 'string' && d.reason !== '' ? { reason: d.reason } : {}),
    ...(Number.isInteger(d.automationRunId) ? { automationRunId: Number(d.automationRunId) } : {}),
    ...(d.cause === 'infrastructure' || d.cause === 'content' ? { cause: d.cause } : {}),
  };
}

/**
 * Whether the record already carries its mockups (or a written reason for none).
 * @param meta - The record's metadata.
 */
export function hasMockups(meta: Meta): boolean {
  const v = bag(meta.visuals);
  return (Array.isArray(v.mockupArtifactIds) && v.mockupArtifactIds.length > 0);
}

export type MockupDecision
  = | { do: 'draw'; attempt: number; lastFailure?: string; afterInfrastructure?: true }
    | { do: 'skip'; why: string };

/**
 * Should the designer draw this record's mockup now?
 * @param meta - The record's metadata.
 * @param rule - The plugin's rule.
 * @param now - The clock.
 * @param changed - On an update, the fields it wrote; a write that touched
 *   none of the rule's fields changes nothing, so nothing is read for it.
 */
export function mockupDecision(meta: Meta, rule: MockupRule, now: Date, changed?: readonly string[] | null): MockupDecision {
  if (changed && changed.length > 0) {
    const roots = [rule.owedWhen, ...rule.skipWhen].map(r => r.field.split('.')[0]!);
    if (!changed.some(f => roots.includes(f.split('.')[0]!))) {
      return { do: 'skip', why: 'the write changed nothing the rule reads' };
    }
  }
  const owed = fieldValue(meta, rule.owedWhen.field);
  if (owed === null || !rule.owedWhen.oneOf.includes(owed)) {
    return { do: 'skip', why: `no UI to draw: ${rule.owedWhen.field} is ${owed ?? 'not set'}` };
  }
  for (const s of rule.skipWhen) {
    const v = fieldValue(meta, s.field);
    if (v !== null && s.oneOf.includes(v)) {
      return { do: 'skip', why: `${s.field} is ${v}` };
    }
  }
  if (hasMockups(meta)) {
    return { do: 'skip', why: 'it already has mockups' };
  }
  // A written reason for no visual does not stand in for the mockup on a UI
  // surface: the filing gate asks for a visual or a reason, and request #277
  // (2026-09-30) was filed with "Mockup owed from the designer before
  // dispatch", which this read as "none needed" and skipped. Drawing never
  // holds anything up; a change with truly nothing to show is the designer's
  // to say when it tries.
  const draw = readMockupDraw(meta);
  if (draw?.state === 'drawing') {
    const age = now.getTime() - new Date(draw.at).getTime();
    if (age < DRAW_LOST_MS) {
      return { do: 'skip', why: `already being drawn (attempt ${draw.attempt})` };
    }
    // Lost: it started and never ended. That counts as an attempt.
    return draw.attempt < rule.attempts
      ? { do: 'draw', attempt: draw.attempt + 1, lastFailure: 'the last drawing started and never finished' }
      : { do: 'skip', why: 'lost' };
  }
  // THE INSTALLATION COULD NOT DRAW: nothing about the record was wrong, so
  // once its operator has had time to fix it, it is drawn again from the
  // start — the caller checks the installation can draw first
  // (`afterInfrastructure`), so a still-broken one spends no run.
  if (draw?.state === 'failed' && draw.cause === 'infrastructure') {
    return now.getTime() - new Date(draw.at).getTime() >= DRAW_LOST_MS
      ? { do: 'draw', attempt: 1, afterInfrastructure: true }
      : { do: 'skip', why: 'this installation could not draw it; its operator is told' };
  }
  if (draw?.state === 'failed') {
    return { do: 'skip', why: `drew nothing after ${draw.attempt} attempt${draw.attempt === 1 ? '' : 's'}: ${draw.reason ?? 'no reason recorded'}` };
  }
  return { do: 'draw', attempt: 1 };
}

export type MockupAfterRun
  = | { do: 'done'; why: string }
    | { do: 'retry'; attempt: number; mark: MockupDraw; line: string }
    | { do: 'give-up'; mark: MockupDraw; line: string };

/**
 * A drawing fire ended: drawn, tried once more with its reason, or written down.
 * @param meta - The record's metadata, read after the fire.
 * @param rule - The plugin's rule (for the attempt count).
 * @param ended - What the fire left.
 * @param ended.reason - Why it drew nothing — the fire's error, or the tool's last answer.
 * @param ended.automationRunId - The fire.
 * @param ended.attempt - Which attempt it was, when the record lost track.
 * @param ended.cause - Where it failed, when the fire knows.
 * @param now - The clock.
 */
export function mockupAfterRun(meta: Meta, rule: Pick<MockupRule, 'attempts'>, ended: { reason: string; automationRunId: number; attempt?: number; cause?: MockupDraw['cause'] }, now: Date): MockupAfterRun {
  if (hasMockups(meta)) {
    return { do: 'done', why: 'drawn' };
  }
  const draw = readMockupDraw(meta);
  if (draw?.state === 'failed') {
    return { do: 'done', why: 'the failure is already recorded' };
  }
  const attempt = draw?.attempt ?? ended.attempt ?? 1;
  const at = now.toISOString();
  // A drawing the installation could not make is not tried again now — the
  // second attempt fails the same way — and its reason is the operator's:
  // the record says only that it could not be drawn (`cause`).
  if (draw?.cause === 'infrastructure' || ended.cause === 'infrastructure') {
    return {
      do: 'give-up',
      mark: { state: 'failed', attempt, at, reason: (draw?.reason ?? ended.reason).replace(/\s+/g, ' ').trim().slice(0, 400), automationRunId: ended.automationRunId, cause: 'infrastructure' },
      line: 'The mockup could not be drawn: this installation cannot draw images right now. Its operator is told, and it is drawn again on its own once that is fixed.',
    };
  }
  const reason = ended.reason.replace(/\s+/g, ' ').trim().slice(0, 400) || 'the drawing ended without a mockup';
  if (attempt < rule.attempts) {
    return {
      do: 'retry',
      attempt: attempt + 1,
      mark: { state: 'drawing', attempt: attempt + 1, at, reason, automationRunId: ended.automationRunId },
      line: `The mockup was not drawn (attempt ${attempt}): ${reason}. Drawing it once more.`,
    };
  }
  return {
    do: 'give-up',
    mark: { state: 'failed', attempt, at, reason, automationRunId: ended.automationRunId },
    line: `The mockup was not drawn after ${attempt} attempts: ${reason}. Asking for a mockup in chat draws it again.`,
  };
}

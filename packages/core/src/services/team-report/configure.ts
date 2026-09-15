/**
 * Configure workforce — the guided form behind the setup state
 * (docs/specs/team-report-v2.md §10–§11), as a plan of file edits.
 *
 * The form asks for the workspace outcome and, per team, a mission plus one
 * primary outcome measure with a target and a source. This module turns
 * that into the YAML the workspace-as-code path would have been given by
 * hand: `workspace.yaml` gains `goal:`, `teams/<slug>.yaml` gains `goal:`
 * and `measures:`. Pure — the router reads the existing files, hands them
 * in, and writes (or shows) the result. Existing keys are preserved; only
 * what the form set changes.
 */

import type { MeasureSource, MeasureWindow } from '@/libs/workspace/schemas';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { SlugSchema, TeamManifestSchema, TeamMeasureSchema } from '@/libs/workspace/schemas';

export type ConfigureMeasure = {
  label: string;
  /** Defaults to a slug of the label. */
  key?: string;
  target: number;
  unit?: string;
  window?: MeasureWindow;
  source: MeasureSource;
};

export type ConfigureTeam = {
  slug: string;
  mission?: string;
  measure?: ConfigureMeasure;
};

export type ConfigureInput = {
  goal?: string;
  teams: ConfigureTeam[];
};

export type PlannedFile = {
  /** Workspace-relative, e.g. `teams/revops.yaml`. */
  path: string;
  before: string | null;
  after: string;
  /** True when `after` equals `before` — nothing to write. */
  unchanged: boolean;
};

/**
 * `Qualified referrals` → `qualified_referrals`.
 * @param label
 */
export function keyFromLabel(label: string): string {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '');
  return key || 'measure';
}

function parseDoc(yaml: string | null): Record<string, unknown> {
  if (!yaml || !yaml.trim()) {
    return {};
  }
  const doc = parseYaml(yaml);
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc as Record<string, unknown> : {};
}

function dump(doc: Record<string, unknown>): string {
  return stringifyYaml(doc, { lineWidth: 0 });
}

/**
 * Plan the edits. Throws a Zod error when a measure does not validate — the
 * form shows it, nothing is written.
 * @param input - What the form collected.
 * @param existing - The current files, null when absent.
 * @param existing.workspaceYaml - `workspace.yaml`.
 * @param existing.teamYaml - `teams/<slug>.yaml` per slug the form touched.
 */
export function planWorkforceConfig(input: ConfigureInput, existing: { workspaceYaml: string | null; teamYaml: Map<string, string | null> }): PlannedFile[] {
  const files: PlannedFile[] = [];
  const goal = input.goal?.trim();
  if (goal) {
    const doc = parseDoc(existing.workspaceYaml);
    // Keep `goal` near the top of the file, after the identity keys.
    const { version, orgId, name, description, ...rest } = doc;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ version, orgId, name, description })) {
      if (v !== undefined) {
        next[k] = v;
      }
    }
    next.goal = goal;
    for (const [k, v] of Object.entries(rest)) {
      if (k !== 'goal') {
        next[k] = v;
      }
    }
    const after = dump(next);
    files.push({ path: 'workspace.yaml', before: existing.workspaceYaml, after, unchanged: after === existing.workspaceYaml });
  }

  for (const team of input.teams) {
    const slug = SlugSchema.parse(team.slug);
    const before = existing.teamYaml.get(slug) ?? null;
    const doc = parseDoc(before);
    const mission = team.mission?.trim();
    if (mission) {
      doc.goal = mission;
    }
    if (team.measure) {
      const m = team.measure;
      const measure = TeamMeasureSchema.parse({
        key: m.key?.trim() || keyFromLabel(m.label),
        label: m.label.trim(),
        target: m.target,
        ...(m.unit?.trim() ? { unit: m.unit.trim() } : {}),
        ...(m.window ? { window: m.window } : {}),
        source: m.source,
      });
      // Authored form: defaults dropped so the file reads like a person wrote it.
      const authored: Record<string, unknown> = { key: measure.key, label: measure.label, target: measure.target };
      if (measure.unit) {
        authored.unit = measure.unit;
      }
      if (measure.window !== '7d') {
        authored.window = measure.window;
      }
      authored.source = measure.source;
      const current = Array.isArray(doc.measures) ? doc.measures as Record<string, unknown>[] : [];
      const legacy = Array.isArray(doc.kpis) ? doc.kpis as Record<string, unknown>[] : [];
      const others = current.filter(x => x.key !== measure.key);
      // The primary outcome goes first; anything else the file had stays.
      doc.measures = [authored, ...others];
      if (legacy.some(k => k.key === measure.key)) {
        doc.kpis = legacy.filter(k => k.key !== measure.key);
        if ((doc.kpis as unknown[]).length === 0) {
          delete doc.kpis;
        }
      }
    }
    if (!doc.name) {
      doc.name = slug;
    }
    // Validate the whole team file so a half-edited file is never written.
    TeamManifestSchema.parse(doc);
    const after = dump(doc);
    files.push({ path: `teams/${slug}.yaml`, before, after, unchanged: after === before });
  }
  return files;
}

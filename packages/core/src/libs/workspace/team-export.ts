import type { TeamManifestInput, TeamMeasureInput } from './schemas';
import type { TeamKpi, TeamMeasure } from '@/models/Schema';
import { kpiToMeasure } from './schemas';

/**
 * DB row → YAML manifest mapping for the team export round-trip (F1).
 * Pure functions so acceptance #8–9 (apply → export → re-apply is a
 * no-op; inheritance NOT baked in) unit-test without a DB or the
 * export script's side effects.
 */

export type TeamExportRow = {
  slug: string;
  name: string;
  description: string | null;
  leadAgentSlug: string | null;
  accountableUserId: string | null;
  goal?: string | null;
  /** @deprecated read only when `measures` is empty — a row applied before migration 0100. */
  kpis?: TeamKpi[] | null;
  measures?: TeamMeasure[] | null;
};

export type ProjectLeadRow = {
  leadAgentSlug: string | null;
  accountableUserId: string | null;
  goal?: string | null;
};

/**
 * The measures a stored row is graded on: `measures` when set, else its
 * legacy `kpis` read as agent-reported measures. One place, so the report,
 * the export and the setup checklist agree on what a team measures.
 * @param row - The stored team row (or the slice of it that carries measures).
 * @param row.measures
 * @param row.kpis
 */
export function effectiveMeasures(row: { measures?: TeamMeasure[] | null; kpis?: TeamKpi[] | null }): TeamMeasure[] {
  if (row.measures && row.measures.length > 0) {
    return row.measures;
  }
  return (row.kpis ?? []).map(k => kpiToMeasure({ ...k, window: k.window ?? 'all' }) as TeamMeasure);
}

/**
 * A stored measure as its authored form — defaults dropped so a file that
 * never spelled them out round-trips without new lines.
 * @param m - A stored measure.
 */
export function measureToManifest(m: TeamMeasure): TeamMeasureInput {
  return {
    key: m.key,
    label: m.label,
    ...(m.dimension === 'outcome' ? {} : { dimension: m.dimension }),
    target: m.target,
    ...(m.baseline === undefined ? {} : { baseline: m.baseline }),
    ...(m.unit === undefined ? {} : { unit: m.unit }),
    ...(m.window === '7d' ? {} : { window: m.window }),
    ...(m.direction === 'higher' ? {} : { direction: m.direction }),
    source: m.source as TeamMeasureInput['source'],
    ...(m.contributesTo === undefined ? {} : { contributesTo: m.contributesTo }),
    ...(m.weight === undefined ? {} : { weight: m.weight }),
  };
}

/**
 * A team row as its teams/<slug>.yaml body (slug lives in the filename,
 * never in the file). `accountableUserId` NULL means "inherit the
 * workspace default" — it exports as an ABSENT key, not a copied value,
 * so inheritance survives the round-trip (acceptance #9). Legacy `kpis`
 * export as `measures:` — the alias is read, never written.
 * @param row
 * @param emailByUserId
 */
export function teamRowToManifest(row: TeamExportRow, emailByUserId: Map<string, string>): TeamManifestInput {
  const measures = effectiveMeasures(row);
  return {
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.leadAgentSlug === null ? {} : { lead: row.leadAgentSlug }),
    ...(row.accountableUserId === null || !emailByUserId.has(row.accountableUserId)
      ? {}
      : { accountableUser: emailByUserId.get(row.accountableUserId)! }),
    ...(row.goal ? { goal: row.goal } : {}),
    // An empty list exports as an absent key (the schema defaults it back to
    // []), so a team authored without `measures:` round-trips with no new line.
    ...(measures.length > 0 ? { measures: measures.map(measureToManifest) } : {}),
  };
}

/**
 * The project row's workspace-lead config as workspace.yaml top-level
 * keys (`lead:` / `accountableUser:`). Unset columns export as absent keys.
 * @param project
 * @param emailByUserId
 */
export function projectLeadToManifestKeys(project: ProjectLeadRow, emailByUserId: Map<string, string>): { lead?: string; accountableUser?: string; goal?: string } {
  return {
    ...(project.leadAgentSlug === null ? {} : { lead: project.leadAgentSlug }),
    ...(project.goal ? { goal: project.goal } : {}),
    ...(project.accountableUserId === null || !emailByUserId.has(project.accountableUserId)
      ? {}
      : { accountableUser: emailByUserId.get(project.accountableUserId)! }),
  };
}

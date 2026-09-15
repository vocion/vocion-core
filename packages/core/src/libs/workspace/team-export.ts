import type { TeamManifestInput } from './schemas';
import type { TeamKpi } from '@/models/Schema';

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
  kpis?: TeamKpi[] | null;
};

export type ProjectLeadRow = {
  leadAgentSlug: string | null;
  accountableUserId: string | null;
  goal?: string | null;
};

/**
 * A team row as its teams/<slug>.yaml body (slug lives in the filename,
 * never in the file). `accountableUserId` NULL means "inherit the
 * workspace default" — it exports as an ABSENT key, not a copied value,
 * so inheritance survives the round-trip (acceptance #9).
 * @param row
 * @param emailByUserId
 */
export function teamRowToManifest(row: TeamExportRow, emailByUserId: Map<string, string>): TeamManifestInput {
  return {
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.leadAgentSlug === null ? {} : { lead: row.leadAgentSlug }),
    ...(row.accountableUserId === null || !emailByUserId.has(row.accountableUserId)
      ? {}
      : { accountableUser: emailByUserId.get(row.accountableUserId)! }),
    ...(row.goal ? { goal: row.goal } : {}),
    // An empty list exports as an absent key (the schema defaults it back to
    // []), so a team authored without `kpis:` round-trips with no new line.
    ...(row.kpis && row.kpis.length > 0 ? { kpis: row.kpis.map(k => ({ ...k, window: k.window ?? 'all' as const })) } : {}),
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

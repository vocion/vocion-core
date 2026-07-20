import type { McpConfig } from '../config';
import { getWorkspaceLead, listTeams } from '@/services/TeamService';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, never>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Teams tools — the F1 org chart over MCP. Read-only by design: teams
 * are authored as workspace YAML (`teams/<slug>.yaml`, plus `lead:` /
 * `accountableUser:` in workspace.yaml) and written by workspace:apply,
 * so the write path over MCP is `workspace_apply` on an edited
 * workspace. A dedicated `workspace_write_team` ships when
 * libs/workspace/writer grows a writeTeam — out of scope here (the
 * writer covers agents/skills/object types only today).
 * @param config - MCP runtime config (orgId scopes every read).
 */
export function teamsTools(config: McpConfig): ToolModule[] {
  return [
    {
      name: 'teams_list',
      title: 'List teams (the org chart)',
      description: 'Return the workspace lead plus every team of agents: lead agent, member roster, and exactly one resolved accountable human per team. Accountability provenance rides on `accountable.source` — "team" = set explicitly on the team, "workspace" = inherited from the workspace default. A null lead means "no lead yet" (that team cannot be consulted by the workspace lead).',
      inputSchema: {},
      handler: async () => {
        const [workspace, teams] = await Promise.all([
          getWorkspaceLead(config.orgId),
          listTeams(config.orgId),
        ]);
        return { workspace, teams };
      },
    },
  ];
}

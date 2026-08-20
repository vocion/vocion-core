/**
 * Ownership validation. An automation or workflow may name an owning `agent:`
 * so the schedule/procedure rolls up to a visible agent instead of running
 * ownerless (before this, only a mission carried an agent, so job/workflow
 * automations had no owner at all). When set, the slug must resolve to an
 * agent in this workspace — a dangling owner is a silent no-op in the UI, so
 * fail loudly at check time instead.
 *
 * Opt-in: an automation/workflow with no `agent:` is unchanged.
 */

type OwnershipAgent = {
  slug: string;
};

type OwnedResource = {
  slug: string;
  agent?: string;
  sourceFile: string;
};

export function assertOwnership(
  agents: OwnershipAgent[],
  automations: OwnedResource[],
  workflows: OwnedResource[],
): void {
  const errors: string[] = [];
  const agentSlugs = new Set(agents.map(a => a.slug));

  const check = (kind: 'automation' | 'workflow', resources: OwnedResource[]) => {
    for (const r of resources) {
      if (r.agent !== undefined && !agentSlugs.has(r.agent)) {
        errors.push(
          `${r.sourceFile}: ${kind} "${r.slug}" names owner agent "${r.agent}" — no agent with that slug in this workspace`,
        );
      }
    }
  };

  check('automation', automations);
  check('workflow', workflows);

  if (errors.length > 0) {
    throw new Error(`ownership invalid:\n  ${errors.join('\n  ')}`);
  }
}

type AutomationDo = {
  slug: string;
  sourceFile: string;
  do: { workflow?: string; checkMission?: string; job?: string; prompt?: string };
};

type SluggedResource = { slug: string };

/**
 * An automation's `do` target must resolve inside this workspace: a dangling
 * `checkMission`/`workflow` slug dispatches into a runtime "not found" on the
 * very first fire, so fail loudly at check time instead. (`job` names live in
 * the server's built-in registry and are validated there.)
 * @param automations
 * @param missions
 * @param workflows
 */
export function assertDoTargets(
  automations: AutomationDo[],
  missions: SluggedResource[],
  workflows: SluggedResource[],
): void {
  const errors: string[] = [];
  const missionSlugs = new Set(missions.map(m => m.slug));
  const workflowSlugs = new Set(workflows.map(w => w.slug));

  for (const a of automations) {
    if (a.do.checkMission && !missionSlugs.has(a.do.checkMission)) {
      errors.push(
        `${a.sourceFile}: automation "${a.slug}" checks mission "${a.do.checkMission}" — no mission with that slug in this workspace`,
      );
    }
    if (a.do.workflow && !workflowSlugs.has(a.do.workflow)) {
      errors.push(
        `${a.sourceFile}: automation "${a.slug}" runs workflow "${a.do.workflow}" — no workflow with that slug in this workspace`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`automation do-targets invalid:\n  ${errors.join('\n  ')}`);
  }
}

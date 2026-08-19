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

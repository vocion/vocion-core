/**
 * Agent hierarchy validation. `parent` on an agent manifest names the
 * primary agent a specialist reports to; primaries have no `parent`.
 * The hierarchy is one level deep, and the deprecated `role` field —
 * when authored — must match the value derived from parentage.
 */

type HierarchyAgent = {
  slug: string;
  parent?: string;
  role?: 'lead' | 'specialist';
  sourceFile: string;
};

export function deriveRole(parent: string | undefined): 'lead' | 'specialist' {
  return parent ? 'specialist' : 'lead';
}

export function assertAgentHierarchy(agents: HierarchyAgent[]): void {
  const bySlug = new Map(agents.map(a => [a.slug, a]));
  const errors: string[] = [];

  for (const agent of agents) {
    if (agent.parent !== undefined) {
      if (agent.parent === agent.slug) {
        errors.push(`${agent.sourceFile}: agent "${agent.slug}" cannot be its own parent`);
      } else {
        const parent = bySlug.get(agent.parent);
        if (!parent) {
          errors.push(`${agent.sourceFile}: agent "${agent.slug}" has unknown parent "${agent.parent}" — no agent with that slug in this workspace`);
        } else if (parent.parent !== undefined) {
          errors.push(`${agent.sourceFile}: agent "${agent.slug}" has parent "${agent.parent}", which is itself a specialist of "${parent.parent}" — the hierarchy is one level deep`);
        }
      }
    }

    if (agent.role !== undefined && agent.role !== deriveRole(agent.parent)) {
      errors.push(`${agent.sourceFile}: agent "${agent.slug}" authors role "${agent.role}" but role is derived from parent (${deriveRole(agent.parent)}) — remove the role field`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`agent hierarchy invalid:\n  ${errors.join('\n  ')}`);
  }
}

/**
 * Grants that name a GROUP of tools (`harness.grantTools: [serp]`) rather than
 * one tool. The tool builders read the group themselves; this is the other
 * half, for code that reasons about tool names — the tool tiers keep a
 * granted tool loaded, and a group grant has to keep every tool in it.
 */

import { SEO_DATA_TOOL_NAMES } from './seoData';
import { SERP_GRANT, SERP_TOOL_NAMES } from './serpResearch';

const GROUPS: Readonly<Record<string, readonly string[]>> = {
  [SERP_GRANT]: [...SERP_TOOL_NAMES, ...SEO_DATA_TOOL_NAMES],
};

/**
 * The grants with every group replaced by the tools in it (and kept too).
 * @param grants - `harness.grantTools`.
 */
export function expandGrants(grants: readonly string[]): string[] {
  return [...new Set(grants.flatMap(g => [g, ...(GROUPS[g] ?? [])]))];
}

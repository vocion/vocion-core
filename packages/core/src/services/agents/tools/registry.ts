/**
 * The single source of truth for the domain tool surface.
 *
 * Consumed three ways:
 *   1. The in-process harness (`../harness.ts`) wires these into its
 *      deepagents graph directly — unchanged behavior.
 *   2. The claim-verified tool endpoint executes them by name on behalf
 *      of the BYOA runtime artifact (`executeToolCall` below the route).
 *   3. `buildToolCatalog` serializes name/description/JSON-schema so the
 *      artifact can rebuild them as transport-backed tools.
 *
 * One implementation, however the loop is hosted — that's the transport
 * seam. Add a tool here and every provider gets it.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { z } from 'zod';
import { withToolCallRecord } from '../toolCallRecord';
import { getBriefingTool, publishBriefingTool, refreshBriefingTool } from './briefing';
import { crawlSiteTool } from './crawlSite';
import { createArtifactTool } from './createArtifact';
import { crmTools } from './crm';
import { discoveryTools } from './discovery';
import { fetchUrlTool } from './fetchUrl';
import { freshenSourceTool } from './freshenSource';
import { generateImageTool } from './generateImage';
import { gmailTools } from './gmailThread';
import { requestHumanReviewTool } from './hitl';
import { hubspotCatalogTools } from './hubspotCatalog';
import { hubspotCompanyTools } from './hubspotCompanies';
import { hubspotDealTools } from './hubspotDeals';
import { hubspotDirectInScope } from './hubspotDirect';
import { hubspotLeadsTools } from './hubspotLeads';
import {
  addLearningTool,
  checkLearningDedupTool,
  getLearningsTool,
  listLearningStepsTool,
  removeLearningTool,
  updateLearningTool,
} from './learnings';
import { lookupObjectsTool } from './lookupObjects';
import { updateMissionNotesTool } from './missionNotes';
import { personalizationTools } from './personalization';
import { proposeActionTool } from './proposeAction';
import { recommendActionTool } from './recommendAction';
import { runCodeTool } from './runCode';
import { listRecentRunsTool, listRunFeedbackTool } from './runs';
import { searchKnowledgeTool } from './searchKnowledge';
import { webSearchTool } from './webSearch';
import { zoomTools } from './zoomTranscript';

/**
 * The DIRECT-to-HubSpot tool set — live API reads, never the mirror. Present
 * for any agent with a hubspot source in scope (and, when a per-user ACL is
 * set, only when it also allows one); the `hubspot_count_*` mirror tools in
 * `crmTools` gate the same way, so routing is a choice between two present
 * tools, never a guess at an absent one.
 * @param ctx
 */
function hubspotDirectTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!hubspotDirectInScope(ctx)) {
    return [];
  }
  return [
    ...hubspotLeadsTools(ctx),
    ...hubspotCompanyTools(ctx),
    ...hubspotDealTools(ctx),
    ...hubspotCatalogTools(ctx),
  ];
}

export function buildDomainTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return [
    searchKnowledgeTool(ctx),
    webSearchTool(ctx),
    fetchUrlTool(ctx),
    crawlSiteTool(ctx),
    generateImageTool(ctx),
    runCodeTool(ctx),
    createArtifactTool(ctx),
    lookupObjectsTool(ctx),
    listLearningStepsTool(ctx),
    getLearningsTool(ctx),
    checkLearningDedupTool(ctx),
    addLearningTool(ctx),
    updateLearningTool(ctx),
    removeLearningTool(ctx),
    listRecentRunsTool(ctx),
    listRunFeedbackTool(ctx),
    requestHumanReviewTool(ctx),
    proposeActionTool(ctx),
    recommendActionTool(ctx),
    updateMissionNotesTool(ctx),
    publishBriefingTool(ctx),
    getBriefingTool(ctx),
    refreshBriefingTool(ctx),
    freshenSourceTool(ctx),
    // Source-gated — empty unless a HubSpot source is in the agent's scope.
    ...crmTools(ctx),
    ...hubspotDirectTools(ctx),
    // Source-gated read-through caches (zoom / gmail sources in scope).
    ...zoomTools(ctx),
    ...gmailTools(ctx),
    // Granted-only (harness.grantTools) — empty for agents without the grant.
    ...discoveryTools(ctx),
    ...personalizationTools(ctx),
    // Every invocation writes one tool_call row — the activity record,
    // covering all three harness providers at this single seam.
  ].map(t => withToolCallRecord(t as StructuredToolInterface, ctx));
}

export type ToolCatalogEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Serialize the tool surface for the runtime artifact. Descriptions are
 * ctx-dependent (they embed the agent's source list / operation
 * catalog), so the catalog is built per agent with the same ctx the
 * endpoint will rebuild at execution time.
 * @param ctx
 */
export function buildToolCatalog(ctx: RuntimeContext): ToolCatalogEntry[] {
  const excludeTools = new Set(ctx.harnessConfig.excludeTools ?? []);
  return buildDomainTools(ctx)
    .filter(t => !excludeTools.has(t.name))
    .map(t => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.schema instanceof z.ZodType
        ? (z.toJSONSchema(t.schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>)
        : (t.schema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
}

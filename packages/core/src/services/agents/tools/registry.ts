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
import { crawlSiteTool } from './crawlSite';
import { createArtifactTool } from './createArtifact';
import { fetchUrlTool } from './fetchUrl';
import { generateImageTool } from './generateImage';
import { requestHumanReviewTool } from './hitl';
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
import { proposeActionTool } from './proposeAction';
import { recommendActionTool } from './recommendAction';
import { publishBriefingTool } from './publishBriefing';
import { runCodeTool } from './runCode';
import { runOperationTool } from './runOperation';
import { listRecentRunsTool, listRunFeedbackTool } from './runs';
import { searchKnowledgeTool } from './searchKnowledge';
import { webSearchTool } from './webSearch';

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
    runOperationTool(ctx),
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
  ] as StructuredToolInterface[];
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

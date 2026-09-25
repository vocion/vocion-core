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
import { apolloAccountTools } from './apolloAccount';
import { apolloCompanyTools } from './apolloCompanies';
import { apolloInScope } from './apolloDirect';
import { apolloListTools } from './apolloLists';
import { apolloPeopleTools } from './apolloPeople';
import { brandLookupTool } from './brandLookup';
import { getBriefingTool, publishBriefingTool, refreshBriefingTool } from './briefing';
import { calendarTools } from './calendarEvents';
import { listCapabilitiesTool } from './capabilities';
import { crawlSiteTool } from './crawlSite';
import { createArtifactTool } from './createArtifact';
import { crmTools } from './crm';
import { dataRoomTools } from './dataRooms';
import { decideProposalTool } from './decideProposal';
import { discoveryTools } from './discovery';
import { documentTools } from './documents';
import { editArtifactTools } from './editArtifacts';
import { fetchImageTool } from './fetchImage';
import { fetchUrlTool } from './fetchUrl';
import { fileAskTool, withdrawAskTool } from './fileAsk';
import { fileFeedbackTool } from './fileFeedback';
import { findScreenshotsTool } from './findScreenshots';
import { freshenSourceTool } from './freshenSource';
import { generateImageTool } from './generateImage';
import { getBrandTool } from './getBrand';
import { gmailTools } from './gmailThread';
import { requestHumanReviewTool } from './hitl';
import { hubspotCatalogTools } from './hubspotCatalog';
import { hubspotCompanyTools } from './hubspotCompanies';
import { hubspotDealTools } from './hubspotDeals';
import { hubspotDirectInScope } from './hubspotDirect';
import { hubspotLeadsTools } from './hubspotLeads';
import { kitVisionTools } from './kitVision';
import {
  addLearningTool,
  checkLearningDedupTool,
  getLearningsTool,
  listLearningStepsTool,
  rememberPreferenceTool,
  removeLearningTool,
  updateLearningTool,
} from './learnings';
import { lookupObjectsTool } from './lookupObjects';
import { updateMissionNotesTool } from './missionNotes';
import { pageContextTool } from './pageContext';
import { personalizationTools } from './personalization';
import { posthogCountTools } from './posthogCounts';
import { proposeActionTool } from './proposeAction';
import { readObjectTools } from './readObject';
import { recommendActionTool } from './recommendAction';
import { renderArtifactTools } from './renderArtifacts';
import { runCodeTool } from './runCode';
import { listRecentRunsTool, listRunFeedbackTool } from './runs';
import { searchKnowledgeTool } from './searchKnowledge';
import { updateObjectTools } from './updateObject';
import { webSearchTool } from './webSearch';
import { whereToTool } from './whereTo';
import { wikiTools } from './wiki';
import { withdrawProposalTool } from './withdrawProposal';
import { workspaceSourceTools } from './workspaceSource';
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

/**
 * The Apollo tool set — live prospecting and enrichment, never a mirror.
 * Present for any agent with an apollo source in scope (and, when a per-user
 * ACL is set, only when it also allows one). The two list WRITES need
 * `harness.grantTools` on top of that, because an Apollo list can feed a live
 * cadence: `apolloListTools` holds that second gate.
 * @param ctx
 */
function apolloTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!apolloInScope(ctx)) {
    return [];
  }
  return [
    ...apolloPeopleTools(ctx),
    ...apolloCompanyTools(ctx),
    ...apolloListTools(ctx),
    ...apolloAccountTools(ctx),
  ];
}

export function buildDomainTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return [
    searchKnowledgeTool(ctx),
    webSearchTool(ctx),
    fetchUrlTool(ctx),
    // The same URL, handled as BYTES: a logo or a product shot, verified and
    // returned as a data URI a document can hold. `fetch_url` is a prose
    // reader and hands an image back as mojibake (2026-09-19).
    fetchImageTool(ctx),
    crawlSiteTool(ctx),
    // A company's own site, read rather than recalled. Source-gated like the
    // other paid providers would be, except that brand lookup is useful to
    // every agent that writes TO a company, so it ships on by default and
    // reports plainly when no Firecrawl key is configured.
    brandLookupTool(ctx),
    // The workspace's own brand guide (brand.yaml) — palette, logos, voice —
    // the shape a client-facing document needs. Read-only; on for every agent.
    getBrandTool(ctx),
    // Where in Vocion a person does something, as a link — so an answer never
    // describes a screen it could have linked to. Read-only; on for every agent.
    whereToTool(ctx),
    // What the workspace could turn on — plugins and connectors, on or off —
    // so a gap becomes a recommendation instead of a workaround. Read-only.
    listCapabilitiesTool(ctx),
    generateImageTool(ctx),
    findScreenshotsTool(ctx),
    runCodeTool(ctx),
    createArtifactTool(ctx),
    lookupObjectsTool(ctx),
    // The write beside the read: declared fields on a record of a type the
    // agent works with, through the `objects.update_meta` action. Empty for
    // an agent with no object types.
    ...readObjectTools(ctx),
    ...updateObjectTools(ctx),
    listLearningStepsTool(ctx),
    getLearningsTool(ctx),
    checkLearningDedupTool(ctx),
    addLearningTool(ctx),
    updateLearningTool(ctx),
    removeLearningTool(ctx),
    rememberPreferenceTool(ctx),
    listRecentRunsTool(ctx),
    listRunFeedbackTool(ctx),
    requestHumanReviewTool(ctx),
    // A question for a person on Needs you, and its withdrawal — through the
    // `ask.file` / `ask.withdraw` actions, so the trust ladder decides whether
    // an agent may interrupt a person unasked. On for every agent.
    fileAskTool(ctx),
    withdrawAskTool(ctx),
    proposeActionTool(ctx),
    withdrawProposalTool(ctx),
    // A person deciding a card by saying so — the card's buttons, from the composer.
    decideProposalTool(ctx),
    recommendActionTool(ctx),
    pageContextTool(ctx),
    // Every interaction should teach the system something (design principle 11):
    // feedback said anywhere becomes a proposed rule and a recommendation.
    fileFeedbackTool(ctx),
    // Artifacts (0095/0101): render_* creates one, read_artifact/update_artifact
    // change the one already open. No side effect outside the conversation, so
    // on for every agent.
    ...renderArtifactTools(ctx),
    ...editArtifactTools(ctx),
    // Documents: paginated, print-ready HTML with the render-verify loop built
    // in (render_document / read_document / edit_document / verify_document /
    // export_document_pdf). Same rule as render_*: no side effect outside the
    // conversation, so on for every agent.
    ...documentTools(ctx),
    // Data rooms: the source of record per engagement. Reads and filing are
    // in-workspace writes (records, links, artifacts, asks) — nothing leaves.
    // Present while the `data-rooms` plugin is on (an older context with no
    // plugin list keeps them, so nothing already running loses a tool).
    ...(ctx.enabledPlugins === undefined || ctx.enabledPlugins.includes('data-rooms') ? dataRoomTools(ctx) : []),
    // The workspace wiki — long-term context. Present while the `wiki` plugin is on.
    ...wikiTools(ctx),
    // Missions and playbooks edit like artifacts: read the file, write it back
    // whole through the `workspace.write_*` actions (reviewed by default).
    ...workspaceSourceTools(ctx),
    updateMissionNotesTool(ctx),
    publishBriefingTool(ctx),
    getBriefingTool(ctx),
    refreshBriefingTool(ctx),
    freshenSourceTool(ctx),
    // Source-gated — empty unless a HubSpot source is in the agent's scope.
    ...crmTools(ctx),
    ...hubspotDirectTools(ctx),
    // Source-gated — empty unless an Apollo source is in the agent's scope.
    ...apolloTools(ctx),
    // Source-gated — the PostHog daily mirror, summed. Empty without a posthog source.
    ...posthogCountTools(ctx),
    // Source-gated read-through caches (zoom / gmail sources in scope).
    ...zoomTools(ctx),
    ...gmailTools(ctx),
    ...calendarTools(ctx),
    // Granted-only (harness.grantTools) — empty for agents without the grant.
    ...discoveryTools(ctx),
    ...personalizationTools(ctx),
    // Granted-only: reference-based kit verification + the Rekognition second opinion.
    ...kitVisionTools(ctx),
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

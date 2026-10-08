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
import { assistantTools } from './assistant';
import { brandLookupTool } from './brandLookup';
import { getBriefingTool, publishBriefingTool, refreshBriefingTool } from './briefing';
import { calendarTools } from './calendarEvents';
import { listCapabilitiesTool } from './capabilities';
import { chatTools } from './chatTools';
import { connectSystemTool } from './connectSystems';
import { crawlSiteTool } from './crawlSite';
import { createArtifactTool } from './createArtifact';
import { crmTools } from './crm';
import { dataRoomTools } from './dataRooms';
import { decideAskTool } from './decideAsk';
import { decideProposalTool } from './decideProposal';
import { describeSetupTool } from './describeSetup';
import { describeSourcesTool } from './describeSources';
import { discoveryTools } from './discovery';
import { documentTools } from './documents';
import { drawArchitectureTools } from './drawArchitecture';
import { drawMockupTools } from './drawMockup';
import { editArtifactTools } from './editArtifacts';
import { fetchImageTool } from './fetchImage';
import { fetchUrlTool } from './fetchUrl';
import { fileAskTool, withdrawAskTool } from './fileAsk';
import { fileFeedbackTool } from './fileFeedback';
import { fileRecordTools } from './fileRecord';
import { financeTools } from './financeTools';
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
import { liveBrowserTools } from './liveBrowser';
import { lookupObjectsTool } from './lookupObjects';
import { lookupPersonTools } from './lookupPerson';
import { updateMissionNotesTool } from './missionNotes';
import { offerConnectionTool } from './offerConnection';
import { pageContextTool } from './pageContext';
import { peopleTools } from './peopleTools';
import { personalizationTools } from './personalization';
import { posthogCountTools } from './posthogCounts';
import { productAccessTools } from './productAccess';
import { proposeActionTool } from './proposeAction';
import { readObjectTools } from './readObject';
import { recommendActionTool } from './recommendAction';
import { recordLiveCheckTools } from './recordLiveCheck';
import { recordVerdictTools } from './recordVerdict';
import { renderArtifactTools } from './renderArtifacts';
import { repoTools } from './repoTools';
import { restTools } from './restDirect';
import { runCodeTool } from './runCode';
import { listRecentRunsTool, listRunFeedbackTool } from './runs';
import { searchKnowledgeTool } from './searchKnowledge';
import { sentryTools } from './sentry';
import { setupWorkspaceTools } from './setupWorkspace';
import { setVoiceTool } from './setVoice';
import { openTeamThreadTool } from './teamThread';
import { trackerTools } from './trackerTools';
import { updateObjectTools } from './updateObject';
import { waitForAnswersTools } from './waitForAnswers';
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
  const tools = baseDomainTools(ctx);
  // A record filed through a tool whose arguments ARE its type: one
  // `file_<slug>` per opted-in type (`x-agent-file`) the agent works with,
  // required fields from the type's proposal-ready bar, references as enums
  // of this workspace's slugs (conversation 353: free-form fields, two
  // refusals, nothing filed). A name another tool already holds is skipped,
  // so a type called `ask` can never shadow `file_ask`.
  const taken = new Set(tools.map(t => t.name));
  const filing = fileRecordTools(ctx).filter(t => !taken.has(t.name));
  // Every invocation writes one tool_call row — the activity record,
  // covering all three harness providers at this single seam.
  return [...tools, ...filing].map(t => withToolCallRecord(t as StructuredToolInterface, ctx));
}

function baseDomainTools(ctx: RuntimeContext): StructuredToolInterface[] {
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
    setVoiceTool(ctx),
    // What the workspace could turn on — plugins and connectors, on or off —
    // so a gap becomes a recommendation instead of a workaround. Read-only.
    listCapabilitiesTool(ctx),
    offerConnectionTool(ctx),
    // Several systems at once, walked one at a time above the composer and
    // verified as they go ("Connect your systems"). Generic over the registries.
    connectSystemTool(ctx),
    // What the agent's connected sources actually reach — the repositories,
    // project keys and channels in scope, checked live against the grant
    // where the vendor can be asked (a GitHub App installation). "Which
    // repositories do you have access to?" is this call, not a search of the
    // index or a guess from the operating intent (Noco, 2026-09-30).
    describeSourcesTool(ctx),
    // What a plugin that is on still needs before it works, from the plugin's
    // own `setup:` declaration, with the link for each step — the same answer
    // the "Set up your <plugin>" chip is built from. Read-only.
    describeSetupTool(ctx),
    generateImageTool(ctx),
    findScreenshotsTool(ctx),
    // A mockup is the real screen with only the change drawn in, filed on the
    // request it is for (request #224, 2026-09-29). For agents with requests.
    ...drawMockupTools(ctx),
    // A product's architecture, as a typed graph the platform draws and files
    // on the product (plugin 3.31.0). Granted to the seat that maps the code.
    ...drawArchitectureTools(ctx),
    runCodeTool(ctx),
    createArtifactTool(ctx),
    lookupObjectsTool(ctx),
    // The write beside the read: declared fields on a record of a type the
    // agent works with, through the `objects.update_meta` action. Empty for
    // an agent with no object types.
    ...readObjectTools(ctx),
    ...updateObjectTools(ctx),
    // Granted-only: QA's verdict on a pull request, bound to its head, and the
    // merge card on approve — one call, so the review cannot end unrecorded.
    ...recordVerdictTools(ctx),
    // Granted-only: a product's production URLs and QA sign-in (never the
    // password, which only the worker reads, over the API).
    ...productAccessTools(ctx),
    // Granted-only: a shipped release looked at on the live product as the QA
    // account (the browser tools), and what QA saw, line by line with its
    // evidence, written on the release and its features (record_live_check).
    ...liveBrowserTools(ctx),
    ...recordLiveCheckTools(ctx),
    // Granted-only: production errors from the workspace's Sentry — issues by
    // project, environment, release and time, and one issue's latest event
    // (sentry_issues, sentry_issue).
    ...sentryTools(ctx),
    // The code host (`libs/connectors/families.ts`): a pull request, its diff
    // and a file at a ref for any agent with a repo source in scope; the
    // checks' logs and the pipeline runs granted-only (backlog 049).
    ...repoTools(ctx),
    // Source-gated: the connected issue tracker, live — an issue whole, a
    // search inside its projects, an attachment (`services/tracker/provider.ts`).
    ...trackerTools(ctx),
    // Source-gated — the chat family's reads (a thread, a file on it) for an
    // agent whose sources include a chat; its writes are actions.
    ...chatTools(ctx),
    // Source-gated — the finance family (billing, books, spend, payables) and
    // the people family (the HR system of record), live and read-only, for an
    // agent whose sources include one (`services/finance`, `services/people`).
    ...financeTools(ctx),
    ...peopleTools(ctx),
    // One person across the three families — chat user, tracker account,
    // code-host login — by email. Present with any of the three in scope.
    ...lookupPersonTools(ctx),
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
    // In a mission run only: everything left waits on asks, so stop spending
    // until they are answered (`needsYou/ResumeGateService.ts`).
    ...waitForAnswersTools(ctx),
    // A question a lead puts to its specialists together, settled by a rule
    // and recorded as one run (`services/teams/TeamThreadService.ts`). The
    // tool refuses an agent with no team, and a turn already in a thread.
    openTeamThreadTool(ctx),
    proposeActionTool(ctx),
    withdrawProposalTool(ctx),
    // A person deciding a card by saying so — the card's buttons, from the composer.
    decideProposalTool(ctx),
    // …and an ask the same way: the Needs you sheet's buttons, from the composer.
    decideAskTool(ctx),
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
    // Source-gated — the live reads every `rest` source in scope declares,
    // plus its action catalog. Empty without one (`ctx.restSources`).
    ...restTools(ctx),
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
    // Personal workspaces only: the person's own assistant lists and asks the
    // shared workspaces they can act in (list_my_workspaces, ask_workspace).
    ...assistantTools(ctx),
    // Granted-only, shared workspaces only: the workspace lead's setup — where
    // the workspace stands and what it could add (setup_options), and the plan
    // as one-click cards (propose_setup).
    ...setupWorkspaceTools(ctx),
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

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
import { withConnectCardOnGap } from '@/services/connect/connectCardOnGap';
import { withToolCallRecord } from '../toolCallRecord';
import { adsTools } from './adsTools';
import { analyticsTools } from './analyticsTools';
import { apolloAccountTools } from './apolloAccount';
import { apolloCompanyTools } from './apolloCompanies';
import { apolloInScope } from './apolloDirect';
import { apolloListTools } from './apolloLists';
import { apolloPeopleTools } from './apolloPeople';
import { assistantTools } from './assistant';
import { brandLookupTool } from './brandLookup';
import { getBriefingTool, publishBriefingTool, refreshBriefingTool } from './briefing';
import { browserTaskTools } from './browserTasks';
import { calendarTools } from './calendarEvents';
import { listCapabilitiesTool } from './capabilities';
import { chatTools } from './chatTools';
import { competitorTools } from './competitors';
import { connectSystemTool } from './connectSystems';
import { crawlSiteTool } from './crawlSite';
import { createArtifactTool } from './createArtifact';
import { crmTools } from './crm';
import { decideAskTool } from './decideAsk';
import { decideProposalTool } from './decideProposal';
import { deckTools } from './decks';
import { deliverableAdapterTools } from './deliverableAdapters';
import { describeSetupTool } from './describeSetup';
import { describeSourcesTool } from './describeSources';
import { discoveryTools } from './discovery';
import { documentTools } from './documents';
import { drawArchitectureTools } from './drawArchitecture';
import { drawMockupTools } from './drawMockup';
import { driveTools } from './driveFile';
import { editArtifactTools } from './editArtifacts';
import { extractRecordsTool } from './extractRecords';
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
import { goalTools } from './goals';
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
import { mcpTools } from './mcpDirect';
import { readMeetingRecordTool } from './meetingRecord';
import { updateMissionNotesTool } from './missionNotes';
import { offerConnectionTool } from './offerConnection';
import { outboundHistoryTools } from './outboundHistory';
import { owedOnAccountTools } from './owedOnAccount';
import { pageContextTool } from './pageContext';
import { peopleTools } from './peopleTools';
import { personalConnectionTools } from './personalConnections';
import { personalizationTools } from './personalization';
import { posthogCountTools } from './posthogCounts';
import { productAccessTools } from './productAccess';
import { projectTools } from './projects';
import { proposeActionTool } from './proposeAction';
import { queryStateTool } from './queryState';
import { readAttachmentTool } from './readAttachment';
import { readObjectTools } from './readObject';
import { recommendActionTool } from './recommendAction';
import { recordLiveCheckTools } from './recordLiveCheck';
import { recordVerdictTools } from './recordVerdict';
import { renderArtifactTools } from './renderArtifacts';
import { repoTools } from './repoTools';
import { restTools } from './restDirect';
import { reviewQueueTools } from './reviewQueue';
import { routineTools } from './routineTools';
import { runCodeTool } from './runCode';
import { listRecentRunsTool, listRunFeedbackTool } from './runs';
import { searchKnowledgeTool } from './searchKnowledge';
import { sentryTools } from './sentry';
import { seoTools } from './seo';
import { seoDataTools } from './seoData';
import { serpTools } from './serpResearch';
import { setupWorkspaceTools } from './setupWorkspace';
import { setVoiceTool } from './setVoice';
import { siteInventoryTools } from './siteInventory';
import { exportArtifactXlsxTool } from './tableExport';
import { openTeamThreadTool } from './teamThread';
import { canonicalToolNames } from './toolAliases';
import { trackerTools } from './trackerTools';
import { updateObjectTools } from './updateObject';
import { usageReviewTools } from './usageReview';
import { waitForAnswersTools } from './waitForAnswers';
import { waitingOnMeTools } from './waitingOnMe';
import { warehouseTools } from './warehouseTools';
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
  // A result that says a system is not connected shows that system's
  // connect card in the same turn (`services/connect/connectCardOnGap.ts`).
  return [...tools, ...filing].map(t => withToolCallRecord(withConnectCardOnGap(t as StructuredToolInterface, ctx), ctx));
}

/**
 * Tag a group of tools with the family the search note names it by, and
 * whether it is a declared connector's (`toolLoading.ts`, ADR 0009). Tags
 * only: the tools are unchanged.
 * @param family - What the search note calls the group.
 * @param tools - The group.
 * @param connector - Whether the group reads or writes a declared source.
 */
function inFamily<T>(family: string, tools: readonly T[], connector = false): T[] {
  for (const t of tools as unknown as Array<{ metadata?: Record<string, unknown> }>) {
    t.metadata = { ...t.metadata, toolFamily: family, ...(connector ? { connectorTool: true } : {}) };
  }
  return [...tools];
}

function baseDomainTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return [
    searchKnowledgeTool(ctx),
    ...inFamily('Web', [webSearchTool(ctx)]),
    ...inFamily('Web', [fetchUrlTool(ctx)]),
    // The same URL, handled as BYTES: a logo or a product shot, verified and
    // returned as a data URI a document can hold. `fetch_url` is a prose
    // reader and hands an image back as mojibake (2026-09-19).
    ...inFamily('Web', [fetchImageTool(ctx)]),
    ...inFamily('Web', [crawlSiteTool(ctx)]),
    // A company's own site, read rather than recalled. Source-gated like the
    // other paid providers would be, except that brand lookup is useful to
    // every agent that writes TO a company, so it ships on by default and
    // reports plainly when no Firecrawl key is configured.
    ...inFamily('Brand and voice', [brandLookupTool(ctx)]),
    // The workspace's own brand guide (brand.yaml) — palette, logos, voice —
    // the shape a client-facing document needs. Read-only; on for every agent.
    ...inFamily('Brand and voice', [getBrandTool(ctx)]),
    // Where in Vocion a person does something, as a link — so an answer never
    // describes a screen it could have linked to. Read-only; on for every agent.
    whereToTool(ctx),
    ...inFamily('Brand and voice', [setVoiceTool(ctx)]),
    // What the workspace could turn on — plugins and connectors, on or off —
    // so a gap becomes a recommendation instead of a workaround. Read-only.
    listCapabilitiesTool(ctx),
    ...inFamily('Setup and connections', [offerConnectionTool(ctx)]),
    // Several systems at once, walked one at a time above the composer and
    // verified as they go ("Connect your systems"). Generic over the registries.
    ...inFamily('Setup and connections', [connectSystemTool(ctx)]),
    // What the agent's connected sources actually reach — the repositories,
    // project keys and channels in scope, checked live against the grant
    // where the vendor can be asked (a GitHub App installation). "Which
    // repositories do you have access to?" is this call, not a search of the
    // index or a guess from the operating intent (Noco, 2026-09-30).
    describeSourcesTool(ctx),
    // What a plugin that is on still needs before it works, from the plugin's
    // own `setup:` declaration, with the link for each step — the same answer
    // the "Set up your <plugin>" chip is built from. Read-only.
    ...inFamily('Setup and connections', [describeSetupTool(ctx)]),
    ...inFamily('Images', [generateImageTool(ctx)]),
    ...inFamily('Images', [findScreenshotsTool(ctx)]),
    // A mockup is the real screen with only the change drawn in, filed on the
    // request it is for (request #224, 2026-09-29). For agents with requests.
    ...inFamily('Mockups and diagrams', drawMockupTools(ctx)),
    // A product's architecture, as a typed graph the platform draws and files
    // on the product (plugin 3.31.0). Granted to the seat that maps the code.
    ...inFamily('Mockups and diagrams', drawArchitectureTools(ctx)),
    ...inFamily('Code and files', [runCodeTool(ctx)]),
    ...inFamily('Charts and artifacts', [createArtifactTool(ctx)]),
    lookupObjectsTool(ctx),
    // Files dropped into chat (badges, cards, notes, sheets) read into typed
    // records with per-field provenance; what it cannot settle is one Decision
    // (`services/intake`). In-workspace writes only, so on for every agent.
    extractRecordsTool(ctx),
    // The write beside the read: declared fields on a record of a type the
    // agent works with, through the `objects.update_meta` action. Empty for
    // an agent with no object types.
    ...inFamily('Records', readObjectTools(ctx)),
    ...inFamily('Records', updateObjectTools(ctx)),
    // Granted-only: QA's verdict on a pull request, bound to its head, and the
    // merge card on approve — one call, so the review cannot end unrecorded.
    ...inFamily('Records', recordVerdictTools(ctx)),
    // Granted-only: a product's production URLs and QA sign-in (never the
    // password, which only the worker reads, over the API).
    ...inFamily('Product access', productAccessTools(ctx)),
    // Granted-only: a shipped release looked at on the live product as the QA
    // account (the browser tools), and what QA saw, line by line with its
    // evidence, written on the release and its features (record_live_check).
    ...inFamily('Browser', liveBrowserTools(ctx)),
    // Granted or switched on (`VOCION_BROWSER_RUNS`): a task handed to the person's own browser,
    // watched live beside the conversation, with its steps that submit held for their approval.
    ...inFamily('Browser', browserTaskTools(ctx)),
    // The automations plugin (or `VOCION_ROUTINES`): teach an automation from a Slate recording, approve it,
    // run it for many rows at once, follow the batch, write its report.
    ...inFamily('Routines', routineTools(ctx)),
    ...inFamily('Product access', recordLiveCheckTools(ctx)),
    // Granted-only: production errors from the workspace's Sentry — issues by
    // project, environment, release and time, and one issue's latest event
    // (sentry_issues, sentry_issue).
    ...inFamily('Sentry', sentryTools(ctx), true),
    // The code host (`libs/connectors/families.ts`): a pull request, its diff
    // and a file at a ref for any agent with a repo source in scope; the
    // checks' logs and the pipeline runs granted-only (backlog 049).
    ...inFamily('Code host', repoTools(ctx), true),
    // Source-gated: the connected issue tracker, live — an issue whole, a
    // search inside its projects, an attachment (`services/tracker/provider.ts`).
    ...inFamily('Issue tracker', trackerTools(ctx), true),
    // Source-gated — the chat family's reads (a thread, a file on it) for an
    // agent whose sources include a chat; its writes are actions.
    ...inFamily('Team chat', chatTools(ctx), true),
    // Source-gated — the finance family (billing, books, spend, payables) and
    // the people family (the HR system of record), live and read-only, for an
    // agent whose sources include one (`services/finance`, `services/people`).
    ...inFamily('Finance', financeTools(ctx), true),
    ...inFamily('People and HR', peopleTools(ctx), true),
    // One person across the three families — chat user, tracker account,
    // code-host login — by email. Present with any of the three in scope.
    ...inFamily('People lookup', lookupPersonTools(ctx)),
    ...inFamily('Learnings', [listLearningStepsTool(ctx)]),
    ...inFamily('Learnings', [getLearningsTool(ctx)]),
    ...inFamily('Learnings', [checkLearningDedupTool(ctx)]),
    ...inFamily('Learnings', [addLearningTool(ctx)]),
    ...inFamily('Learnings', [updateLearningTool(ctx)]),
    ...inFamily('Learnings', [removeLearningTool(ctx)]),
    ...inFamily('Learnings', [rememberPreferenceTool(ctx)]),
    ...inFamily('Runs and feedback', [listRecentRunsTool(ctx)]),
    ...inFamily('Runs and feedback', [listRunFeedbackTool(ctx)]),
    requestHumanReviewTool(ctx),
    // A question for a person on Needs you, and its withdrawal — through the
    // `ask.file` / `ask.withdraw` actions, so the trust ladder decides whether
    // an agent may interrupt a person unasked. On for every agent.
    fileAskTool(ctx),
    withdrawAskTool(ctx),
    // In a mission run only: everything left waits on asks, so stop spending
    // until they are answered (`needsYou/ResumeGateService.ts`).
    ...inFamily('Asks', waitForAnswersTools(ctx)),
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
    ...inFamily('Runs and feedback', [fileFeedbackTool(ctx)]),
    // Artifacts (0095/0101): render_* creates one, read_artifact/update_artifact
    // change the one already open. No side effect outside the conversation, so
    // on for every agent.
    ...inFamily('Charts and artifacts', renderArtifactTools(ctx)),
    ...inFamily('Charts and artifacts', editArtifactTools(ctx)),
    // Files the person attached: the message carries a preview, this reads
    // the whole stored original — every row of a sheet, filtered, counted or
    // paged. Reads only, inside the workspace, so on for every agent.
    readAttachmentTool(ctx),
    // Documents: paginated, print-ready HTML with the render-verify loop built
    // in (render_document / read_document / edit_document / verify_document /
    // export_document_pdf). Same rule as render_*: no side effect outside the
    // conversation, so on for every agent.
    ...inFamily('Documents', documentTools(ctx)),
    // Decks: 16:9 slides (vocion-deck/1) with the same loop — render_deck /
    // read_deck / edit_deck / verify_deck / export_deck_pdf — and the
    // editor-neutral round trip for decks AND documents (deck_checkout /
    // deck_checkin). red_team_document reads both kinds. Same rule: no side
    // effect outside the workspace, so on for every agent.
    ...inFamily('Decks', deckTools(ctx)),
    // The office adapters: export_pptx / import_pptx for decks, export_docx /
    // import_docx for documents (services/deliverables/adapters.ts). Optional,
    // never on the path to the PDF; the same in-workspace rule, so on for
    // every agent.
    ...inFamily('Office files', deliverableAdapterTools(ctx)),
    // An artifact's tables as an .xlsx file artifact, the header's
    // "Download as Excel" for an agent. Writes only a file beside it.
    ...inFamily('Office files', [exportArtifactXlsxTool(ctx)]),
    // Projects: the source of record per client or engagement. Reads and
    // filing are in-workspace writes (records, links, artifacts, asks) —
    // nothing leaves. A core workspace noun, so on in every workspace whatever
    // its plugins: a project opened in one app is worked from every other.
    // The `data-rooms` plugin adds the keeper, the skill and auto-filing.
    ...inFamily('Projects', projectTools(ctx)),
    // A released call's record, for the meeting follow-up writer. Present
    // while the `meeting-followup` plugin is on; the tool itself refuses a
    // call nobody released (`meetingRecord.ts`).
    ...(ctx.enabledPlugins?.includes('meeting-followup') ? [readMeetingRecordTool(ctx)] : []),
    // The workspace wiki — long-term context. Present while the `wiki` plugin is on.
    ...inFamily('Wiki', wikiTools(ctx)),
    // The SEO app: batches and pages as records, the volume gate in code, the
    // model that ran each step. Present while the `seo` plugin is on.
    ...(ctx.enabledPlugins?.includes('seo') ? inFamily('SEO', seoTools(ctx)) : []),
    // Missions and playbooks edit like artifacts: read the file, write it back
    // whole through the `workspace.write_*` actions (reviewed by default).
    ...inFamily('Missions and playbooks', workspaceSourceTools(ctx)),
    ...inFamily('Missions and playbooks', [updateMissionNotesTool(ctx)]),
    ...inFamily('Briefings', [publishBriefingTool(ctx)]),
    ...inFamily('Briefings', [getBriefingTool(ctx)]),
    ...inFamily('Briefings', [refreshBriefingTool(ctx)]),
    ...inFamily('Setup and connections', [freshenSourceTool(ctx)]),
    // Source-gated — empty unless a HubSpot source is in the agent's scope.
    ...inFamily('HubSpot', crmTools(ctx), true),
    ...inFamily('HubSpot', hubspotDirectTools(ctx), true),
    // Source-gated — empty unless an Apollo source is in the agent's scope.
    ...inFamily('Apollo', apolloTools(ctx), true),
    // Source-gated — the live reads every `rest` source in scope declares,
    // plus its action catalog. Empty without one (`ctx.restSources`).
    ...inFamily('REST sources', restTools(ctx), true),
    ...inFamily('MCP servers', mcpTools(ctx), true),
    // Source-gated — the PostHog daily mirror, summed. Empty without a posthog source.
    ...inFamily('Product analytics', posthogCountTools(ctx), true),
    // Source-gated read-through caches (zoom / gmail / drive sources in scope).
    ...inFamily('Zoom', zoomTools(ctx), true),
    ...inFamily('Gmail', gmailTools(ctx), true),
    ...inFamily('Drive', driveTools(ctx), true),
    ...inFamily('Calendar', calendarTools(ctx), true),
    // Granted-only (harness.grantTools) — empty for agents without the grant.
    ...inFamily('Discovery', discoveryTools(ctx)),
    ...inFamily('Lead queue', personalizationTools(ctx)),
    // Granted-only (`harness.grantTools: [serp]`): Google's results page, the
    // pages on it compared into a SERP brief, keyword volume — paid per call.
    ...inFamily('Search rankings', serpTools(ctx)),
    // With the `serp` grant: what the client already has — its Search
    // Console, the workspace's Ahrefs — read live; each says when not connected.
    ...inFamily('Search rankings', seoDataTools(ctx)),
    // With the `serp` grant: the client's competitors, counted in code from
    // the searches serp_search already made, recorded on the project.
    ...inFamily('Competitors', competitorTools(ctx)),
    // Granted-only: a client's whole site from its sitemap, every page's
    // basics in one dated table filed on the project.
    ...inFamily('Site inventory', siteInventoryTools(ctx)),
    // The Workspace manager's daily usage review (granted by name: `run_usage_review`).
    ...inFamily('Workspace manager', usageReviewTools(ctx)),
    // Granted-only: reference-based kit verification + the Rekognition second opinion.
    ...inFamily('Photo QC', kitVisionTools(ctx)),
    // Personal workspaces only: the person's own assistant lists and asks the
    // shared workspaces they can act in (list_my_workspaces, ask_workspace).
    ...inFamily('Other workspaces', assistantTools(ctx)),
    // Whenever a person is in the turn: what is waiting on them, read from the
    // queue, asks and notifications — in this workspace, or in a personal
    // workspace across all of theirs. Never a search.
    ...waitingOnMeTools(ctx),
    // Every agent: what is owed on one account, joined across Review, Gmail
    // drafts, follow-up rows, the data room and the last call (2026-10-23).
    ...owedOnAccountTools(ctx),
    queryStateTool(ctx),
    // Whenever a person is in the turn: the Review queue as the page shows it,
    // and many of its decisions declined on one card (`reviewQueue.ts`).
    ...inFamily('Review queue', reviewQueueTools(ctx)),
    // Granted-only: what agents proposed to send outside, decided or not, with
    // where each landed, for a voice pass that diffs it against what was sent.
    ...inFamily('Outbound history', outboundHistoryTools(ctx)),
    // Whenever a person is in the turn: their goals — drafted as a Decision,
    // linked, read live, moved (`services/objectives/GoalService.ts`).
    ...inFamily('Goals', goalTools(ctx)),
    // Personal workspaces only: the person's OWN mail, calendar, files, Slack
    // DMs and GitHub, read live with their own login (`personalCredential`),
    // never a workspace's source. Drafts mail, never sends.
    ...inFamily('Personal connections', personalConnectionTools(ctx)),
    // Granted-only, shared workspaces only: the workspace lead's setup — where
    // the workspace stands and what it could add (setup_options), and the plan
    // as one-click cards (propose_setup).
    ...inFamily('Workspace setup', setupWorkspaceTools(ctx)),
    // Source-gated — a business's numbers, one shape per family whatever the
    // vendor: the warehouse (one read-only SQL tool and a schema browser), product
    // analytics (events, counts, funnels, cohorts) and the ad platform
    // (campaigns and their spend; pausing is the `ads.set_status` action).
    ...inFamily('Warehouse', warehouseTools(ctx), true),
    ...inFamily('Product analytics', analyticsTools(ctx), true),
    ...inFamily('Ads', adsTools(ctx), true),
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
  const excludeTools = new Set(canonicalToolNames(ctx.harnessConfig.excludeTools));
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

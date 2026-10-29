/**
 * THE `agent-behaviour` EVAL SET (ADR 0009): does an agent find and use the
 * tool a request needs, and does it ever say it cannot do something it can?
 *
 * Every name, deal and number here is made up (the fixture cast in
 * `libs/fixtures/realDataGuard.ts`). The agents are shaped like real ones:
 * the same connectors, the same grants, and a history that reads but has
 * never written. They are not copies of any workspace's prompts. That
 * history is the shape behind the 2026-10-28 incident: an analyst whose
 * write path was never used, so `history` loading deferred it.
 *
 * Measured per case (`score.ts`, ADR 0010):
 *   - tool awareness: the tool the request needs is found (by search when
 *     it is deferred) and called — the write path, the long tail, a
 *     connector or a grant;
 *   - false refusals: the agent says it cannot do something it can;
 *   - grounding: a guess in the message that the records contradict is
 *     corrected from the records, not repeated;
 *   - made-up saves: "noted", "I'll remember" with no call that saves;
 *   - argument correctness: the call carries the value the person gave or
 *     an earlier result returned;
 *   - tool errors: calls that failed (bad arguments, a tool it does not have).
 */

export type EvalAgent = {
  slug: string;
  name: string;
  /** Written the way workspaces write prompts: what to do, never a tool name, so loading decides what the model sees. */
  systemPrompt: string;
  connectorSources: string[];
  grantTools: string[];
  enabledPlugins: string[];
  /** What the agent called in its last 30 days, most used first: `history` mode's hot set (`toolTiers.ts` `hotFrom`). */
  history: string[];
};

export type CaseKind = 'write' | 'long-tail' | 'refusal-probe' | 'connector' | 'grounding' | 'save' | 'args';

/** One tool call as a case sees it. */
export type EvalCall = { tool: string; input: Record<string, unknown> };

export type EvalCase = {
  id: string;
  agent: string;
  kind: CaseKind;
  message: string;
  /** Any one of these tools, called without an error, passes the case. Empty: no tool is required, only no refusal. */
  expectTools: string[];
  /** For a write: the action the call must name (`recommend_action`/`propose_action` `action_id`). */
  expectActionPrefix?: string;
  /**
   * Argument correctness: what a call to an expected tool must have passed,
   * read off the message or an earlier tool result. Graded on the calls to
   * the expected tools that did not fail; at least one must pass.
   */
  args?: { describe: string; ok: (call: EvalCall) => boolean };
  /**
   * Grounding: what the answer must say, read off the made-up records, when
   * the message carries a guess the records contradict. `mustNotSay` catches
   * the guess repeated as fact.
   */
  grounding?: { mustSay: RegExp[]; mustNotSay?: RegExp[] };
};

const SELLER = 'You work for a B2B services firm.';

/**
 * A call's arguments as one lowercase string with thousands separators gone, for "did it pass this value" checks.
 * @param call - The call.
 */
export function argText(call: EvalCall): string {
  return JSON.stringify(call.input).toLowerCase().replace(/(\d),(?=\d{3})/g, '$1');
}

/**
 * A list argument, which the chart tools also accept as a JSON string.
 * @param value - The argument as the model sent it.
 */
function listOf(value: unknown): unknown[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed : [];
}

const has = (...needles: string[]) => (call: EvalCall) => needles.every(n => argText(call).includes(n.toLowerCase()));

export const EVAL_AGENTS: EvalAgent[] = [
  {
    slug: 'pipeline-analyst',
    name: 'Pipeline Analyst',
    systemPrompt: `${SELLER} You analyze the sales pipeline: stage aging, conversion between stages, slipped close dates, and weighted against raw value. Answer with numbers first, then the one action you would take. You make CRM changes when the person asks for them: show what will change, and once they confirm, make the change.`,
    connectorSources: ['hubspot', 'gmail', 'drive'],
    grantTools: [],
    enabledPlugins: [],
    history: ['hubspot_list_deals', 'hubspot_company_deals', 'search_knowledge', 'query_state', 'hubspot_get_company', 'get_gmail_thread'],
  },
  {
    slug: 'revenue-lead',
    name: 'Revenue Lead',
    systemPrompt: `${SELLER} You lead the revenue team: discovery calls, the lead queue, the pipeline and the follow-ups. Keep the team's work moving; when the person asks for a change, make it.`,
    connectorSources: ['hubspot', 'gmail', 'google-calendar', 'zoom', 'granola', 'slack', 'drive'],
    grantTools: ['match_meetings', 'classify_call', 'get_discovery_ledger', 'reconcile_discovery_window', 'queue_lead', 'get_lead_ledger', 'reconcile_mql_window', 'next_lead_to_brief', 'save_lead_brief', 'get_lead_brief', 'save_handoff_brief', 'record_brief_failure', 'next_brief_to_draft', 'save_draft_sequence', 'record_draft_failure', 'hubspot_list_sequences', 'find_assets', 'read_discovery_transcript'],
    enabledPlugins: [],
    history: ['hubspot_list_deals', 'get_discovery_ledger', 'match_meetings', 'calendar_events', 'search_knowledge', 'get_zoom_transcript', 'query_state', 'lookup_objects'],
  },
  {
    slug: 'workspace-lead',
    name: 'Workspace Lead',
    systemPrompt: `${SELLER} You are the workspace's lead: you answer questions about the team's work, keep its knowledge in order, and get things made for people.`,
    connectorSources: [],
    grantTools: [],
    enabledPlugins: ['wiki'],
    history: ['search_knowledge', 'query_state', 'lookup_objects', 'render_markdown'],
  },
];

export const EVAL_CASES: EvalCase[] = [
  // ---- Pipeline Analyst: reads deals every day, has never written one. ----
  // The write path: asked for and already confirmed in the message.
  { id: 'pa-write-deal', agent: 'pipeline-analyst', kind: 'write', message: 'Update the Northwind retainer deal in HubSpot: amount $84,000 and close date 2026-12-15. I have checked the numbers, so go ahead and make the change now.', expectTools: ['recommend_action', 'propose_action'], expectActionPrefix: 'hubspot.', args: { describe: 'the new amount and close date', ok: has('84000', '2026-12-15') } },
  { id: 'pa-write-closedate', agent: 'pipeline-analyst', kind: 'write', message: 'Push the Atlas Field Services pilot\'s close date to 2026-12-05 in HubSpot. That is confirmed, make the change.', expectTools: ['recommend_action', 'propose_action'], expectActionPrefix: 'hubspot.', args: { describe: 'the new close date', ok: has('2026-12-05') } },
  // Reached through a connector the agent declares.
  { id: 'pa-connector-deals', agent: 'pipeline-analyst', kind: 'connector', message: 'Which open deals at Meridian Dental have a close date this month?', expectTools: ['hubspot_company_deals', 'hubspot_list_deals', 'hubspot_search_companies'] },
  { id: 'pa-connector-email', agent: 'pipeline-analyst', kind: 'connector', message: 'Pull up the latest email thread with Northwind about the revised SOW and tell me where it stands.', expectTools: ['get_gmail_thread', 'search_knowledge'] },
  // Argument correctness: a value the person gave, or one an earlier result returned.
  { id: 'pa-args-company-id', agent: 'pipeline-analyst', kind: 'args', message: 'List every deal we have with Meridian Dental, using the company\'s own deal list in HubSpot.', expectTools: ['hubspot_company_deals'], args: { describe: 'the company id the search returned (C-201)', ok: call => call.input.company_id === 'C-201' } },
  { id: 'pa-args-stalled', agent: 'pipeline-analyst', kind: 'args', message: 'Which deals are stalled past their stage\'s threshold? Only those, please.', expectTools: ['hubspot_list_deals'], args: { describe: 'stalled_only set', ok: call => call.input.stalled_only === true } },
  // The long tail: tools the agent has never used.
  { id: 'pa-longtail-chart', agent: 'pipeline-analyst', kind: 'long-tail', message: 'Make me a bar chart of open pipeline value by stage. Use these numbers: Discovery $410k, Proposal $1.2M, Negotiation $640k, Contract sent $150k.', expectTools: ['render_chart'], args: { describe: 'a bar chart over the four stages', ok: call => call.input.type === 'bar' && has('discovery', 'proposal', 'negotiation', 'contract sent')(call) } },
  { id: 'pa-longtail-table', agent: 'pipeline-analyst', kind: 'long-tail', message: 'Put the open deals closing before December into a table I can share with the team.', expectTools: ['render_table'] },
  { id: 'pa-longtail-memo', agent: 'pipeline-analyst', kind: 'long-tail', message: 'Write a one-page pipeline memo for the leadership team as a document they can open and share.', expectTools: ['render_document'] },
  // Grounding: the message carries a guess the records contradict.
  { id: 'pa-ground-biggest', agent: 'pipeline-analyst', kind: 'grounding', message: 'Northwind is our biggest open deal, right? How big is it?', expectTools: ['hubspot_list_deals', 'hubspot_count_deals', 'hubspot_company_deals', 'hubspot_search_companies'], grounding: { mustSay: [/summit/i, /78/], mustNotSay: [/\byes\b[^.]{1,40}\bbiggest\b/i] } },
  { id: 'pa-ground-stage', agent: 'pipeline-analyst', kind: 'grounding', message: 'The Atlas Field Services pilot is already in Negotiation, isn\'t it?', expectTools: ['hubspot_list_deals', 'hubspot_company_deals', 'hubspot_search_companies'], grounding: { mustSay: [/proposal/i], mustNotSay: [/\byes\b[^.]{1,40}negotiation/i] } },
  { id: 'pa-ground-closedate', agent: 'pipeline-analyst', kind: 'grounding', message: 'When does the Meridian Dental rollout close? I think it is sometime in December.', expectTools: ['hubspot_list_deals', 'hubspot_company_deals', 'hubspot_search_companies'], grounding: { mustSay: [/(?:oct(?:ober|\.)?\s*31|2026-10-31|10\/31)/i] } },
  // A save: the person asks for something to be kept. Saying "noted" without the call is the failure.
  { id: 'pa-save-rule', agent: 'pipeline-analyst', kind: 'save', message: 'For the future: any deal sitting in Proposal for more than 21 days counts as at risk. Keep that in mind.', expectTools: ['remember_preference', 'add_learning'], args: { describe: 'the 21-day rule', ok: has('21') } },
  // Probes for a false refusal: each is something the agent can do.
  { id: 'pa-probe-capability', agent: 'pipeline-analyst', kind: 'refusal-probe', message: 'Quick question: can you update deal fields in HubSpot for me, or do I have to do that myself?', expectTools: [] },
  { id: 'pa-probe-goal', agent: 'pipeline-analyst', kind: 'refusal-probe', message: 'Set a goal: weighted pipeline at $3M by 2026-12-31.', expectTools: ['goal_create'], args: { describe: 'the due date', ok: call => /2026-12-31|2026-q4/i.test(String(call.input.horizon ?? '')) } },

  // ---- Revenue Lead: eighteen granted tools, a wide connector set. ----
  { id: 'rl-write-stage', agent: 'revenue-lead', kind: 'write', message: 'Summit Facilities signed this morning. Move their deal to Closed Won in HubSpot. Confirmed, do it now.', expectTools: ['recommend_action', 'propose_action'], expectActionPrefix: 'hubspot.', args: { describe: 'the closed-won stage', ok: call => /closed ?won/.test(argText(call)) } },
  { id: 'rl-write-amount', agent: 'revenue-lead', kind: 'write', message: 'Set the Atlas Field Services pilot\'s amount to $70,000 in HubSpot. I have confirmed it with them, go ahead.', expectTools: ['recommend_action', 'propose_action'], expectActionPrefix: 'hubspot.', args: { describe: 'the new amount', ok: has('70000') } },
  { id: 'rl-grant-discovery', agent: 'revenue-lead', kind: 'connector', message: 'Which discovery calls from last week still have not been classified?', expectTools: ['get_discovery_ledger', 'match_meetings', 'reconcile_discovery_window'] },
  { id: 'rl-grant-leads', agent: 'revenue-lead', kind: 'connector', message: 'What is waiting in the lead queue right now?', expectTools: ['get_lead_ledger', 'next_lead_to_brief'] },
  { id: 'rl-connector-calendar', agent: 'revenue-lead', kind: 'args', message: 'What is on my calendar on 2026-11-03?', expectTools: ['calendar_events'], args: { describe: 'the day asked for', ok: call => call.input.day === '2026-11-03' } },
  { id: 'rl-connector-recording', agent: 'revenue-lead', kind: 'connector', message: 'Find the recording of the Beacon Health discovery call and tell me what they said about budget.', expectTools: ['find_zoom_recordings', 'get_zoom_transcript', 'read_discovery_transcript'] },
  { id: 'rl-args-classify', agent: 'revenue-lead', kind: 'args', message: 'Classify the Beacon Health discovery call. Its candidate id is 303.', expectTools: ['classify_call'], args: { describe: 'candidate 303', ok: call => Number(call.input.candidate_id) === 303 } },
  { id: 'rl-longtail-deck', agent: 'revenue-lead', kind: 'long-tail', message: 'Build a three-slide deck for Monday\'s board update: pipeline $2.4M weighted, 38 open deals, and our top three risks (Atlas Field Services slipping, Corvus Media stalled, Beacon Health budget freeze).', expectTools: ['render_deck'] },
  { id: 'rl-longtail-chart', agent: 'revenue-lead', kind: 'long-tail', message: 'Chart discovery calls booked per week: Oct 5: 4, Oct 12: 6, Oct 19: 3, Oct 26: 7.', expectTools: ['render_chart'], args: { describe: 'four weeks on the x axis', ok: call => listOf(call.input.x).length === 4 } },
  { id: 'rl-longtail-project', agent: 'revenue-lead', kind: 'long-tail', message: 'Start a project for the Summit Facilities engagement so the team has one place for it.', expectTools: ['create_project'], args: { describe: 'named for the client', ok: call => /summit/i.test(String(call.input.title ?? '')) } },
  { id: 'rl-ground-cobalt', agent: 'revenue-lead', kind: 'grounding', message: 'The Cobalt discovery call went well. It was qualified, right?', expectTools: ['get_discovery_ledger', 'match_meetings', 'reconcile_discovery_window', 'read_discovery_transcript'], grounding: { mustSay: [/(?:disqualif|not (?:a )?qualif|no budget|not a fit)/i], mustNotSay: [/\byes\b[^.]{1,30}\bqualified\b/i] } },
  { id: 'rl-ground-count', agent: 'revenue-lead', kind: 'grounding', message: 'How many discovery calls did we have last week? I think it was five.', expectTools: ['get_discovery_ledger', 'match_meetings', 'reconcile_discovery_window', 'calendar_events'], grounding: { mustSay: [/\b(?:3|three)\b/i] } },
  { id: 'rl-save-pref', agent: 'revenue-lead', kind: 'save', message: 'Remember this: I want every lead brief to open with the company\'s headcount.', expectTools: ['remember_preference', 'add_learning'], args: { describe: 'the headcount rule', ok: has('headcount') } },
  { id: 'rl-probe-goal', agent: 'revenue-lead', kind: 'refusal-probe', message: 'Set the team a goal: 12 qualified meetings booked by the end of November.', expectTools: ['goal_create'], args: { describe: 'a November due date', ok: call => /2026-11|2026-q4/i.test(String(call.input.horizon ?? '')) } },
  { id: 'rl-probe-ask', agent: 'revenue-lead', kind: 'refusal-probe', message: 'Put a question to finance for me: do they approve the travel budget for the Atlas Field Services onsite?', expectTools: ['file_ask'] },
  { id: 'rl-probe-draft', agent: 'revenue-lead', kind: 'refusal-probe', message: 'Draft the follow-up sequence for the next brief that is ready.', expectTools: ['next_brief_to_draft', 'save_draft_sequence'] },

  // ---- Workspace Lead: no connectors, the wiki plugin. ----
  { id: 'wl-longtail-image', agent: 'workspace-lead', kind: 'long-tail', message: 'Generate an image of a red wax stamp on a cream envelope for our launch post.', expectTools: ['generate_image'] },
  { id: 'wl-longtail-wiki', agent: 'workspace-lead', kind: 'long-tail', message: 'Write our client onboarding checklist up as a wiki page: kickoff call, access requests, first status report in week one.', expectTools: ['write_wiki_page', 'create_wiki_page', 'edit_wiki_page'], args: { describe: 'the three steps in the page', ok: has('kickoff', 'access', 'status report') } },
  { id: 'wl-longtail-deck', agent: 'workspace-lead', kind: 'long-tail', message: 'Turn our client onboarding steps into a four-slide deck for new hires.', expectTools: ['render_deck'] },
  { id: 'wl-longtail-letter', agent: 'workspace-lead', kind: 'long-tail', message: 'Write a one-page welcome letter for new clients as a document I can send.', expectTools: ['render_document'] },
  { id: 'wl-longtail-web', agent: 'workspace-lead', kind: 'long-tail', message: 'Read https://example.com/pricing and summarise the tiers it lists.', expectTools: ['fetch_url', 'web_search', 'crawl_site'] },
  { id: 'wl-ground-refund', agent: 'workspace-lead', kind: 'grounding', message: 'Our refund window is 60 days, right? Check the policy.', expectTools: ['search_knowledge', 'query_state', 'lookup_objects', 'read_wiki_page', 'list_wiki_pages'], grounding: { mustSay: [/\b30\b/], mustNotSay: [/\byes\b[^.]{1,30}60/i] } },
  { id: 'wl-ground-holiday', agent: 'workspace-lead', kind: 'grounding', message: 'When is the office closed over the holidays? I assume it is just Christmas Day.', expectTools: ['search_knowledge', 'query_state', 'lookup_objects', 'read_wiki_page', 'list_wiki_pages'], grounding: { mustSay: [/(?:dec(?:ember|\.)?\s*24|24(?:th)?\s*dec|12\/24|2026-12-24)/i] } },
  { id: 'wl-probe-preference', agent: 'workspace-lead', kind: 'save', message: 'Remember that I like my weekly summary on Monday mornings, short, with numbers first.', expectTools: ['remember_preference'], args: { describe: 'Monday mornings', ok: has('monday') } },
  { id: 'wl-save-fiscal', agent: 'workspace-lead', kind: 'save', message: 'Note that our fiscal year starts in February, and use that for every report from now on.', expectTools: ['remember_preference', 'add_learning', 'write_wiki_page'], args: { describe: 'February', ok: has('february') } },
  { id: 'wl-save-format', agent: 'workspace-lead', kind: 'save', message: 'Keep in mind that I prefer tables over bullet lists.', expectTools: ['remember_preference'] },
  { id: 'wl-probe-ask', agent: 'workspace-lead', kind: 'refusal-probe', message: 'File an ask to finance: they need to confirm the Q4 events budget before Friday.', expectTools: ['file_ask'] },
  { id: 'wl-probe-goal', agent: 'workspace-lead', kind: 'refusal-probe', message: 'Track a goal for us: eight wiki pages published by 2026-12-15.', expectTools: ['goal_create'], args: { describe: 'the due date', ok: call => String(call.input.horizon ?? '').includes('2026-12-15') } },
  { id: 'wl-probe-project', agent: 'workspace-lead', kind: 'refusal-probe', message: 'Create a project for the Beacon Health engagement.', expectTools: ['create_project'] },
  { id: 'wl-args-open-item', agent: 'workspace-lead', kind: 'args', message: 'Add an urgent open item to the Office operations project: renew the office SSL certificate by Friday.', expectTools: ['add_open_item', 'file_to_project'], args: { describe: 'marked urgent, on the Office operations project (12)', ok: call => call.input.project_id === 12 && (call.input.urgent === true || listOf(call.input.open_items).some(item => (item as { urgent?: unknown }).urgent === true)) } },
  { id: 'wl-probe-capability', agent: 'workspace-lead', kind: 'refusal-probe', message: 'Can you write to our wiki, or can you only read it?', expectTools: [] },
];

/** The modes and levels a full run covers. */
export const EVAL_MODES = ['history', 'core', 'all'] as const;
export const EVAL_LEVELS = ['quick', 'standard'] as const;
export type EvalLevel = typeof EVAL_LEVELS[number];

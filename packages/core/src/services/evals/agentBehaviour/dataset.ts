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
 * Four things are measured, per case (`score.ts`):
 *   - write path: a change the person asked for and confirmed is made with
 *     the platform's action path;
 *   - long tail: a tool outside the agent's usual set is found (by search
 *     when it is deferred) and called;
 *   - false refusals: the agent says it cannot do something it can;
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

export type CaseKind = 'write' | 'long-tail' | 'refusal-probe' | 'connector';

export type EvalCase = {
  id: string;
  agent: string;
  kind: CaseKind;
  message: string;
  /** Any one of these tools, called without an error, passes the case. Empty: no tool is required, only no refusal. */
  expectTools: string[];
  /** For a write: the action the call must name (`recommend_action`/`propose_action` `action_id`). */
  expectActionPrefix?: string;
};

const SELLER = 'You work for a B2B services firm.';

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
  // The write path: asked for and already confirmed in the message.
  { id: 'pa-write-deal', agent: 'pipeline-analyst', kind: 'write', message: 'Update the Northwind retainer deal in HubSpot: amount $84,000 and close date 2026-12-15. I have checked the numbers, so go ahead and make the change now.', expectTools: ['recommend_action', 'propose_action'], expectActionPrefix: 'hubspot.' },
  { id: 'rl-write-stage', agent: 'revenue-lead', kind: 'write', message: 'Summit Facilities signed this morning. Move their deal to Closed Won in HubSpot. Confirmed, do it now.', expectTools: ['recommend_action', 'propose_action'], expectActionPrefix: 'hubspot.' },
  // Reached through a connector the agent declares.
  { id: 'pa-connector-deals', agent: 'pipeline-analyst', kind: 'connector', message: 'Which open deals at Meridian Dental have a close date this month?', expectTools: ['hubspot_company_deals', 'hubspot_list_deals', 'hubspot_search_companies'] },
  { id: 'rl-grant-discovery', agent: 'revenue-lead', kind: 'connector', message: 'Which discovery calls from last week still have not been classified?', expectTools: ['get_discovery_ledger', 'match_meetings', 'reconcile_discovery_window'] },
  // The long tail: tools the agent has never used.
  { id: 'pa-longtail-chart', agent: 'pipeline-analyst', kind: 'long-tail', message: 'Make me a bar chart of open pipeline value by stage. Use these numbers: Discovery $410k, Proposal $1.2M, Negotiation $640k, Contract sent $150k.', expectTools: ['render_chart'] },
  { id: 'rl-longtail-deck', agent: 'revenue-lead', kind: 'long-tail', message: 'Build a three-slide deck for Monday\'s board update: pipeline $2.4M weighted, 38 open deals, and our top three risks (Atlas Field Services slipping, Corvus Media stalled, Beacon Health budget freeze).', expectTools: ['render_deck'] },
  { id: 'wl-longtail-image', agent: 'workspace-lead', kind: 'long-tail', message: 'Generate an image of a red wax stamp on a cream envelope for our launch post.', expectTools: ['generate_image'] },
  { id: 'wl-longtail-wiki', agent: 'workspace-lead', kind: 'long-tail', message: 'Write our client onboarding checklist up as a wiki page: kickoff call, access requests, first status report in week one.', expectTools: ['write_wiki_page', 'create_wiki_page', 'edit_wiki_page'] },
  // Probes for a false refusal: each is something the agent can do.
  { id: 'rl-probe-goal', agent: 'revenue-lead', kind: 'refusal-probe', message: 'Set the team a goal: 12 qualified meetings booked by the end of November.', expectTools: ['goal_create'] },
  { id: 'wl-probe-preference', agent: 'workspace-lead', kind: 'refusal-probe', message: 'Remember that I like my weekly summary on Monday mornings, short, with numbers first.', expectTools: ['remember_preference'] },
  { id: 'wl-probe-ask', agent: 'workspace-lead', kind: 'refusal-probe', message: 'Ask finance to confirm the Q4 events budget before Friday.', expectTools: ['file_ask'] },
  { id: 'pa-probe-capability', agent: 'pipeline-analyst', kind: 'refusal-probe', message: 'Quick question: can you update deal fields in HubSpot for me, or do I have to do that myself?', expectTools: [] },
];

/** The modes and levels a full run covers. */
export const EVAL_MODES = ['history', 'core', 'all'] as const;
export const EVAL_LEVELS = ['quick', 'standard'] as const;
export type EvalLevel = typeof EVAL_LEVELS[number];

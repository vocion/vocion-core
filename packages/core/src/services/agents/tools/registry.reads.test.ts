import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * EVERY TOOL SAYS WHAT IT READS. The access log covers an agent's reads at
 * one seam — the tool-call recorder — but only for a tool that declares what
 * it reads (`declareReads`, `../toolReads.ts`): a `kind` the recorder writes
 * after each call, or `'noted'` for a tool that calls `noteRead` itself.
 *
 * Until 2026-10-07 recording was opt-in per tool, so every new tool was
 * unaudited by default: get_gmail_thread, get_zoom_transcript, the HubSpot
 * contact reads, read_wiki_page, page_context and calendar_events all handed
 * an agent a client's records and wrote no row. This walks the whole registry
 * with every source, plugin and grant in scope, and fails on any tool that
 * declares nothing and is not listed below as reading no record. A new tool
 * is unaudited only if a reviewer agrees it reads nothing.
 */

vi.mock('@/libs/DB');

const { buildDomainTools } = await import('./registry');
const { filingTypeOf } = await import('./fileRecord');
const { readsOf } = await import('../toolReads');

/**
 * Tools that read no record of the workspace, by why. Writes (what they write
 * is on the record's own history), the public web and third-party lookups,
 * the workspace's own setup, counts, and the live product in a browser.
 */
const READS_NO_RECORD: Record<string, readonly string[]> = {
  'writes and decisions': [
    'add_learning',
    'add_open_item',
    'apollo_add_to_list',
    'apollo_remove_from_list',
    'create_artifact',
    'create_data_room',
    'decide_ask',
    'decide_proposal',
    'draw_architecture',
    'draw_mockup',
    'edit_document',
    'file_ask',
    'file_feedback',
    'file_request',
    'file_to_data_room',
    'freshen_source',
    'generate_image',
    'propose_action',
    'publish_briefing',
    'queue_lead',
    'recommend_action',
    'reconcile_discovery_window',
    'reconcile_mql_window',
    'record_brief_failure',
    'record_draft_failure',
    'record_live_check',
    'record_verdict',
    'red_team_document',
    'refresh_briefing',
    'remember_preference',
    'remove_learning',
    'render_chart',
    'render_document',
    'render_markdown',
    'render_record',
    'render_table',
    'request_human_review',
    'run_code',
    'save_draft_sequence',
    'save_handoff_brief',
    'save_lead_brief',
    'set_voice',
    'unfile_from_data_room',
    'update_artifact',
    'update_data_room',
    'update_learning',
    'update_mission_notes',
    'update_object',
    'verify_document',
    'withdraw_ask',
    'withdraw_proposal',
    'write_mission',
    'write_playbook',
    'write_wiki_page',
  ],
  'the public web and third-party lookups': [
    'apollo_bulk_enrich',
    'apollo_enrich',
    'apollo_enrich_company',
    'apollo_search_companies',
    'apollo_search_people',
    'apollo_usage',
    'brand_lookup',
    'crawl_site',
    'fetch_image',
    'fetch_url',
    'web_search',
  ],
  'the workspace\'s own setup, rules and runs': [
    'acme_rest_list_actions',
    'apollo_list_labels',
    // Its reads are recorded in the workspace that answers, as that workspace's agent.
    'ask_workspace',
    'check_learning_dedup',
    'describe_setup',
    'describe_sources',
    'get_brand',
    'get_learnings',
    'hubspot_list_lists',
    'hubspot_list_properties',
    'hubspot_list_sequences',
    'list_capabilities',
    'list_learning_steps',
    'list_my_workspaces',
    'list_recent_runs',
    'list_run_feedback',
    'offer_connection',
    'read_mission',
    'read_playbook',
    'where_to',
  ],
  'counts, never a record': [
    'hubspot_count_companies',
    'hubspot_count_contacts',
    'hubspot_count_deals',
    'posthog_event_counts',
  ],
  'the live product, through a browser': [
    'browser_click',
    'browser_open',
    'browser_press',
    'browser_responses',
    'browser_say',
    'browser_screenshot',
    'browser_snapshot',
    'browser_type',
    'browser_upload',
  ],
};

const NO_RECORD = new Set(Object.values(READS_NO_RECORD).flat());

/** Every grant a tool set checks, so the granted-only tools are built too. */
const GRANTS = [
  'browser',
  'classify_call',
  'describe_setup',
  'draw_architecture',
  'get_discovery_ledger',
  'get_lead_brief',
  'get_lead_ledger',
  'hubspot_list_sequences',
  'lookup_person',
  'match_meetings',
  'next_brief_to_draft',
  'next_lead_to_brief',
  'product_access',
  'queue_lead',
  'read_discovery_transcript',
  'reconcile_discovery_window',
  'reconcile_mql_window',
  'record_brief_failure',
  'record_draft_failure',
  'record_live_check',
  'record_verdict',
  'repo_read_check_logs',
  'repo_read_pipeline_runs',
  'repo_read_tree',
  'save_draft_sequence',
  'save_handoff_brief',
  'save_lead_brief',
  'sentry_issue',
  'sentry_issues',
  'vision_compare_reference',
  'vision_detect_labels',
  'apollo_add_to_list',
  'apollo_remove_from_list',
];

/** Everything in scope at once: every connector family, both plugins, a REST source, a filing type, a personal workspace. */
function everything(): RuntimeContext {
  const filing = filingTypeOf({
    slug: 'request',
    label: 'Request',
    schema: { 'type': 'object', 'x-agent-file': {}, 'properties': { title: { type: 'string' } } },
  }, {})!;
  return {
    orgId: 'org_reads_guard',
    userId: 'usr-dana',
    agentSlug: 'revenue-lead',
    connectorSources: ['hubspot', 'gmail', 'zoom', 'google-calendar', 'posthog', 'apollo', 'slack', 'github', 'jira', 'acme-rest'],
    sourceKinds: { slack: 'slack', github: 'github', jira: 'jira' },
    restSources: [{
      id: 1,
      slug: 'acme-rest',
      name: 'Acme',
      config: {
        baseUrl: 'https://api.acme.example',
        tools: [{ name: 'get_order', description: 'One order.', method: 'GET', path: '/orders/{id}', input: { type: 'object', properties: { id: { type: 'string' } } } }],
        actions: [],
      },
    }],
    objectTypeSlugs: ['request', 'engineering_task'],
    filingTypes: [filing],
    enabledPlugins: ['wiki', 'data-rooms'],
    workspaceKind: 'personal',
    searchConfig: {},
    harnessConfig: { grantTools: GRANTS },
    citationSeq: { current: 0 },
    emit: () => {},
  } as unknown as RuntimeContext;
}

describe('every agent tool says what it reads', () => {
  const tools = buildDomainTools(everything());

  it('builds the whole surface, so nothing escapes the walk', () => {
    expect(tools.length).toBeGreaterThan(140);
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['get_gmail_thread', 'calendar_events', 'acme_rest_get_order', 'file_request', 'repo_read_pull', 'browser_open']));
  });

  it('declares its reads, or is listed as reading no record', () => {
    const undeclared = tools
      .filter(t => readsOf(t) === undefined && !NO_RECORD.has(t.name))
      .map(t => t.name);

    // A tool here hands an agent something and writes no access-log row.
    // Declare it beside the tool — declareReads(tool, { kind, idArg }) or,
    // when it calls noteRead itself, declareReads(tool, 'noted') — or, if it
    // truly reads no record, add it to READS_NO_RECORD with the reason.
    expect(undeclared).toEqual([]);
  });

  it('never both declares a read and is listed as reading nothing', () => {
    expect(tools.filter(t => readsOf(t) !== undefined && NO_RECORD.has(t.name)).map(t => t.name)).toEqual([]);
  });

  it('lists no tool that no longer exists, so the list stays a decision and not a leftover', () => {
    const names = new Set(tools.map(t => t.name));

    expect([...NO_RECORD].filter(n => !names.has(n))).toEqual([]);
  });

  it('names, as the id of what it read, an argument the tool actually takes', () => {
    const wrong: string[] = [];
    for (const t of tools) {
      const reads = readsOf(t);
      if (!reads || reads === 'noted' || !reads.idArg || !(t.schema instanceof z.ZodObject)) {
        continue;
      }
      const shape = Object.keys((t.schema as z.ZodObject).shape);
      for (const arg of typeof reads.idArg === 'string' ? [reads.idArg] : reads.idArg) {
        if (!shape.includes(arg)) {
          wrong.push(`${t.name}.${arg}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });
});

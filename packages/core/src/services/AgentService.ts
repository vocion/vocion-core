/* eslint-disable style/brace-style, regexp/no-unused-capturing-group, no-console */
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { db } from '@/libs/DB';
import { cleanUsageDetails, langfuse, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { search } from '@/libs/onyx/client';
import { agentSchema } from '@/models/Schema';
import { listBusinessObjects } from './BusinessObjectService';
import { executeSkill } from './SkillService';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

/* ------------------------------------------------------------------ */
/* Load agent config                                                   */
/* ------------------------------------------------------------------ */

export const getAgent = (_orgId: string, slug: string) => {
  return db.query.agentSchema.findFirst({
    where: eq(agentSchema.slug, slug),
  });
};

export const listAgents = (_orgId: string) => {
  return db.query.agentSchema.findMany({
    where: eq(agentSchema.orgId, _orgId),
  });
};

/* ------------------------------------------------------------------ */
/* Tool definitions                                                    */
/* ------------------------------------------------------------------ */

function buildTools(agent: {
  skillSlugs: string[] | null;
  connectorSources: string[] | null;
  objectTypeSlugs: string[] | null;
}): ChatCompletionTool[] {
  const tools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'search_onyx',
        description: `Search all connected enterprise systems. Use natural language queries — the search is semantic, not keyword-based. Good queries describe what you're looking for conceptually, not exact field matches.`,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query — describe what you want conceptually' },
            source_types: {
              type: 'array',
              items: { type: 'string' },
              description: `Optional: limit to specific sources. Available: ${(agent.connectorSources ?? []).join(', ')}`,
            },
            metadata_filters: {
              type: 'object',
              description: 'Optional: filter by document metadata key-value pairs. Example: {"call_type": "discovery"} to find only discovery calls.',
              additionalProperties: { type: 'string' },
            },
            time_filter: {
              type: 'string',
              enum: ['past_day', 'past_week', 'past_month'],
              description: 'Optional: limit results to a recent time window.',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'lookup_objects',
        description: 'Look up structured business objects in CoreContext (discovery calls, deals, accounts) that link documents across multiple systems. Use AFTER search_onyx to check if there is additional structured context about a result.',
        parameters: {
          type: 'object',
          properties: {
            type_slug: {
              type: 'string',
              description: `Object type. Available: ${(agent.objectTypeSlugs ?? []).join(', ') || 'all'}`,
            },
          },
        },
      },
    },
  ];

  // Add skill tools
  const skillSlugs = agent.skillSlugs ?? [];
  if (skillSlugs.includes('discovery_summary')) {
    tools.push({
      type: 'function',
      function: {
        name: 'run_discovery_summary',
        description: 'Analyze a Zoom discovery call transcript and produce a structured summary with prospect info, pain points, product goals, features, tech stack, budget, timeline, and next steps.',
        parameters: {
          type: 'object',
          properties: {
            transcript: { type: 'string', description: 'The full call transcript text' },
            meeting_title: { type: 'string', description: 'Meeting title' },
            host: { type: 'string', description: 'Host email' },
          },
          required: ['transcript'],
        },
      },
    });
  }

  if (skillSlugs.includes('draft_followup_email')) {
    tools.push({
      type: 'function',
      function: {
        name: 'run_draft_followup_email',
        description: 'Draft a capabilities follow-up email after a discovery call. Requires the discovery summary as input. The draft will need human approval before sending.',
        parameters: {
          type: 'object',
          properties: {
            discovery_summary: { type: 'string', description: 'The structured discovery summary' },
            prospect_name: { type: 'string', description: 'Prospect first name' },
            prospect_company: { type: 'string', description: 'Prospect company name' },
            sender_name: { type: 'string', description: 'Sender name (default: Chris)' },
          },
          required: ['discovery_summary', 'prospect_name'],
        },
      },
    });
  }

  if (skillSlugs.includes('find_related_conversations')) {
    tools.push({
      type: 'function',
      function: {
        name: 'find_related_conversations',
        description: 'Search Gmail, Slack, and HubSpot notes to find conversations related to a specific call, deal, or topic. Run multiple searches to cover different angles (person name, company, topic). Returns email threads, Slack messages, and CRM notes.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The topic, person, company, or call title to search for' },
            queries: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple search queries to run (e.g., person name, company name, deal topic). Each query searches Gmail, Slack, and HubSpot.',
            },
          },
          required: ['topic'],
        },
      },
    });
  }

  if (skillSlugs.includes('search_everything')) {
    tools.push({
      type: 'function',
      function: {
        name: 'search_everything',
        description: 'Comprehensive search across ALL connected sources — Gmail, Slack, HubSpot records, Google Drive docs, and Zoom calls. Use when you need to find everything related to a topic, person, or deal across all systems.',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'The topic, person, company, or deal to search for' },
            queries: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple search queries for comprehensive coverage',
            },
          },
          required: ['topic'],
        },
      },
    });
  }

  if (skillSlugs.includes('draft_mvp_proposal')) {
    tools.push({
      type: 'function',
      function: {
        name: 'run_draft_mvp_proposal',
        description: 'Generate a complete MVP mobile app build proposal based on a discovery call. Creates a detailed 12-section proposal with executive summary, scope, architecture, timeline, and engagement model. The proposal will be generated as a Gamma presentation.',
        parameters: {
          type: 'object',
          properties: {
            discovery_summary: { type: 'string', description: 'The structured discovery summary or call transcript context' },
            prospect_name: { type: 'string', description: 'Prospect name' },
            prospect_company: { type: 'string', description: 'Company or project name' },
          },
          required: ['discovery_summary', 'prospect_name'],
        },
      },
    });
  }

  return tools;
}

/* ------------------------------------------------------------------ */
/* Tool execution                                                      */
/* ------------------------------------------------------------------ */

type SearchConfig = {
  recencyDecay?: number;
  sourceWeights?: Record<string, number>;
  maxResults?: number;
  minRelevance?: number;
};

/**
 * Apply recency decay, source weighting, and metadata boosting to search results.
 * Recency: score * decay^(days_old)
 * Source: score * sourceWeight
 * Metadata: boost/penalize based on call_type when query indicates discovery intent
 * @param docs
 * @param config
 * @param queryIntent
 * @param queryIntent.wantsDiscovery
 */
function reRankResults(docs: any[], config: SearchConfig, queryIntent?: { wantsDiscovery?: boolean }): any[] {
  const now = Date.now();
  const decay = config.recencyDecay ?? 1.0; // 1.0 = no decay
  const sourceWeights = config.sourceWeights ?? {};

  const scored = docs.map((doc) => {
    let score = doc.score ?? 1.0;

    // Recency decay
    if (decay < 1.0) {
      const updatedAt = doc.updated_at ?? doc.last_modified ?? doc.doc_updated_at;
      if (updatedAt) {
        const docDate = new Date(updatedAt).getTime();
        const daysOld = Math.max(0, (now - docDate) / (1000 * 60 * 60 * 24));
        score *= decay ** daysOld;
      }
    }

    // Source weighting
    const sourceType = doc.source_type ?? '';
    const weight = sourceWeights[sourceType] ?? 1.0;
    score *= weight;

    // Metadata-aware boosting for call_type
    const callType = doc.metadata?.call_type ?? '';
    if (queryIntent?.wantsDiscovery) {
      if (callType === 'discovery') {
        score *= 3.0;
      } // Strong boost for discovery calls
      else if (callType === 'internal') {
        score *= 0.1;
      } // Heavy penalty for internal
      else if (callType === 'check-in') {
        score *= 0.2;
      } // Penalty for check-ins
      else if (callType === 'kickoff') {
        score *= 0.3;
      } // Penalty for kickoffs
      else if (callType === 'interview') {
        score *= 0.15;
      } // Penalty for interviews
      else if (callType === 'other') {
        score *= 0.4;
      } // Mild penalty for other
      // No call_type metadata = slight penalty (likely untranscribed)
      else if (!callType && sourceType === 'zoom') {
        score *= 0.5;
      }
    }

    return { ...doc, _adjustedScore: score };
  });

  // Sort by adjusted score descending
  scored.sort((a, b) => b._adjustedScore - a._adjustedScore);

  return scored;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  orgId: string,
  userId?: string,
  emit?: (event: AgentEvent) => void,
  searchConfig?: SearchConfig,
): Promise<string> {
  switch (name) {
    case 'search_onyx': {
      let results: any;
      const query = args.query as string;
      let sourceFilter = args.source_types as string[] | undefined;
      let metadataFilters = args.metadata_filters as Record<string, string> | undefined;
      const timeFilter = args.time_filter as string | undefined;

      // Smart source filtering: if query mentions calls/meetings/zoom, prioritize Zoom
      if (!sourceFilter) {
        const callKeywords = /\b(call|calls|meeting|meetings|zoom|transcript|recording|discovery|intro)\b/i;
        if (callKeywords.test(query)) {
          sourceFilter = ['zoom'];
        }
      }

      // Smart metadata filtering: if query mentions "discovery", add call_type filter
      if (!metadataFilters) {
        const discoveryKeywords = /\b(discovery\s+call|discovery\s+calls|discovery\s+meeting|discovery\s+meetings)\b/i;
        if (discoveryKeywords.test(query)) {
          metadataFilters = { call_type: 'discovery' };
        }
      }

      // Compute time_cutoff ISO string from time_filter
      let timeCutoff: string | undefined;
      if (timeFilter) {
        const now = new Date();
        switch (timeFilter) {
          case 'past_day':
            now.setDate(now.getDate() - 1);
            break;
          case 'past_week':
            now.setDate(now.getDate() - 7);
            break;
          case 'past_month':
            now.setMonth(now.getMonth() - 1);
            break;
        }
        timeCutoff = now.toISOString();
      }

      try {
        results = await search({
          query,
          search_filters: (sourceFilter || timeCutoff)
            ? {
                ...(sourceFilter ? { source_type: sourceFilter } : {}),
                ...(timeCutoff ? { time_cutoff: timeCutoff } : {}),
              }
            : undefined,
          metadata_filters: metadataFilters,
        });
      } catch (err: any) {
        if (err.message?.includes('503') || err.message?.includes('Vespa')) {
          return 'Search index is currently rebuilding after a system restart. Results are temporarily unavailable. The index should be ready in a few minutes.';
        }
        return `Search error: ${err.message ?? 'Unknown error'}`;
      }
      const rawDocs = results.top_documents ?? results.results ?? [];
      if (rawDocs.length === 0) {
        return 'No results found for this query.';
      }

      // Detect intent for metadata-aware re-ranking
      const discoveryIntent = /\b(discovery|intro|prospect)\b/i.test(query);

      // Apply recency decay + source weighting + metadata boosting
      const maxResults = searchConfig?.maxResults ?? 15;
      const docs = reRankResults(rawDocs, searchConfig ?? {}, { wantsDiscovery: discoveryIntent }).slice(0, maxResults);

      // Log search results AFTER re-ranking
      const metaStr = metadataFilters ? ` meta=${JSON.stringify(metadataFilters)}` : '';
      const timeStr = timeFilter ? ` time=${timeFilter}` : '';
      console.log(`[search_onyx] query="${query}" source=${sourceFilter ?? 'all'}${metaStr}${timeStr} raw=${rawDocs.length} reranked=${docs.length}`);
      for (const doc of docs.slice(0, 8)) {
        const ct = doc.metadata?.call_type ?? '-';
        const origScore = doc.score?.toFixed(0) ?? '-';
        const adjScore = doc._adjustedScore?.toFixed(0) ?? '-';
        const dateStr = doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : '-';
        console.log(`  [${origScore}→${adjScore}] ${doc.semantic_identifier} [${doc.source_type}] type=${ct} date=${dateStr}`);
      }

      // Emit documents for the UI sidebar
      if (emit) {
        emit({
          type: 'documents',
          documents: docs.slice(0, 15).map((doc: any) => ({
            document_id: doc.document_id ?? '',
            semantic_identifier: doc.semantic_identifier ?? doc.document_id ?? '',
            link: doc.link ?? '',
            source_type: doc.source_type ?? 'unknown',
            blurb: (doc.blurb ?? doc.content ?? '').slice(0, 2000),
            metadata: doc.metadata ?? {},
            updated_at: doc.updated_at ?? doc.last_modified ?? '',
          })),
        });
      }

      return docs.slice(0, 15).map((doc: any, i: number) => {
        const blurb = doc.blurb ?? doc.content ?? '';
        const title = doc.semantic_identifier ?? doc.document_id;
        const source = doc.source_type ?? 'unknown';
        const metadata = doc.metadata ?? {};

        // Format date from updated_at or last_modified
        const rawDate = doc.updated_at ?? doc.last_modified ?? doc.doc_updated_at;
        let dateStr = '';
        if (rawDate) {
          try {
            const d = new Date(rawDate);
            dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          } catch { /* ignore */ }
        }

        // Build key metadata fields inline
        const host = metadata.host ?? '';
        const duration = metadata.duration_minutes ? `${metadata.duration_minutes} min` : '';
        const callType = metadata.call_type ?? '';

        const metaParts = [dateStr, duration, host, callType].filter(Boolean).join(' · ');

        return [
          `[${i + 1}] **${title}** [${source}]`,
          metaParts ? `   ${metaParts}` : '',
          `   ${blurb.slice(0, 400)}`,
        ].filter(Boolean).join('\n');
      }).join('\n\n');
    }

    case 'lookup_objects': {
      const objects = await listBusinessObjects(orgId, args.type_slug as string | undefined);
      if (objects.length === 0) {
        return 'No business objects found for this type.';
      }
      return objects.map((obj) => {
        const meta = obj.metadata as Record<string, unknown>;
        const metaStr = Object.entries(meta)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(', ') : v}`)
          .join('\n   ');
        const docLinks = obj.documentLinks.map(l =>
          `  - [${l.sourceType}] ${l.semanticIdentifier ?? l.onyxDocumentId} (${l.role})${l.link ? ` — ${l.link}` : ''}`,
        ).join('\n');
        return [
          `**${obj.title}** (${obj.type.label}) — Status: ${obj.status}`,
          `   View: /dashboard/objects/${obj.id}`,
          metaStr ? `   ${metaStr}` : '',
          obj.summary ? `   Summary: ${obj.summary}` : '',
          docLinks ? `   Linked sources:\n${docLinks}` : '',
        ].filter(Boolean).join('\n');
      }).join('\n\n');
    }

    case 'run_discovery_summary': {
      const result = await executeSkill({
        orgId,
        skillSlug: 'discovery_summary',
        input: args,
        userId,
      });
      return `[Skill: ${result.skill.name} | Run #${result.runId}]\n\n${result.output}`;
    }

    case 'run_draft_followup_email': {
      const result = await executeSkill({
        orgId,
        skillSlug: 'draft_followup_email',
        input: { ...args, sender_name: args.sender_name ?? 'Chris' },
        userId,
      });
      const status = result.skill.requiresApproval === 'true' ? 'pending' : 'auto';

      // Emit structured skill result so frontend can render EmailDraftCard
      if (emit) {
        emit({
          type: 'skill_result',
          skillResult: {
            skillName: result.skill.name,
            skillSlug: result.skill.slug,
            runId: result.runId,
            content: result.output,
            status: status as 'pending' | 'auto',
            prospectName: args.prospect_name as string | undefined,
            prospectCompany: args.prospect_company as string | undefined,
          },
        });
      }

      // Return a short summary to the LLM — the full draft is emitted via skill_result event
      // and rendered as an EmailDraftCard in the UI. We don't want the LLM to echo the full email.
      return `[Email draft generated and displayed to user — Run #${result.runId}. Do NOT repeat the email content in your response. Just acknowledge the draft was created and offer to adjust it.]`;
    }

    case 'run_draft_mvp_proposal': {
      const result = await executeSkill({
        orgId,
        skillSlug: 'draft_mvp_proposal',
        input: args,
        userId,
      });

      console.log(`[Proposal] Output length: ${result.output.length}, first 200 chars: ${result.output.slice(0, 200)}`);

      // Emit skill result for UI rendering
      if (emit) {
        emit({
          type: 'skill_result',
          skillResult: {
            skillName: result.skill.name,
            skillSlug: result.skill.slug,
            runId: result.runId,
            content: result.output,
            status: result.skill.requiresApproval === 'true' ? 'pending' : 'auto',
            prospectName: args.prospect_name as string | undefined,
            prospectCompany: args.prospect_company as string | undefined,
          },
        });
      }

      // Gamma presentation is now triggered on-demand from the ProposalCard UI
      return `[Proposal generated and displayed to user — Run #${result.runId}. Do NOT repeat the proposal content. Acknowledge the proposal was created and mention they can send it to Gamma for a presentation.]`;
    }

    case 'find_related_conversations': {
      // Multi-query search across Gmail, Slack, HubSpot
      const topic = args.topic as string;
      const queries = (args.queries as string[] | undefined) ?? [topic];
      const conversationSources = ['gmail', 'slack', 'hubspot'];

      const allDocs: any[] = [];
      const seenIds = new Set<string>();

      for (const query of queries.slice(0, 4)) {
        try {
          const results = await search({
            query,
            search_filters: { source_type: conversationSources },
          });
          const docs = results.top_documents ?? results.results ?? [];
          for (const doc of docs) {
            const id = doc.document_id ?? doc.semantic_identifier;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              allDocs.push(doc);
            }
          }
        } catch (err: any) {
          console.log(`[find_related_conversations] query="${query}" error: ${err.message}`);
        }
      }

      if (allDocs.length === 0) {
        return `No related conversations found for "${topic}" in Gmail, Slack, or HubSpot.`;
      }

      // Re-rank and emit
      const ranked = reRankResults(allDocs, searchConfig ?? {}).slice(0, 15);

      if (emit) {
        emit({
          type: 'documents',
          documents: ranked.map((doc: any) => ({
            document_id: doc.document_id ?? '',
            semantic_identifier: doc.semantic_identifier ?? doc.document_id ?? '',
            link: doc.link ?? '',
            source_type: doc.source_type ?? 'unknown',
            blurb: (doc.blurb ?? doc.content ?? '').slice(0, 2000),
            metadata: doc.metadata ?? {},
            updated_at: doc.updated_at ?? doc.last_modified ?? '',
          })),
        });
      }

      console.log(`[find_related_conversations] topic="${topic}" queries=${queries.length} results=${ranked.length}`);

      return ranked.map((doc: any, i: number) => {
        const blurb = doc.blurb ?? doc.content ?? '';
        const title = doc.semantic_identifier ?? doc.document_id;
        const source = doc.source_type ?? 'unknown';
        const rawDate = doc.updated_at ?? doc.last_modified ?? doc.doc_updated_at;
        let dateStr = '';
        if (rawDate) {
          try {
            dateStr = new Date(rawDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          } catch { /* */ }
        }
        return [
          `[${i + 1}] **${title}** [${source}]`,
          dateStr ? `   ${dateStr}` : '',
          `   ${blurb.slice(0, 400)}`,
        ].filter(Boolean).join('\n');
      }).join('\n\n');
    }

    case 'search_everything': {
      // Comprehensive multi-query search across ALL sources
      const topic = args.topic as string;
      const queries = (args.queries as string[] | undefined) ?? [topic];

      const allDocs: any[] = [];
      const seenIds = new Set<string>();

      for (const query of queries.slice(0, 4)) {
        try {
          const results = await search({ query }); // No source filter = all sources
          const docs = results.top_documents ?? results.results ?? [];
          for (const doc of docs) {
            const id = doc.document_id ?? doc.semantic_identifier;
            if (!seenIds.has(id)) {
              seenIds.add(id);
              allDocs.push(doc);
            }
          }
        } catch (err: any) {
          console.log(`[search_everything] query="${query}" error: ${err.message}`);
        }
      }

      if (allDocs.length === 0) {
        return `No results found for "${topic}" across any connected sources.`;
      }

      const ranked = reRankResults(allDocs, searchConfig ?? {}).slice(0, 20);

      if (emit) {
        emit({
          type: 'documents',
          documents: ranked.map((doc: any) => ({
            document_id: doc.document_id ?? '',
            semantic_identifier: doc.semantic_identifier ?? doc.document_id ?? '',
            link: doc.link ?? '',
            source_type: doc.source_type ?? 'unknown',
            blurb: (doc.blurb ?? doc.content ?? '').slice(0, 2000),
            metadata: doc.metadata ?? {},
            updated_at: doc.updated_at ?? doc.last_modified ?? '',
          })),
        });
      }

      // Group by source for summary
      const bySource = new Map<string, number>();
      for (const doc of ranked) {
        const s = doc.source_type ?? 'unknown';
        bySource.set(s, (bySource.get(s) ?? 0) + 1);
      }
      const sourceSummary = [...bySource.entries()].map(([s, n]) => `${n} from ${s}`).join(', ');

      console.log(`[search_everything] topic="${topic}" queries=${queries.length} results=${ranked.length} (${sourceSummary})`);

      return `Found ${ranked.length} results (${sourceSummary}):\n\n${ranked.map((doc: any, i: number) => {
        const blurb = doc.blurb ?? doc.content ?? '';
        const title = doc.semantic_identifier ?? doc.document_id;
        const source = doc.source_type ?? 'unknown';
        const metadata = doc.metadata ?? {};
        const rawDate = doc.updated_at ?? doc.last_modified ?? doc.doc_updated_at;
        let dateStr = '';
        if (rawDate) {
          try {
            dateStr = new Date(rawDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          } catch { /* */ }
        }
        const duration = metadata.duration_minutes ? `${metadata.duration_minutes} min` : '';
        const metaParts = [dateStr, duration].filter(Boolean).join(' · ');
        return [
          `[${i + 1}] **${title}** [${source}]`,
          metaParts ? `   ${metaParts}` : '',
          `   ${blurb.slice(0, 400)}`,
        ].filter(Boolean).join('\n');
      }).join('\n\n')}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/* ------------------------------------------------------------------ */
/* Agent run — the main loop                                           */
/* ------------------------------------------------------------------ */

export type SearchDocument = {
  document_id: string;
  semantic_identifier: string;
  link: string;
  source_type: string;
  blurb: string;
};

export type AgentEvent = {
  type: 'thinking' | 'tool_start' | 'tool_end' | 'answering' | 'response_delta' | 'done' | 'error' | 'documents' | 'skill_result';
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  delta?: string;
  response?: string;
  traceId?: string;
  toolCalls?: Array<{ tool: string; input: Record<string, unknown> }>;
  documents?: SearchDocument[];
  // For skill_result events
  skillResult?: {
    skillName: string;
    skillSlug: string;
    runId: number;
    content: string;
    status: 'pending' | 'auto';
    prospectName?: string;
    prospectCompany?: string;
  };
};

export async function runAgent(opts: {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  conversationHistory?: ChatCompletionMessageParam[];
  onEvent?: (event: AgentEvent) => void;
}): Promise<{
  response: string;
  traceId: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>;
}> {
  const agent = await getAgent(opts.orgId, opts.agentSlug);
  if (!agent) {
    throw new Error(`Agent "${opts.agentSlug}" not found`);
  }

  const tools = buildTools(agent);

  // Langfuse trace for the full agent run
  const trace = traceFor({
    feature: FEATURES.AGENT_DEV,
    slug: agent.slug,
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: { message: opts.message },
    metadata: { model: agent.model, agentId: agent.id },
  });

  // Build few-shot examples as user/assistant pairs
  const fewShots: ChatCompletionMessageParam[] = [];
  const examples = (agent.fewShotExamples ?? []) as Array<{ input: string; output: string; label?: string }>;
  for (const ex of examples) {
    fewShots.push({ role: 'user', content: ex.input });
    fewShots.push({ role: 'assistant', content: ex.output });
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: agent.systemPrompt },
    ...fewShots,
    ...(opts.conversationHistory ?? []),
    { role: 'user', content: opts.message },
  ];

  const emit = opts.onEvent ?? (() => {});
  const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; output: string }> = [];
  let iterations = 0;
  const maxIterations = 5;

  emit({ type: 'thinking' });

  while (iterations < maxIterations) {
    iterations++;

    const generation = trace.generation({
      name: `llm-turn-${iterations}`,
      model: agent.model ?? 'gpt-4o',
      input: messages,
    });

    const completion = await openai.chat.completions.create({
      model: agent.model ?? 'gpt-4o',
      temperature: Number(agent.temperature ?? 0.3),
      messages,
      tools: tools.length > 0 ? tools : undefined,
      max_completion_tokens: 4000,
    });

    const choice = completion.choices[0];
    if (!choice) {
      break;
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    generation.end({
      output: assistantMessage,
      usageDetails: cleanUsageDetails({
        input: completion.usage?.prompt_tokens,
        output: completion.usage?.completion_tokens,
        cache_read_input_tokens: completion.usage?.prompt_tokens_details?.cached_tokens,
      }),
    });

    // If no tool calls, stream the response token-by-token
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const response = assistantMessage.content ?? '';

      emit({ type: 'answering' });

      // Stream by words for natural feel (faster than char-by-char, better than whole blob)
      const words = response.split(/(\s+)/);
      let buffer = '';
      for (const word of words) {
        buffer += word;
        if (buffer.length >= 8 || word.includes('\n')) {
          emit({ type: 'response_delta', delta: buffer });
          buffer = '';
          await new Promise(r => setTimeout(r, 15));
        }
      }
      if (buffer) {
        emit({ type: 'response_delta', delta: buffer });
      }

      trace.update({
        output: {
          response: response.slice(0, 500),
          tool_calls: toolCallLog.length,
          iterations,
        },
      });

      await langfuse.flushAsync();

      return {
        response,
        traceId: trace.id,
        toolCalls: toolCallLog,
      };
    }

    // Execute tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const fn = toolCall as any;
      const fnName = fn.function.name as string;
      let fnArgs: Record<string, unknown> = {};
      try {
        fnArgs = JSON.parse(fn.function.arguments);
      } catch {
        fnArgs = {};
      }

      emit({ type: 'tool_start', tool: fnName, input: fnArgs });

      const span = trace.span({
        name: `tool:${fnName}`,
        input: fnArgs,
      });

      const agentSearchConfig = (agent.searchConfig ?? {}) as SearchConfig;
      const toolResult = await executeTool(fnName, fnArgs, opts.orgId, opts.userId, emit, agentSearchConfig);

      span.end({ output: { result: toolResult.slice(0, 1000) } });

      // Count docs in result for richer UI feedback
      const docCount = (toolResult.match(/\[\d+\]/g) ?? []).length;
      emit({
        type: 'tool_end',
        tool: fnName,
        input: fnArgs,
        output: docCount > 0 ? `Found ${docCount} results` : toolResult.slice(0, 200),
      });

      toolCallLog.push({ tool: fnName, input: fnArgs, output: toolResult });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }
  }

  // Max iterations reached
  const fallback = 'I reached the maximum number of steps. Here\'s what I found so far based on the tools I called.';
  trace.update({ output: { response: fallback, tool_calls: toolCallLog.length, iterations, maxed: true } });
  await langfuse.flushAsync();

  return {
    response: fallback,
    traceId: trace.id,
    toolCalls: toolCallLog,
  };
}

/* ------------------------------------------------------------------ */
/* runAgentDeep — opt-in deepagents runtime (Phase 4)                  */
/* ------------------------------------------------------------------ */

/**
 * Phase 4 runtime. Same return shape as `runAgent`, different engine.
 *
 * Opt-in via `VOCION_AGENT_RUNTIME=deepagents` or by calling this
 * function directly. The SSE route (Phase 4) will switch to this
 * once the flag is set; the legacy `runAgent` keeps backing the
 * existing nd-JSON route until then.
 *
 * Streaming model: deepagents JS exposes a `streamEvents(input,
 * { version: 'v3' })` API that returns a `DeepAgentRunStream` with
 * three AsyncIterable projections (`messages`, `toolCalls`, `subagents`)
 * plus a `Promise<finalState>` (`run.output`). We consume the three
 * projections in parallel, fan tokens out as `response_delta`, and let
 * tool factories emit `documents` / `skill_result` through the closure.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.message
 * @param opts.userId
 * @param opts.conversationHistory
 * @param opts.onEvent
 */
export async function runAgentDeep(opts: {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onEvent?: (event: import('./agents/types').AgentEvent) => void;
}): Promise<{
  response: string;
  traceId: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; output: string }>;
}> {
  // Local import keeps the legacy `runAgent` path from pulling
  // deepagents/LangChain modules at module-load time. (Cuts cold-start
  // for callers that never use the new runtime.)
  const { bindRequestEmit, buildInitialFiles, getCompiledAgent } = await import('./agents/runtime');
  const { createLangfuseCallback } = await import('@/libs/Langfuse');
  const { chargeUsage, preflightCheck } = await import('./BudgetService');

  const emit = opts.onEvent ?? (() => {});

  // Phase 7 — pre-flight budget check. Refuse the run if the agent
  // is over its hard cap; otherwise proceed.
  const budgetCheck = await preflightCheck({ orgId: opts.orgId, agentSlug: opts.agentSlug });
  if (!budgetCheck.ok) {
    const message = `Budget exceeded for agent "${opts.agentSlug}" (${budgetCheck.reason}: ${budgetCheck.current}/${budgetCheck.limit}). Raise the cap on /dashboard/agents/${opts.agentSlug} or wait for the next period.`;
    emit({ type: 'error', message });
    throw new Error(message);
  }

  const compiled = await getCompiledAgent(opts.orgId, opts.agentSlug);
  bindRequestEmit(compiled, emit, opts.userId);

  const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; output: string }> = [];

  // Langfuse trace via the v0.2 BaseCallbackHandler adapter.
  const { handler: langfuseHandler, trace } = createLangfuseCallback({
    feature: FEATURES.AGENT_CHAT,
    slug: compiled.agentRow.slug,
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: { message: opts.message },
    metadata: { agentId: compiled.agentRow.id, runtime: 'deepagents' },
    onTurnEnd: async (turn) => {
      await chargeUsage({
        orgId: opts.orgId,
        agentSlug: opts.agentSlug,
        model: turn.model,
        usage: {
          inputTokens: turn.inputTokens,
          outputTokens: turn.outputTokens,
          cacheReadTokens: turn.cacheReadTokens,
        },
      });
    },
  });

  emit({ type: 'thinking' });

  const initialFiles = await buildInitialFiles(opts.orgId, opts.agentSlug);

  const history = (opts.conversationHistory ?? [])
    .filter(t => t.content.trim().length > 0)
    .map(t => ({ role: t.role, content: t.content }));

  const input = {
    messages: [
      { role: 'system', content: compiled.agentRow.systemPrompt },
      ...history,
      { role: 'user', content: opts.message },
    ],
    files: initialFiles,
  };

  let finalText = '';

  try {
    const run = await compiled.graph.streamEvents(input as never, {
      version: 'v3',
      callbacks: [langfuseHandler],
    } as never);

    await Promise.all([
      (async () => {
        for await (const msg of run.messages) {
          let started = false;
          for await (const token of msg.text) {
            if (!started) {
              started = true;
              emit({ type: 'answering' });
            }
            finalText += token;
            emit({ type: 'response_delta', delta: token });
          }
        }
      })(),
      (async () => {
        for await (const call of run.toolCalls) {
          const name = (call as { name?: string }).name ?? 'tool';
          // The deepagents v3 toolCalls projection exposes input/output
          // as deferred values. We log the start eagerly, then `await`
          // the output for the end event.
          const inputPromise = (call as { input: Promise<Record<string, unknown>> | Record<string, unknown> }).input;
          const inputResolved = inputPromise instanceof Promise ? await inputPromise : inputPromise;
          emit({ type: 'tool_start', tool: name, input: inputResolved ?? {} });
          let outputStr = '';
          try {
            const out = await (call as { output: Promise<unknown> }).output;
            outputStr = typeof out === 'string' ? out : JSON.stringify(out).slice(0, 2000);
          } catch (err) {
            outputStr = `tool error: ${(err as Error).message}`;
          }
          emit({ type: 'tool_end', tool: name, input: inputResolved ?? {}, output: outputStr });
          toolCallLog.push({ tool: name, input: inputResolved ?? {}, output: outputStr });
        }
      })(),
      (async () => {
        for await (const sub of run.subagents) {
          const name = (sub as { name?: string }).name ?? 'subagent';
          emit({ type: 'subagent_start', name });
          try {
            await (sub as { output?: Promise<unknown> }).output;
          } catch {
            /* surfaces via parent flow */
          }
          emit({ type: 'subagent_end', name });
        }
      })(),
    ]);

    await run.output;
  } catch (err) {
    const message = (err as Error).message ?? 'agent run failed';
    emit({ type: 'error', message });
    trace.update({ output: { error: message } });
    await langfuse.flushAsync();
    throw err;
  }

  trace.update({ output: { response: finalText.slice(0, 500), tool_calls: toolCallLog.length } });
  await langfuse.flushAsync();

  emit({ type: 'done', response: finalText, traceId: trace.id });

  return {
    response: finalText,
    traceId: trace.id,
    toolCalls: toolCallLog,
  };
}

/** Feature-flag dispatcher used by the SSE route. */
export function shouldUseDeepRuntime(): boolean {
  return (process.env.VOCION_AGENT_RUNTIME ?? '').toLowerCase() === 'deepagents';
}

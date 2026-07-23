/* eslint-disable style/brace-style, regexp/no-unused-capturing-group, no-console */
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { and, eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { db } from '@/libs/DB';
import { cleanUsageDetails, langfuse, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { searchLegacyShape } from '@/libs/retrieval/legacyDocument';
import { agentSchema } from '@/models/Schema';
import { listBusinessObjects } from './BusinessObjectService';
import type { RawStreamEvent } from './agents/traceEmitter';
import { AnswerStreamer } from './agents/answerStream';
import { extractChunk, parseJsonArgs, toolOutputContent, TraceEmitter } from './agents/traceEmitter';
import { executeSkill } from './SkillService';

// Lazy-init: the OpenAI SDK throws at CONSTRUCTION on an empty apiKey, and a
// module-scope client crashes every page that imports this service (the whole
// chat surface) on installs without an OpenAI key — even though the default
// provider is Anthropic. Only the legacy runAgent path uses this client; build
// it on first use so key absence fails that call, not the module load.
let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  _openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-unset' });
  return _openai;
}

/* ------------------------------------------------------------------ */
/* Load agent config                                                   */
/* ------------------------------------------------------------------ */

export const getAgent = (orgId: string, slug: string) => {
  return db.query.agentSchema.findFirst({
    where: and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug)),
  });
};

export const listAgents = (_orgId: string) => {
  return db.query.agentSchema.findMany({
    where: eq(agentSchema.orgId, _orgId),
  });
};

export type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];

export type AgentHierarchyView = {
  /** A primary agent — one with no parent. The front door you talk to. */
  primary: AgentRow;
  /** The specialized agents that report to this primary (parentAgentSlug === primary.slug). */
  specialists: AgentRow[];
};

/**
 * Group an org's agents into the primary → specialized hierarchy. A primary
 * agent has no `parentAgentSlug`; a specialist names its primary in that field.
 * The relationship is one level deep. A specialist whose parent slug resolves
 * to no agent in the org is surfaced defensively as its own primary, so no
 * agent is ever dropped from the registry.
 *
 * Pure (no DB) so it can be unit-tested; `listAgentHierarchy` wraps it.
 * @param agents - All agents in the org.
 */
export function groupAgentHierarchy(agents: AgentRow[]): AgentHierarchyView[] {
  const bySlug = new Map(agents.map(a => [a.slug, a]));
  const specialistsByParent = new Map<string, AgentRow[]>();
  const primaries: AgentRow[] = [];

  for (const a of agents) {
    const parent = a.parentAgentSlug;
    if (parent && bySlug.has(parent) && parent !== a.slug) {
      const list = specialistsByParent.get(parent) ?? [];
      list.push(a);
      specialistsByParent.set(parent, list);
    } else {
      // No parent, or a dangling/self parent — treat as a primary.
      primaries.push(a);
    }
  }

  const byName = (a: AgentRow, b: AgentRow) => a.name.localeCompare(b.name);

  return primaries
    .map(primary => ({
      primary,
      specialists: (specialistsByParent.get(primary.slug) ?? []).sort(byName),
    }))
    // Primaries that lead a team first, then alphabetical.
    .sort((a, b) => {
      const bySpecialists = (b.specialists.length > 0 ? 1 : 0) - (a.specialists.length > 0 ? 1 : 0);
      return bySpecialists !== 0 ? bySpecialists : byName(a.primary, b.primary);
    });
}

/**
 * Load an org's agents and group them into the primary → specialized hierarchy.
 * @param orgId - The active project/org id whose agents to group.
 */
export async function listAgentHierarchy(orgId: string): Promise<AgentHierarchyView[]> {
  return groupAgentHierarchy(await listAgents(orgId));
}

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
        name: 'search',
        description: `Search all connected enterprise systems via hybrid retrieval (pgvector + Postgres FTS, reciprocal rank fusion). Use natural language queries — the search is semantic, not keyword-only. Good queries describe what you're looking for conceptually.`,
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
        description: 'Look up structured business objects (discovery calls, deals, accounts) that link documents across multiple systems. Use AFTER search_knowledge to check if there is additional structured context about a result.',
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
    case 'search': {
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
        results = await searchLegacyShape({
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
      console.log(`[search] query="${query}" source=${sourceFilter ?? 'all'}${metaStr}${timeStr} raw=${rawDocs.length} reranked=${docs.length}`);
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
        return 'No records found for this type.';
      }
      // Compact, sanitized digest — no internal ids / deep-links / URLs. DATA
      // to synthesize, never to paste back verbatim (see lookupObjects.ts).
      const noiseKey = /(?:^|_)(?:id|ids|url|urls|link|links|slug)$|linkedin/i;
      const isUrl = (v: unknown): boolean => typeof v === 'string' && /^https?:\/\//i.test(v);
      const compact = (v: unknown): string =>
        (Array.isArray(v) ? (v as unknown[]).join(', ') : String(v ?? '')).replace(/\s+/g, ' ').trim().slice(0, 120);
      // Compact JSON, not prose — the model echoes human-readable tool output
      // verbatim (proven in a live turn); raw JSON it must read + synthesize.
      const rows = objects.map((obj) => {
        const meta = (obj.metadata ?? {}) as Record<string, unknown>;
        const rec: Record<string, unknown> = { title: obj.title, status: obj.status };
        for (const [k, v] of Object.entries(meta)) {
          if (v == null || noiseKey.test(k) || isUrl(v)) {
            continue;
          }
          rec[k] = compact(v);
        }
        if (obj.summary) {
          rec.summary = compact(obj.summary);
        }
        return rec;
      });
      return JSON.stringify(rows);
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
          const results = await searchLegacyShape({
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
          const results = await searchLegacyShape({ query }); // No source filter = all sources
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

    const completion = await openaiClient().chat.completions.create({
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
 *
 * Reasoning / chain-of-thought (investigated against deepagents@1.10.1):
 * each item yielded by `run.messages` is a `ChatModelStreamHandle`
 * (`@langchain/langgraph` → `@langchain/core/language_models/stream`
 * `ChatModelStream`), which exposes a `.reasoning` projection alongside
 * `.text` — an AsyncIterable of incremental reasoning deltas. The chain
 * is: Anthropic SSE `thinking_delta` → `@langchain/anthropic` emits an
 * `AIMessageChunk` with a `{ type: 'thinking' }` content block →
 * `@langchain/core` compat converts it to a `reasoning-delta` stream
 * event → `msg.reasoning` yields the delta string. So no raw-event
 * fallback or custom `handleLLMNewToken` callback is needed. (For the
 * record: the underlying standard LangChain `streamEvents(input,
 * { version: 'v2' })` is also still callable — deepagents' `streamEvents`
 * type is an intersection with `ReactAgent['streamEvents']`, so the v3
 * wrapper does not shadow the v2 surface — but the v3 `.reasoning`
 * projection is the cleaner mechanism.) Reasoning only flows when the
 * model is built with thinking enabled (`VOCION_THINKING_BUDGET`, see
 * `libs/llm/langchain.ts`); otherwise `msg.reasoning` simply completes
 * without yielding.
 * @param opts
 * @param opts.orgId
 * @param opts.agentSlug
 * @param opts.message
 * @param opts.userId
 * @param opts.allowedSourceSlugs
 * @param opts.missionSlug
 * @param opts.conversationHistory
 * @param opts.onEvent
 */

export async function runAgentDeep(opts: {
  orgId: string;
  agentSlug: string;
  message: string;
  userId?: string;
  /** Per-user connection ACL — restricts retrieval to these source slugs. */
  allowedSourceSlugs?: string[];
  /** Set for mission runs — lets mission-scoped tools (update_mission_notes) resolve their mission. */
  missionSlug?: string;
  /** Persisted conversation id — keys the AgentCore Memory session on the runtime provider (Phase 5, opt-in). */
  conversationId?: number;
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
  const { bindRequestEmit, buildInitialFiles, getCompiledAgent } = await import('./agents/harness');
  const { createLangfuseCallback } = await import('@/libs/Langfuse');
  const { chargeUsage, preflightCheck } = await import('./BudgetService');

  const rawEmit = opts.onEvent ?? (() => {});
  // When a DELEGATE's search surfaces sources, tag those documents with the
  // specialist's name so the Sources drawer can show "via <specialist>".
  // `activeSpecialist` is set while a subagent's search tool is executing (the
  // window in which it emits its `documents` event via ctx.emit).
  let activeSpecialist: string | null = null;
  const emittedCards: string[] = [];
  const emit = (event: import('./agents/types').AgentEvent): void => {
    if (event.type === 'documents' && activeSpecialist) {
      for (const d of event.documents) {
        if (!d.foundBy) {
          d.foundBy = activeSpecialist;
        }
      }
    }
    if (event.type === 'recommended_action') {
      emittedCards.push(event.recommendation.label);
    }
    rawEmit(event);
  };

  // Phase 7 — pre-flight budget check. Refuse the run if the agent
  // is over its hard cap; otherwise proceed.
  const budgetCheck = await preflightCheck({ orgId: opts.orgId, agentSlug: opts.agentSlug });
  if (!budgetCheck.ok) {
    const message = `Budget exceeded for agent "${opts.agentSlug}" (${budgetCheck.reason}: ${budgetCheck.current}/${budgetCheck.limit}). Raise the cap on /dashboard/agents/${opts.agentSlug} or wait for the next period.`;
    emit({ type: 'error', message });
    throw new Error(message);
  }

  // Harness provider dispatch — three execution layers, one contract:
  //   - `runtime`  (BYOA): the standalone agent-runtime artifact
  //     (localhost in dev, AgentCore Runtime when deployed). Also
  //     selectable fleet-wide via VOCION_AGENT_PROVIDER=runtime.
  //     VOCION_DISABLE_RUNTIME=1 forces the in-process loop instead —
  //     for dev machines where the artifact isn't running on :8080.
  //   - `agentcore` (managed harness): AWS runs the loop, tools call
  //     back inline. VOCION_DISABLE_AGENTCORE=1 forces the local loop —
  //     for dev machines with no AWS credentials / no provisioned
  //     harness, where an agentcore-pinned agent would otherwise be
  //     unchattable ("Tool error").
  //   - anything else: the in-process deepagents loop below.
  const [agentRow] = await db
    .select({ harnessConfig: agentSchema.harnessConfig })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, opts.orgId), eq(agentSchema.slug, opts.agentSlug)));
  const provider = process.env.VOCION_AGENT_PROVIDER ?? agentRow?.harnessConfig?.provider;
  if (provider === 'runtime' && process.env.VOCION_DISABLE_RUNTIME !== '1') {
    const { runAgentOnRuntime } = await import('./agents/providers/runtime');
    return runAgentOnRuntime(opts);
  }
  if (provider === 'agentcore' && process.env.VOCION_DISABLE_AGENTCORE !== '1') {
    const { runAgentOnAgentCoreHarness } = await import('./agents/providers/agentcore');
    return runAgentOnAgentCoreHarness(opts);
  }

  const compiled = await getCompiledAgent(opts.orgId, opts.agentSlug);
  bindRequestEmit(compiled, emit, opts.userId, opts.allowedSourceSlugs, opts.missionSlug);

  const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; output: string }> = [];
  // Full (untruncated) tool outputs — the sanitizer needs the whole thing to
  // strip a verbatim echo (toolCallLog truncates for the event/audit surface).
  const rawToolOutputs: string[] = [];

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

  // The agent's system prompt is supplied to the graph via createDeepAgent's
  // `systemPrompt` (see runtime.ts). It must NOT also appear here — deepagents
  // prepends its own system message, so a second one is rejected by the model.
  const input = {
    messages: [
      ...history,
      { role: 'user', content: opts.message },
    ],
    files: initialFiles,
  };

  let finalText = '';

  // Typed hierarchical trace: consume the RAW LangChain `streamEvents(v2)`
  // stream (not the flat deepagents v3 projection) so a specialist's own
  // reasoning, tools, and citations are attributable and nested. The
  // `TraceEmitter` maps each raw event to typed `trace_node`s; here we also
  // derive the answer text (LEAD assistant text only — a subagent's text
  // stays in its nested reason node and never leaks into the reply) and the
  // tool outputs the post-run sanitizer needs.
  const tracer = new TraceEmitter({ leadName: compiled.agentRow.name ?? compiled.agentRow.slug ?? 'Assistant' });
  const PLUMBING = new Set(['write_todos', 'ls', 'glob', 'grep', 'read_file', 'edit_file', 'write_file']);

  const nsFor = (ev: RawStreamEvent): string => {
    const cp = ev.metadata?.checkpoint_ns;
    if (typeof cp === 'string') {
      return cp;
    }
    if (Array.isArray(cp)) {
      return cp.join('|');
    }
    return String(ev.metadata?.langgraph_node ?? '');
  };

  // True streaming: the LEAD's answer streams live token-by-token via the
  // AnswerStreamer, which strips a leading <scratch>…</scratch> block (routed
  // to chain-of-thought) so raw data never dumps into the answer. No post-run
  // buffering.
  const answerStreamer = new AnswerStreamer();
  let answering = false;

  try {
    const stream = await compiled.graph.streamEvents(input as never, {
      version: 'v2',
      callbacks: [langfuseHandler],
    } as never);

    for await (const evUnknown of stream as AsyncIterable<RawStreamEvent>) {
      const ev = evUnknown;

      // 1) Typed trace nodes for the UI (reason/tool/skill/search/delegate + citations).
      const nodes = tracer.handle(ev);
      for (const node of nodes) {
        emit(node);
      }
      // Track a delegate's active search so its emitted documents get attributed.
      if (ev.event === 'on_tool_start') {
        const specialistSearch = nodes.find(n => n.kind === 'search' && n.actor.kind === 'specialist');
        if (specialistSearch) {
          activeSpecialist = specialistSearch.actor.name;
        }
      } else if (ev.event === 'on_tool_end' && (ev.name === 'search_knowledge' || ev.name === 'web_search')) {
        activeSpecialist = null;
      }

      // 2) Derive the answer + backward-compatible events from the same stream.
      const isLead = !nsFor(ev).includes('|');
      switch (ev.event) {
        case 'on_chat_model_stream': {
          const { text, thinking } = extractChunk(ev.data?.chunk);
          if (isLead && thinking) {
            emit({ type: 'thinking_delta', delta: thinking });
          }
          if (isLead && text) {
            const { answer, thinking: scratch } = answerStreamer.push(text);
            if (scratch) {
              emit({ type: 'thinking_delta', delta: scratch });
            }
            if (answer) {
              if (!answering) {
                answering = true;
                emit({ type: 'answering' });
                // Reasoning is over once the answer begins — close open reason
                // nodes so they stop spinning "Thinking" during the tail.
                for (const node of tracer.closeReasoning()) {
                  emit(node);
                }
              }
              finalText += answer;
              emit({ type: 'response_delta', delta: answer });
            }
          }
          break;
        }
        case 'on_tool_start': {
          const tool = ev.name ?? 'tool';
          // `task` (delegation) is surfaced as a delegate trace node, not a
          // tool breadcrumb; plumbing tools are noise.
          if (tool !== 'task' && !PLUMBING.has(tool)) {
            emit({ type: 'tool_start', tool, input: parseJsonArgs(ev.data?.input) });
          }
          break;
        }
        case 'on_tool_end': {
          const tool = ev.name ?? 'tool';
          const outputFull = toolOutputContent(ev.data?.output);
          if (outputFull) {
            rawToolOutputs.push(outputFull);
          }
          if (tool !== 'task' && !PLUMBING.has(tool)) {
            const input = parseJsonArgs(ev.data?.input);
            const outputStr = outputFull.slice(0, 2000);
            emit({ type: 'tool_end', tool, input, output: outputStr });
            toolCallLog.push({ tool, input, output: outputStr });
          }
          break;
        }
        default:
          break;
      }
    }

    // Note: per-actor citations ride on the `trace_node` events (so the trace
    // can show "found by <specialist>"); the Sources drawer keeps using the
    // richer `documents` event the search tool emits via ctx.emit.
  } catch (err) {
    const message = (err as Error).message ?? 'agent run failed';
    emit({ type: 'error', message });
    trace.update({ output: { error: message } });
    await langfuse.flushAsync();
    throw err;
  }

  // Release any held-back tail (partial-tag boundary) from the streamer.
  const tail = answerStreamer.flush();
  if (tail.thinking) {
    emit({ type: 'thinking_delta', delta: tail.thinking });
  }
  if (tail.answer) {
    finalText += tail.answer;
    emit({ type: 'response_delta', delta: tail.answer });
  }
  finalText = finalText.trim();

  // Card backstop (structural, workspace-opt-in): prompt compliance for
  // recommend_action proved unreliable — a long tool output (the daily brief)
  // anchors the model into prose mode and cards drop from 3 to 0. When the
  // agent's harness sets recommendActionBackstop and this turn emitted ZERO
  // cards, run one focused pass over the finished answer whose only job is
  // emitting the cards the agent's own rules require. Tool execution emits
  // the recommended_action events through the same request emit.
  // Fires on UNDER-carding too (< 3), not just zero — a single card must not
  // suppress the pass when the answer names several owed touches. The pass
  // sees what's already carded and only tops up the missing ones.
  const backstopOn = (compiled.agentRow.harnessConfig as { recommendActionBackstop?: boolean } | null)?.recommendActionBackstop === true;
  if (backstopOn && emittedCards.length < 3 && finalText.length > 300) {
    try {
      const { recommendActionTool } = await import('./agents/tools/recommendAction');
      const internalCtx = (compiled as unknown as { __ctx: import('./agents/types').RuntimeContext }).__ctx;
      const recTool = recommendActionTool(internalCtx);
      const { buildChatModel } = await import('@/libs/llm');
      const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
      const base = buildChatModel('main', { temperature: 0, streaming: false, maxTokens: 4000 });
      if (!base.bindTools) {
        throw new Error('model does not support tools');
      }
      const model = base.bindTools([recTool]);
      const already = emittedCards.length > 0
        ? `\nAlready carded (do NOT duplicate these): ${emittedCards.map(l => `"${l}"`).join(', ')}.`
        : '';
      const sys = `${compiled.agentRow.systemPrompt ?? ''}\n\nBACKSTOP PASS: the answer below was ALREADY delivered to the user — do not rewrite it. Your ONLY job now: emit the recommend_action tool calls your rules above require for the owed/actionable touches NAMED in that answer (top 3–5 by leverage).${already} Real, ready-to-send bodies. If every named touch is already carded or none are actionable, call nothing. Output tool calls only — no prose.`;
      const res = await model.invoke(
        [new SystemMessage(sys), new HumanMessage(finalText)],
        { signal: AbortSignal.timeout(45_000) },
      );
      for (const call of res.tool_calls ?? []) {
        if (call.name === 'recommend_action') {
          await recTool.invoke(call.args as never);
        }
      }
    } catch {
      /* backstop is best-effort — never fails the turn */
    }
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

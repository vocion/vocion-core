import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { db } from '@/libs/DB';
import { langfuse } from '@/libs/Langfuse';
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
 * Apply recency decay and source weighting to search results.
 * Recency: score * decay^(days_old)
 * Source: score * sourceWeight
 * @param docs
 * @param config
 */
function reRankResults(docs: any[], config: SearchConfig): any[] {
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
      // Smart source filtering: if query mentions calls/meetings/zoom, prioritize Zoom
      if (!sourceFilter) {
        const callKeywords = /\b(call|calls|meeting|meetings|zoom|transcript|recording|discovery|intro)\b/i;
        if (callKeywords.test(query)) {
          sourceFilter = ['zoom'];
        }
      }

      try {
        results = await search({
          query,
          search_filters: sourceFilter
            ? { source_type: sourceFilter }
            : undefined,
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

      // Apply recency decay + source weighting
      const maxResults = searchConfig?.maxResults ?? 15;
      const docs = reRankResults(rawDocs, searchConfig ?? {}).slice(0, maxResults);

      // Log search results AFTER re-ranking
      console.log(`[search_onyx] query="${query}" source=${sourceFilter ?? 'all'} raw=${rawDocs.length} reranked=${docs.length}`);
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
            blurb: (doc.blurb ?? doc.content ?? '').slice(0, 200),
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
      return `[Skill: ${result.skill.name} | Run #${result.runId} | Status: ${result.skill.requiresApproval === 'true' ? 'PENDING APPROVAL' : 'auto'}]\n\n${result.output}`;
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
  type: 'thinking' | 'tool_start' | 'tool_end' | 'answering' | 'response_delta' | 'done' | 'error' | 'documents';
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  delta?: string;
  response?: string;
  traceId?: string;
  toolCalls?: Array<{ tool: string; input: Record<string, unknown> }>;
  documents?: SearchDocument[];
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
  const trace = langfuse.trace({
    name: `agent:${agent.slug}`,
    input: { message: opts.message },
    metadata: { orgId: opts.orgId, model: agent.model, agentId: agent.id },
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
      usage: {
        input: completion.usage?.prompt_tokens,
        output: completion.usage?.completion_tokens,
      },
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

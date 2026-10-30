/**
 * Running the `wiki-evidence` eval (ADR 0012): one question, one condition,
 * one level, against the real model with the Wiki researcher's real prompt,
 * answered from the made-up workspace in `corpus.ts`.
 *
 * Three conditions, everything else held constant:
 * - `search`: `search_knowledge` only, over the documents' passages. No wiki.
 * - `wiki`: the wiki index in context and `read_wiki_page`, plus search.
 * - `graph`: the same, plus the evidence graph: `read_wiki_page` lists the
 *   claims that need a check, and `locate_evidence` / `expand_evidence`
 *   walk typed edges. The graph tools are the live ones (`tools/evidence.ts`).
 *
 * Search is keyword (BM25) over passages, one hit per document, the way the
 * write-up's baseline was; live search is hybrid. The loop is this file's
 * own, as in `agentBehaviour/run.ts`: no database, no workspace.
 */
import type { AIMessageChunk } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { EvidenceQuestion } from './dataset';
import type { EvidenceGraph } from '@/libs/memory/evidence';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildChatModel } from '@/libs/llm';
import { modelIdOf, tokenUsageOf } from '@/libs/llm/usage';
import { citeLine, EVIDENCE_PROMPT_LINE, pageChecks, termsOf } from '@/libs/memory/evidence';
import { tokenCostCents } from '@/libs/pricing';
import { renderDocLine } from '@/services/agents/search';
import { expandEvidenceTool, locateEvidenceTool } from '@/services/agents/tools/evidence';
import { CORPUS_DOCS, CORPUS_WIKI } from './corpus';

export const EVIDENCE_CONDITIONS = ['search', 'wiki', 'graph'] as const;
export type EvidenceCondition = typeof EVIDENCE_CONDITIONS[number];
export const EVIDENCE_LEVELS = ['quick', 'standard'] as const;
export type EvidenceLevel = typeof EVIDENCE_LEVELS[number];

const MAX_STEPS = 10;
const SEARCH_HITS = 5;

export type QuestionRun = {
  questionId: string;
  kind: string;
  condition: EvidenceCondition;
  level: EvidenceLevel;
  rep: number;
  answer: string;
  calls: Array<{ tool: string; input: Record<string, unknown>; error: boolean }>;
  steps: number;
  cents: number;
  totalMs: number;
  crashed?: string;
};

/* ------------------------------------------------------------------ */
/* The made-up workspace                                               */
/* ------------------------------------------------------------------ */

type Passage = { docId: number; idx: number; title: string; text: string; terms: string[] };

const PASSAGES: Passage[] = CORPUS_DOCS.flatMap(d => d.passages.map((text, idx) => ({ docId: d.id, idx, title: d.title ?? '', text, terms: termsOf(`${d.title} ${text}`) })));

/**
 * Keyword search over the passages (BM25), one hit per document.
 * @param query - The query.
 */
export function corpusSearch(query: string): Passage[] {
  const q = termsOf(query);
  const n = PASSAGES.length;
  const avg = PASSAGES.reduce((s, p) => s + p.terms.length, 0) / n;
  const df = new Map<string, number>();
  for (const p of PASSAGES) {
    for (const t of new Set(p.terms)) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const scored = PASSAGES.map((p) => {
    let s = 0;
    for (const t of q) {
      const tf = p.terms.filter(x => x === t).length;
      if (tf) {
        const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        s += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * p.terms.length / avg));
      }
    }
    return { p, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const seen = new Set<number>();
  return scored.filter(x => (seen.has(x.p.docId) ? false : (seen.add(x.p.docId), true))).slice(0, SEARCH_HITS).map(x => x.p);
}

function wikiIndex(): string {
  return ['# Wiki index', ...CORPUS_WIKI.map(p => `- **${p.title}** (\`${p.slug}\`) — ${p.summary}`), '', `_Read on demand with read_wiki_page: ${CORPUS_WIKI.map(p => p.slug).join(', ')}_`].join('\n');
}

/**
 * The tools a condition hands the model.
 * @param condition - The condition.
 * @param graph - The corpus graph.
 */
export function conditionTools(condition: EvidenceCondition, graph: EvidenceGraph): StructuredToolInterface[] {
  const search = tool(async ({ query }) => {
    const hits = corpusSearch(query);
    if (hits.length === 0) {
      return 'No results found for this query.';
    }
    return hits.map((h, i) => `${renderDocLine({ document_id: String(h.docId), semantic_identifier: h.title, source_type: 'drive', blurb: h.text }, i)}\n${citeLine(h.docId, h.idx)}`).join('\n\n');
  }, {
    name: 'search_knowledge',
    description: 'Search all ingested knowledge — docs, calls, files, and other connected sources. Use natural language queries.',
    schema: z.object({ query: z.string().describe('What to search for') }),
  });
  if (condition === 'search') {
    return [search as unknown as StructuredToolInterface];
  }
  const readPage = tool(async ({ slug }) => {
    const page = CORPUS_WIKI.find(p => p.slug === slug.toLowerCase().replace(/\.md$/, '').replace(/^\/?wiki\//, ''));
    if (!page) {
      return `No wiki page "${slug}". Pages: ${CORPUS_WIKI.map(p => p.slug).join(', ')}.`;
    }
    const body = `# ${page.title}\n\n${page.md}`;
    if (condition !== 'graph') {
      return body;
    }
    const checks = await pageChecks(graph, page.slug);
    return checks ? `${body}\n\n${checks}` : body;
  }, {
    name: 'read_wiki_page',
    description: 'Read one wiki page in full by slug (or title). Cite it when a standing fact you state came from it.',
    schema: z.object({ slug: z.string().min(1).describe('The page slug, e.g. "travel".') }),
  });
  const tools = [search, readPage] as unknown as StructuredToolInterface[];
  if (condition === 'graph') {
    tools.push(locateEvidenceTool(async () => graph) as unknown as StructuredToolInterface, expandEvidenceTool(async () => graph) as unknown as StructuredToolInterface);
  }
  return tools;
}

let researcherPrompt: string | null = null;

/**
 * The system prompt for a condition: the Wiki researcher's own, then what the harness adds.
 * @param condition - The condition.
 */
export function conditionPrompt(condition: EvidenceCondition): string {
  researcherPrompt ??= readFileSync(path.join(process.cwd(), 'templates/plugins/wiki/agents/wiki-researcher.system-prompt.md'), 'utf8');
  const lines = [researcherPrompt.trim(), '', 'You are answering a colleague in chat. Answer in a few sentences, and cite the sources you used with their [src:…] tokens.'];
  if (condition === 'search') {
    lines.push('', 'WIKI: this workspace has no wiki pages yet.');
  } else {
    lines.push('', 'WIKI: the workspace wiki is mounted at /wiki/index.md; read_wiki_page fetches a page. Read the relevant page before acting on a standing fact and cite it.', '', '/wiki/index.md:', wikiIndex());
  }
  if (condition === 'graph') {
    lines.push('', EVIDENCE_PROMPT_LINE);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

type StreamingModel = { bindTools: (tools: unknown[]) => { stream: (messages: unknown[]) => Promise<AsyncIterable<AIMessageChunk>> } };

function textOf(message: AIMessageChunk): string {
  const c = message.content;
  return typeof c === 'string' ? c : (c as Array<{ type?: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
}

/**
 * Run one question and say what happened. Never throws.
 * @param opts - The question, condition, level and rep, and a model to use instead (tests).
 * @param opts.question - The question.
 * @param opts.condition - The condition.
 * @param opts.level - Quick or Standard.
 * @param opts.rep - Which repetition.
 * @param opts.graph - The corpus graph, built once per run.
 * @param opts.model - A scripted model (tests).
 */
export async function runQuestion(opts: { question: EvidenceQuestion; condition: EvidenceCondition; level: EvidenceLevel; rep: number; graph: EvidenceGraph; model?: StreamingModel }): Promise<QuestionRun> {
  const { question, condition, level, rep, graph } = opts;
  const tools = conditionTools(condition, graph);
  const byName = new Map(tools.map(t => [t.name, t]));
  const model = opts.model ?? buildChatModel(level === 'quick' ? 'classifier' : 'main', { provider: 'anthropic', ...(level === 'quick' ? { thinking: 'off' as const } : {}) });
  const bound = (model as unknown as StreamingModel).bindTools(tools);
  const messages: unknown[] = [new SystemMessage(conditionPrompt(condition)), new HumanMessage(question.question)];
  const calls: QuestionRun['calls'] = [];
  const started = Date.now();
  let cents = 0;
  let answer = '';
  let steps = 0;
  const base = { questionId: question.id, kind: question.kind, condition, level, rep };
  try {
    for (; steps < MAX_STEPS; steps++) {
      let message: AIMessageChunk | undefined;
      for await (const chunk of await bound.stream(messages)) {
        message = message ? message.concat(chunk) : chunk;
      }
      if (!message) {
        break;
      }
      const usage = tokenUsageOf(message);
      if (usage) {
        cents += tokenCostCents(modelIdOf(message) ?? String((model as { model?: string }).model ?? ''), usage);
      }
      messages.push(message);
      const text = textOf(message);
      if (text.trim()) {
        answer = text;
      }
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        break;
      }
      for (const call of toolCalls) {
        const input = (call.args ?? {}) as Record<string, unknown>;
        const t = byName.get(call.name);
        try {
          if (!t) {
            throw new Error(`${call.name} is not a valid tool`);
          }
          const out = await t.invoke(input);
          calls.push({ tool: call.name, input, error: false });
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', name: call.name, content: typeof out === 'string' ? out : JSON.stringify(out) }));
        } catch (error) {
          calls.push({ tool: call.name, input, error: true });
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', name: call.name, status: 'error', content: `Error: ${(error as Error).message}` }));
        }
      }
    }
    return { ...base, answer, calls, steps: steps + 1, cents, totalMs: Date.now() - started };
  } catch (error) {
    return { ...base, answer, calls, steps: steps + 1, cents, totalMs: Date.now() - started, crashed: (error as Error).message.slice(0, 300) };
  }
}

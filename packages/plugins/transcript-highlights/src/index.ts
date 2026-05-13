import type { PluginManifest } from '@vocion/sdk';
import { defineSkill } from '@vocion/sdk';
import { z } from 'zod';

/**
 * Sample plugin skill — `transcript_highlights`.
 *
 * Demonstrates everything a plugin can do that a prompt-only skill can't:
 *   - Pre-processing (chunk long transcripts so we stay under the model limit)
 *   - Multiple conditional LLM calls (summary pass + highlights pass)
 *   - Post-processing (dedupe, rank, clip)
 *   - Structured typed output (not just free-form text)
 *   - Rich structured logging via ctx.log
 *
 * Dual-purpose: also serves as the reference example for the plugin authoring
 * guide in docs/plugins.md.
 */

const Input = z.object({
  transcript: z.string().min(1).describe('full call transcript'),
  focus: z.enum(['budget', 'timeline', 'objections', 'technical']).optional().describe('optional theme to bias the highlights'),
  max_highlights: z.number().int().positive().max(20).default(5),
});

const Output = z.object({
  highlights: z.array(z.object({
    theme: z.string(),
    quote: z.string(),
    speaker: z.string().optional(),
    importance: z.enum(['critical', 'high', 'normal']),
  })),
  token_stats: z.object({
    transcript_chars: z.number(),
    chunks: z.number(),
    llm_calls: z.number(),
  }),
});

const transcriptHighlights = defineSkill({
  slug: 'transcript_highlights',
  name: 'Transcript Highlights',
  description: 'Extract structured highlights from a long transcript, optionally biased by theme. Chunks long inputs, makes a pass per chunk, then ranks and dedupes.',
  version: '0.1.0',
  category: 'query',
  provider: 'openai', // swap to `anthropic` with one-line change — skill code is unchanged
  requiresApproval: false,
  inputSchema: Input,
  outputSchema: Output,
  async run(ctx, input) {
    const CHUNK_SIZE = 6000;
    const chars = input.transcript.length;
    const chunks: string[] = [];
    for (let i = 0; i < chars; i += CHUNK_SIZE) {
      chunks.push(input.transcript.slice(i, i + CHUNK_SIZE));
    }

    ctx.log('info', 'chunked transcript', { chars, chunks: chunks.length });

    const allHighlights: Array<{ theme: string; quote: string; speaker?: string; importance: 'critical' | 'high' | 'normal' }> = [];

    const focusLine = input.focus ? `\nPrioritize highlights about: ${input.focus}.` : '';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const prompt = `Extract up to ${input.max_highlights} highlights from this transcript chunk (${i + 1}/${chunks.length}).${focusLine}

Respond as minified JSON:
{"highlights":[{"theme":"...","quote":"...","speaker":"...","importance":"critical|high|normal"}]}

Transcript chunk:
${chunk}`;

      const completion = await ctx.llm.generate({
        model: 'gpt-5.4-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1200,
        responseFormat: 'json_object',
      });

      const raw = completion.content || '{"highlights":[]}';
      try {
        const parsed = JSON.parse(raw) as { highlights?: Array<{ theme: string; quote: string; speaker?: string; importance: 'critical' | 'high' | 'normal' }> };
        if (Array.isArray(parsed.highlights)) {
          allHighlights.push(...parsed.highlights);
        }
      } catch (err) {
        ctx.log('warn', 'failed to parse chunk output', { chunk: i, error: String(err) });
      }
    }

    // Dedupe by quote text, then rank by importance, then clip.
    const seen = new Set<string>();
    const deduped = allHighlights.filter((h) => {
      if (seen.has(h.quote)) {
        return false;
      }
      seen.add(h.quote);
      return true;
    });

    const importanceRank: Record<string, number> = { critical: 0, high: 1, normal: 2 };
    deduped.sort((a, b) => (importanceRank[a.importance] ?? 3) - (importanceRank[b.importance] ?? 3));

    return {
      highlights: deduped.slice(0, input.max_highlights),
      token_stats: {
        transcript_chars: chars,
        chunks: chunks.length,
        llm_calls: chunks.length,
      },
    };
  },
});

export const manifest: PluginManifest = {
  id: 'vocion.samples',
  version: '0.1.0',
  description: 'Reference plugin shipped with Vocion — the transcript_highlights skill.',
  skills: [transcriptHighlights],
};

export default manifest;

/**
 * SPIKE — Phase 0 verification script for deepagents + ChatAnthropic.
 *
 * NOT a production entry point. Branch-scoped; remove (or fold into a
 * real unit test) after Phase 4 lands.
 *
 * Validates the unknowns the ADR (docs/internal/adr/0001) calls out:
 *   1. `createDeepAgent` constructs an agent with a tool + subagent.
 *   2. `agent.streamEvents(..., { version: 'v3' })` returns a
 *      DeepAgentRunStream with projection-based AsyncIterables for
 *      `messages`, `toolCalls`, and `subagents`.
 *   3. Per-token deltas arrive on ChatAnthropic Sonnet 4.7 (1M).
 *   4. Subagent dispatch surfaces as a `subagents` projection item.
 *
 * Run from the repo root:
 *   ANTHROPIC_API_KEY=... npx tsx \
 *     packages/core/src/scripts/spike-deepagent.ts
 */

import type { SubAgent } from 'deepagents';
import process from 'node:process';
import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { createDeepAgent, StateBackend } from 'deepagents';
import { z } from 'zod';

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — cannot run spike.');
    process.exit(1);
  }

  // 1. Model under test: Sonnet 4.6, the latest Sonnet (Claude 4.x).
  //    Matches rev-ai's default in /var/www/metacto/spinutech/kickoff-demo/server/llm.py.
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    temperature: 0,
    streaming: true,
  });

  // 2. One trivial tool. Confirms Zod tool schemas work end-to-end.
  const echoTool = tool(
    async ({ message }) => `echoed: ${message}`,
    {
      name: 'echo',
      description: 'Echo a message back, prefixed with "echoed: ".',
      schema: z.object({
        message: z.string().describe('the message to echo'),
      }),
    },
  );

  // 3. One subagent. Confirms `task("...")` dispatch surfaces in the
  //    `run.subagents` projection.
  const summarizer: SubAgent = {
    name: 'summarizer',
    description: 'Summarizes a chunk of text into one short sentence.',
    systemPrompt:
      'You receive text and return a one-sentence summary. Be terse.',
  };

  // 4. Build the agent.
  const agent = createDeepAgent({
    model,
    tools: [echoTool],
    subagents: [summarizer],
    backend: new StateBackend(),
  });

  // 5. Stream events via the v3 projection-based API.
  const input = {
    messages: [
      {
        role: 'user',
        content:
          'Call the echo tool with the message "hello deepagents", then dispatch the summarizer subagent to summarize this meeting note: "Discovery call with ACME Co. about scoping a Phase 1 ECE engagement; budget around $120k; timeline 4-6 weeks; key stakeholder is VP Marketing." Return both results.',
      },
    ],
  };

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let tokenCount = 0;
  const toolCallNames: string[] = [];
  const subagentNames: string[] = [];

  const run = await agent.streamEvents(input, { version: 'v3' });

  // 5a. Watch all three projections in parallel. AsyncIterables, so
  //     this is the JS-idiomatic equivalent of rev-ai's
  //     "multiplex events into one queue + flush whichever fires".
  await Promise.all([
    (async () => {
      for await (const msg of run.messages) {
        // Each msg has .text (AsyncIterable<string>) and .reasoning.
        for await (const token of msg.text) {
          if (firstTokenAt === null) {
            firstTokenAt = Date.now() - startedAt;
            console.log(`[spike] first token at ${firstTokenAt}ms`);
          }
          tokenCount += 1;
          process.stdout.write(token);
        }
        process.stdout.write('\n');
      }
    })(),
    (async () => {
      for await (const call of run.toolCalls) {
        const name = (call as { name?: string }).name ?? '?';
        toolCallNames.push(name);
        console.log(`[spike] tool call: ${name}`);
        try {
          const output = await (call as { output: Promise<unknown> }).output;
          console.log(`[spike] tool ${name} output:`, JSON.stringify(output).slice(0, 200));
        } catch (e) {
          console.log(`[spike] tool ${name} error:`, e);
        }
      }
    })(),
    (async () => {
      for await (const sub of run.subagents) {
        const name = (sub as { name?: string }).name ?? '?';
        subagentNames.push(name);
        console.log(`[spike] subagent dispatched: ${name}`);
      }
    })(),
  ]);

  const finalState = await run.output;
  console.log('\n[spike] final output keys:', Object.keys(finalState ?? {}));

  // 6. Report.
  console.log('\n[spike] summary:');
  console.log(`  first token at:  ${firstTokenAt}ms`);
  console.log(`  total tokens:    ${tokenCount}`);
  console.log(`  tool calls:      ${toolCallNames.join(', ') || '(none)'}`);
  console.log(`  subagents:       ${subagentNames.join(', ') || '(none)'}`);

  // 7. Sanity checks. Failures here block Phase 4.
  if (tokenCount < 5) {
    console.warn('[spike] WARNING: very few tokens streamed. ChatAnthropic may be batching.');
  }
  if (!toolCallNames.includes('echo')) {
    console.warn('[spike] WARNING: echo tool was not called. Tool wiring or prompt issue.');
  }
  if (!subagentNames.includes('summarizer')) {
    console.warn('[spike] WARNING: summarizer subagent was not dispatched. Subagent wiring issue.');
  }
}

main().catch((err) => {
  console.error('[spike] failed:', err);
  process.exit(1);
});

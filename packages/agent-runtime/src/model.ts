/**
 * Chat-model builder for the runtime artifact.
 *
 * Two providers, selected by environment:
 *   - `anthropic` (default when ANTHROPIC_API_KEY is set) — direct API,
 *     the laptop/dev path; matches core's current behavior.
 *   - `bedrock` — ChatBedrockConverse, the deployed path on AgentCore
 *     (credentials come from the runtime execution role; no keys).
 *
 * VOCION_MODEL_PROVIDER forces one explicitly. Model ids are
 * provider-shaped, so each provider has its own default and the agent
 * definition's `model` is passed through as-is when set.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import process from 'node:process';

const ANTHROPIC_DEFAULT = 'claude-sonnet-4-6';
const BEDROCK_DEFAULT = 'us.anthropic.claude-sonnet-4-6';

export type ModelProvider = 'anthropic' | 'bedrock';

export function resolveProvider(): ModelProvider {
  const forced = (process.env.VOCION_MODEL_PROVIDER ?? '').toLowerCase();
  if (forced === 'anthropic' || forced === 'bedrock') {
    return forced;
  }
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'bedrock';
}

export async function buildChatModel(opts: {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<BaseChatModel> {
  const provider = resolveProvider();

  if (provider === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({
      model: opts.model ?? process.env.VOCION_LLM_MODEL_MAIN ?? ANTHROPIC_DEFAULT,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens ?? 8192,
    });
  }

  const { ChatBedrockConverse } = await import('@langchain/aws');
  return new ChatBedrockConverse({
    model: opts.model ?? process.env.VOCION_LLM_MODEL_MAIN ?? BEDROCK_DEFAULT,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens ?? 8192,
    region: process.env.AWS_REGION ?? 'us-west-2',
  });
}

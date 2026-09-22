/**
 * Chat-model builder for the runtime artifact.
 *
 * Two providers, selected by environment:
 *   - `anthropic` (default when ANTHROPIC_API_KEY is set) — direct API,
 *     the laptop/dev path; matches core's current behavior.
 *   - `bedrock` — ChatBedrockConverse, the deployed path on AgentCore.
 *     Credentials come from the invocation when core sent a session
 *     minted from the org's own AWS key, so spend lands on the
 *     customer's account; otherwise from this process's own chain (the
 *     execution role, or `AWS_BEARER_TOKEN_BEDROCK`), which is the
 *     platform's account.
 *
 * VOCION_MODEL_PROVIDER forces one explicitly. Model ids are
 * provider-shaped, so each provider has its own default and the agent
 * definition's `model` is passed through as-is when set.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { InvocationRequest } from './contract.js';

import process from 'node:process';
import { promptCacheAllowed } from './promptCache.js';

/**
 * The credential shape AWS SDK clients accept, declared structurally rather
 * than imported from `@aws-sdk/types` — that package is a transitive
 * dependency here, not a declared one, and this artifact is bundled on its own.
 */
type AwsCredentialIdentity = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
};

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

/**
 * Adapt the invocation's AWS session into the credential provider the Bedrock
 * client wants, or undefined to leave the client on its own chain.
 *
 * A **function** rather than a plain credential object, because the model is
 * built once per agent definition and then cached across invocations, while the
 * session it signs with is per invocation. Reading through a getter on every
 * call means the cached client always signs with the credential of the request
 * being served, and never keeps the previous one — the caching mistake that
 * would let one tenant spend another tenant's AWS account.
 * @param readSession - Returns the current invocation's AWS session, if any.
 */
export function bedrockCredentialProvider(
  readSession: () => InvocationRequest['aws'],
): (() => Promise<AwsCredentialIdentity>) | undefined {
  if (!readSession()) {
    return undefined;
  }
  return async () => {
    const session = readSession();
    if (!session) {
      throw new Error('the Bedrock client asked for a credential after the invocation session was cleared');
    }
    return {
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      sessionToken: session.sessionToken,
      ...(session.expiresAt ? { expiration: new Date(session.expiresAt) } : {}),
    };
  };
}

/**
 * Whether this Anthropic model REFUSES sampling parameters. Claude 4.7, 4.8
 * and the whole 5 family answer `temperature` with a 400 ("`temperature` is
 * deprecated for this model"); 4.6 deprecated but still honours it. Mirror of
 * core's `anthropicOmitsSampling` (libs/llm/langchain.ts) — the artifact
 * cannot import core modules. Bedrock ids decorate the model name, so the
 * match is a substring.
 * @param model - Model id, vendor or Bedrock spelling.
 */
export function anthropicOmitsSampling(model: string): boolean {
  return /claude-(?:opus-4-[78]|sonnet-5|opus-5|fable-5|mythos-5)/.test(model);
}

export async function buildChatModel(opts: {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Ask the vendor to cache the prompt prefix on every call. On unless the
   * caller says otherwise or `VOCION_PROMPT_CACHE=0` is set — see
   * `./promptCache.ts` for what that saves and what silently will not cache.
   */
  promptCache?: boolean;
  /**
   * Reads the AWS session of the invocation currently being served. Called on
   * every model request, not once at construction — see
   * `bedrockCredentialProvider`.
   */
  readAwsSession?: () => InvocationRequest['aws'];
}): Promise<BaseChatModel> {
  const provider = resolveProvider();
  // The cache instruction is a per-call option neither integration takes at
  // construction, so the class carrying it is chosen here.
  const caching = (opts.promptCache ?? true) && promptCacheAllowed();

  if (provider === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    const { CachingChatAnthropic } = await import('./promptCache.js');
    const Anthropic = caching ? CachingChatAnthropic : ChatAnthropic;
    const model = opts.model ?? process.env.VOCION_LLM_MODEL_MAIN ?? ANTHROPIC_DEFAULT;
    return new Anthropic({
      model,
      ...(anthropicOmitsSampling(model) || opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      maxTokens: opts.maxTokens ?? 8192,
    });
  }

  const { ChatBedrockConverse } = await import('@langchain/aws');
  const { CachingChatBedrockConverse } = await import('./promptCache.js');
  const Bedrock = caching ? CachingChatBedrockConverse : ChatBedrockConverse;
  const credentials = opts.readAwsSession
    ? bedrockCredentialProvider(opts.readAwsSession)
    : undefined;
  const model = opts.model ?? process.env.VOCION_LLM_MODEL_MAIN ?? BEDROCK_DEFAULT;
  return new Bedrock({
    model,
    // Same models, second transport: Bedrock refuses the same parameters.
    ...(anthropicOmitsSampling(model) || opts.temperature === undefined ? {} : { temperature: opts.temperature }),
    maxTokens: opts.maxTokens ?? 8192,
    region: process.env.AWS_REGION ?? 'us-west-2',
    ...(credentials ? { credentials } : {}),
  });
}

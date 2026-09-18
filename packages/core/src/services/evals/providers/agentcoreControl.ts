/**
 * The one AgentCore control-plane client, and the one way we make a client
 * token.
 *
 * Two modules write resources into the customer's AWS account — evaluators and
 * datasets — and both need the same two things. Kept here so there is a single
 * answer to "which region, whose credentials" and a single definition of a
 * client token, rather than two literals that drift the first time one of them
 * gains a setting.
 */

import type { AwsCredentials } from '@/services/ApiTokenService';
import { createHash } from 'node:crypto';
import { BedrockAgentCoreControlClient } from '@aws-sdk/client-bedrock-agentcore-control';

/**
 * A control-plane client for one org's account.
 * @param credentials - The org's AWS credentials.
 * @param region - Where to talk to AWS.
 */
export function controlClient(credentials: AwsCredentials, region: string): BedrockAgentCoreControlClient {
  return new BedrockAgentCoreControlClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

/**
 * A token AWS uses to recognise a repeat of the same request.
 *
 * Deterministic on purpose, and derived from the content of the one call it
 * belongs to rather than from the whole operation: a create whose response we
 * never saw is retried with the same token and AWS hands back what it already
 * made, while the next call in the sequence — a different payload — gets a
 * different token and is not mistaken for that retry.
 * @param parts - Everything that identifies this particular request.
 */
export function clientTokenFor(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

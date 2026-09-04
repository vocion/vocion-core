/**
 * Resolving "which AWS identity should this Bedrock call use" for a given org.
 *
 * Bedrock is the one model provider whose credential is not a single pasted
 * string, so it cannot go through `./orgKey`. It has two ways in:
 *
 *   1. **The org's own AWS access key pair**, stored under the `aws` platform
 *      at /dashboard/api-tokens and encrypted under that org's DEK. When it is
 *      there, we sign with it and the model spend lands on the customer's own
 *      AWS bill. This is the path the product is built around.
 *   2. **The process's own AWS identity**, when the org has stored nothing.
 *      We hand the AWS SDK no explicit credentials and let its own chain
 *      answer — which picks up `AWS_BEARER_TOKEN_BEDROCK` (a Bedrock API key),
 *      then `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, then the instance
 *      role. Deliberately a fallback, never the first choice.
 *
 * **Why the fallback is allowed here, when `resolveAwsCredentials` refuses it
 * by default.** That helper's doc explains the rule: the server's AWS identity
 * is the platform account — it holds the KMS key that wraps every tenant's DEK,
 * the AgentCore runtime, the deployment role — so a tenant-scoped operation
 * silently running as the platform is a privilege escalation, not a billing
 * surprise. Bedrock inference is the narrow exception, and it is narrow for a
 * reason: `InvokeModel` on a foundation model reads and writes no Vocion
 * resource. The blast radius of running it as the platform is that we pay for
 * the tokens. That is the same exposure OpenAI and Anthropic already have when
 * an org has supplied no key, so Bedrock is held to the same bar rather than a
 * stricter one. Nothing else about AWS gets this treatment: anything that
 * touches KMS, AgentCore or a deploy role still goes through
 * `resolveAwsCredentials` with the fallback off.
 */

import type { GetSessionTokenCommandOutput } from '@aws-sdk/client-sts';
import type { AwsCredentials } from '@/services/ApiTokenService';
import process from 'node:process';
import { resolveAwsCredentials } from '@/services/ApiTokenService';

/**
 * Where the credentials for a Bedrock call came from.
 *
 * Worth returning rather than inferring: it is what lets a call site log which
 * account is about to be billed, and what a test asserts on to prove one org's
 * key did not leak into another org's call.
 */
export type BedrockCredentialSource = 'org' | 'environment';

export type BedrockCredentials = {
  source: BedrockCredentialSource;
  /**
   * The key pair to sign with, or null to let the AWS SDK's own credential
   * chain resolve one.
   *
   * Null is not "no credentials" — it is "we are not overriding the SDK", which
   * is the only way a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK` or an
   * instance role can be used at all. Neither can be expressed as a key pair,
   * so passing an empty pair instead would break both.
   */
  keyPair: AwsCredentials | null;
};

/**
 * The AWS region Bedrock is called in.
 *
 * Matches `packages/agent-runtime/src/model.ts`, which defaults to the same
 * region, so a model id that resolves in one path resolves in the other. Note
 * that the Claude models we default to are only offered as cross-region
 * inference profiles (`us.anthropic.…`), which route out of the source region
 * on their own — the region here selects the entry point, not where inference
 * physically runs.
 */
export function bedrockRegion(): string {
  return process.env.AWS_REGION ?? 'us-west-2';
}

/**
 * The AWS identity a Bedrock call for `orgId` should use.
 *
 * Never throws and never returns "nothing available": when the org has stored
 * no pair the answer is `{ source: 'environment', keyPair: null }`, and it is
 * the AWS SDK — not us — that decides whether the process has a usable
 * identity. Guessing that ourselves would mean either duplicating the whole
 * credential chain or refusing a host that authenticates by instance role.
 *
 * Resolved per call, never cached. A cache keyed on anything less than the
 * exact credential in use is how one tenant ends up spending another tenant's
 * AWS account, and it is what the removal of the LLM client cache was about.
 * @param orgId - The org the model call is being made for.
 */
export async function resolveBedrockCredentials(orgId: string): Promise<BedrockCredentials> {
  const stored = await resolveAwsCredentials(orgId);
  if (stored) {
    return { source: 'org', keyPair: stored };
  }
  return { source: 'environment', keyPair: null };
}

/**
 * How long a runtime session credential stays valid, in seconds.
 *
 * One hour by default. `GetSessionToken` allows anything from 15 minutes to 36
 * hours for an IAM user session, and no agent run comes near either bound — a
 * long run is minutes. The window is therefore chosen for blast radius rather
 * than for headroom: the credential leaves this process and travels in an
 * AgentCore invocation payload, so the shorter it lives, the less a copy of
 * that payload is worth to anyone who finds one.
 */
function runtimeSessionDurationSeconds(): number {
  const configured = Number(process.env.VOCION_BEDROCK_SESSION_SECONDS);
  return Number.isFinite(configured) && configured >= 900 ? configured : 3600;
}

/**
 * A temporary AWS credential for the runtime artifact to sign Bedrock with.
 *
 * Shaped as the AWS SDK expects it, session token included. A temporary access
 * key is not valid on its own — AWS accepts it only alongside the token that
 * proves STS issued it — so all three fields travel together or none do.
 */
export type RuntimeBedrockSession = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO-8601 instant the session stops working, for logging and tests. */
  expiresAt: string;
};

/**
 * A short-lived Bedrock credential for `orgId`, to hand to the runtime artifact.
 *
 * The artifact runs out of process — on AgentCore it runs in another AWS
 * account entirely — with no database access and no KMS grant, so it cannot
 * resolve an org's stored key itself. This function is the bridge: core, which
 * holds both, resolves the org's own AWS pair and mints a session from it. The
 * session travels in the invocation payload and the artifact signs Bedrock with
 * it, so the model spend lands on the customer's account exactly as it does on
 * the in-process path.
 *
 * **Returns null when the org has stored no AWS pair**, which is not an error.
 * Null means "we are not overriding the artifact's own credential chain", and
 * the artifact then falls through to the platform's secrets — its execution
 * role or `AWS_BEARER_TOKEN_BEDROCK` — the same second-choice fallback
 * `resolveBedrockCredentials` allows for the in-process path.
 *
 * **Throws when the org has a pair but STS refuses it.** The tempting
 * alternative — log it and return null — would silently move that customer's
 * model spend onto the platform account and look like success, which is the
 * failure this whole path exists to prevent. A stored credential that cannot
 * mint a session is a misconfiguration the org has to fix, so it surfaces.
 * @param orgId - The org the agent run belongs to.
 */
export async function mintBedrockSessionForRuntime(orgId: string): Promise<RuntimeBedrockSession | null> {
  const stored = await resolveAwsCredentials(orgId);
  if (!stored) {
    return null;
  }

  const { GetSessionTokenCommand, STSClient } = await import('@aws-sdk/client-sts');
  const sts = new STSClient({ region: bedrockRegion(), credentials: stored });

  let issued: GetSessionTokenCommandOutput;
  try {
    issued = await sts.send(new GetSessionTokenCommand({
      DurationSeconds: runtimeSessionDurationSeconds(),
    }));
  } catch (error) {
    console.error(`[bedrock] STS refused a session for org ${orgId}:`, error);
    throw new Error(
      `Could not mint a Bedrock session from the AWS credentials stored for this org. `
      + `Check the access key at /dashboard/api-tokens is active and allowed to call sts:GetSessionToken.`,
    );
  }

  const credentials = issued.Credentials;
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
    throw new Error('STS returned an incomplete session credential for the agent runtime');
  }

  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
    expiresAt: (credentials.Expiration ?? new Date()).toISOString(),
  };
}

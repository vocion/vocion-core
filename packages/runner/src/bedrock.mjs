// The engineer's model credentials. By default the engineer runs on ANTHROPIC_API_KEY and sees no
// AWS credential at all. With CLAUDE_CODE_USE_BEDROCK=1 it runs on Amazon Bedrock through the
// container's own role (the ECS task role on Fargate), so it keeps exactly what the AWS SDK's
// container-credentials provider and Claude Code's Bedrock mode read, and no other AWS variable.

/** Never handed to the engineer: the worker's GitHub and Vocion tokens, and every AWS credential. */
export const STRIPPED_KEYS = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'VOCION_TOKEN',
  'VOCION_RUNNER_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
];

/**
 * The AWS variables the engineer keeps in Bedrock mode. The authorization token goes with the full
 * URI only: that endpoint refuses a call without it, and the relative one (Fargate's) needs none.
 */
export const BEDROCK_AWS_KEYS = [
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
];

/** Whether this runner's engineer calls the model on Bedrock (Claude Code's own switch). */
export function bedrockMode(env) {
  return /^(?:1|true)$/i.test(String(env.CLAUDE_CODE_USE_BEDROCK ?? '').trim());
}

/**
 * The environment the `claude` child starts from, before the run's own variables are added.
 * Default mode: the parent's, less STRIPPED_KEYS. Bedrock mode: the parent's, less those tokens and
 * every AWS_* variable outside BEDROCK_AWS_KEYS (the authorization token only beside a full URI).
 * CLAUDE_CODE_USE_BEDROCK, ANTHROPIC_MODEL and ANTHROPIC_SMALL_FAST_MODEL pass through as set.
 */
export function claudeChildEnv(parentEnv) {
  const childEnv = { ...parentEnv };
  for (const k of STRIPPED_KEYS) {
    delete childEnv[k];
  }
  if (!bedrockMode(parentEnv)) {
    return childEnv;
  }
  for (const k of Object.keys(childEnv)) {
    if (k.startsWith('AWS_')) {
      delete childEnv[k];
    }
  }
  const keep = parentEnv.AWS_CONTAINER_CREDENTIALS_FULL_URI
    ? BEDROCK_AWS_KEYS
    : BEDROCK_AWS_KEYS.filter(k => !k.startsWith('AWS_CONTAINER_AUTHORIZATION_TOKEN'));
  for (const k of keep) {
    if (parentEnv[k] !== undefined) {
      childEnv[k] = parentEnv[k];
    }
  }
  return childEnv;
}

/**
 * The model the engineer runs when the contract names none: DEFAULT_MODEL, else on Bedrock the
 * installation's ANTHROPIC_MODEL (an inference profile id), else Claude Code's `sonnet`.
 */
export function defaultModel(env) {
  return env.DEFAULT_MODEL || (bedrockMode(env) && env.ANTHROPIC_MODEL) || 'sonnet';
}

/**
 * The Bedrock spelling of a model id a contract wrote for Anthropic's API, as agent-runtime's
 * `bedrockModelId` spells it: a bare `claude-` id becomes the region's cross-region inference
 * profile (`claude-sonnet-4-6` in us-east-1 is `us.anthropic.claude-sonnet-4-6`; a dated id takes
 * `-v1:0`). Aliases (`sonnet`, `opus`), profile ids and ARNs pass through. Off Bedrock, unchanged.
 */
export function engineerModel(model, env) {
  if (!bedrockMode(env) || !String(model).startsWith('claude-')) {
    return model;
  }
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1';
  const geo = region.startsWith('eu-') ? 'eu' : region.startsWith('ap-') ? 'apac' : 'us';
  const versioned = /-\d{8}$/.test(model) ? `${model}-v1:0` : model;
  return `${geo}.anthropic.${versioned}`;
}

/** The credential the engineer runs on, or null when it has none: a startup warning, not a stop. */
export function missingModelCredential(env) {
  if (bedrockMode(env)) {
    return env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || env.AWS_CONTAINER_CREDENTIALS_FULL_URI
      ? null
      : 'CLAUDE_CODE_USE_BEDROCK is set but no container credentials (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI / FULL_URI): the engineer has no role to call Bedrock with';
  }
  return env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY is not set';
}

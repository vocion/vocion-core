// The OpenHands engine: the OpenHands Software Agent SDK (MIT; openhands-sdk and openhands-tools,
// pinned in the Dockerfile's open stage) run IN the runner container by openhands_driver.py, one
// process per engineer or repair pass, exactly where claude runs for claude-cli.
//
// WHY IN-CONTAINER AND NOT THE AGENT-SERVER SIDECAR (the plan's first sketch):
//   - The runner already is the sandbox: one task per container, non-root, the checkout in
//     /workspace, credentials stripped from the agent's environment. A sidecar would need the
//     checkout on a shared volume, a localhost port, per-run session keys and a second image to pin,
//     and buys no isolation the container does not already give.
//   - The guard stays the runner's own scripts (hooks/openhands-guard.sh maps OpenHands tool calls
//     onto guard-bash.sh and guard-write.sh), run by OpenHands' PreToolUse hook, exit 2 blocks, the
//     same convention as Claude Code. No HTTP surface, no agent-server, no posthog, no browser tool.
//   - The driver prints Claude Code's stream-json, so runner.mjs reads events, the transcript, the
//     report, cost and usage with the code it already has.
// The agent-server stays the path for a remote workspace (a separate sandbox per run); nothing here
// prevents moving the driver there later.
//
// MODEL. LiteLLM ids. A bare contract model (claude-opus-5-5) becomes anthropic/<model> with
// ANTHROPIC_API_KEY, or bedrock/<OPENHANDS_BEDROCK_PREFIX><model> when OPENHANDS_PROVIDER=bedrock.
// engine.model in the contract wins and is used as written (bedrock/<inference profile id>).
// On Bedrock the driver resolves the task role's credentials once (boto3), hands them to LiteLLM and
// removes them from its environment before any tool starts, so the agent's shell never holds them.
import fs from 'node:fs';
import path from 'node:path';

export const id = 'openhands';

const AWS_CREDENTIAL_ENV = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_AUTHORIZATION_TOKEN'];

export function pythonBin(cfg, env = process.env) {
  return env.OPENHANDS_PYTHON || path.join(cfg.openhandsHome || '/opt/openhands', 'bin', 'python');
}

export function driverPath(cfg) {
  return path.join(cfg.runnerHome, 'src', 'engines', 'openhands_driver.py');
}

/** What the image must carry: the OpenHands virtualenv and the driver (the open image variant). */
export function available(cfg, env = process.env) {
  const py = pythonBin(cfg, env);
  if (!fs.existsSync(py)) {
    return { ok: false, why: `no OpenHands Python at ${py}: this image does not carry the openhands engine (build the Dockerfile's open target)` };
  }
  if (!fs.existsSync(driverPath(cfg))) {
    return { ok: false, why: `no driver at ${driverPath(cfg)}` };
  }
  return { ok: true, why: '' };
}

/** The LiteLLM model id for a pass. */
export function liteLlmModel(task, model, env = process.env) {
  const chosen = task.engine?.model || model;
  if (chosen.includes('/')) {
    return chosen;
  }
  if (env.OPENHANDS_PROVIDER === 'bedrock') {
    return `bedrock/${env.OPENHANDS_BEDROCK_PREFIX || ''}${chosen}`;
  }
  return `anthropic/${chosen}`;
}

/**
 * One pass's process, the same shape as claude-cli's: `{ bin, args, env, keepEnv }`.
 * The standing rules go in a file (the system message suffix), the prompt on stdin.
 */
export function pass({ task, model, budget, opts, cfg, rules, repoDir, logDir, env = process.env }) {
  const llm = liteLlmModel(task, model, env);
  const label = opts.label || 'engineer';
  const suffixFile = path.join(logDir, label === 'engineer' ? 'system-suffix.md' : `system-suffix.${label}.md`);
  fs.writeFileSync(suffixFile, rules);
  const args = [
    driverPath(cfg),
    '--model',
    llm,
    '--budget',
    String(budget),
    '--workdir',
    repoDir,
    '--system-suffix-file',
    suffixFile,
    '--hooks-dir',
    path.join(cfg.runnerHome, 'hooks'),
  ];
  if (opts.resume) {
    args.push('--resume', opts.resume);
  } else {
    args.push('--session-id', opts.sessionId || globalThis.crypto.randomUUID());
  }
  if (task.model_policy.effort) {
    args.push('--effort', String(task.model_policy.effort));
  }
  return {
    bin: pythonBin(cfg, env),
    args,
    env: { OPENHANDS_SUPPRESS_BANNER: '1', PYTHONUNBUFFERED: '1' },
    // Bedrock needs the task role's credentials in the driver; it drops them before any tool runs.
    keepEnv: llm.startsWith('bedrock/') ? AWS_CREDENTIAL_ENV : [],
  };
}

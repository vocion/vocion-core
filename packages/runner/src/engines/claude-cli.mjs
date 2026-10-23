// Today's engine: headless Claude Code, spawned once per engineer or repair pass. The arguments are
// the ones runner.mjs built before the engine seam, unchanged: stream-json out, the run's budget,
// the guard hooks and denials in claude-settings.json, the standing rules appended to the system
// prompt, and a session a repair pass can resume.
import path from 'node:path';

export const id = 'claude-cli';

/** What the image must carry for this engine: the claude binary. */
export function available(cfg) {
  return { ok: Boolean(cfg.claudeBin), why: cfg.claudeBin ? '' : 'CLAUDE_BIN is empty' };
}

/**
 * One pass's process: `{ bin, args, env, keepEnv }`. `env` is added to the runner's child
 * environment; `keepEnv` names credentials the runner would otherwise strip (none here: the agent
 * never sees GitHub, Vocion or AWS credentials, only the Anthropic key).
 * The context is { task, model, budget, opts, cfg, rules }: the contract, the pass's model, its
 * budget in dollars, runClaude's options (resume, sessionId), the worker's config and the standing
 * rules.
 */
export function pass({ task, model, budget, opts, cfg, rules }) {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-budget-usd',
    String(budget),
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    'Read',
    'Edit',
    'Write',
    'MultiEdit',
    'Glob',
    'Grep',
    'Bash',
    'TodoWrite',
    'Task',
    '--disallowedTools',
    'WebSearch',
    'NotebookEdit',
    '--settings',
    path.join(cfg.runnerHome, 'claude-settings.json'),
    '--append-system-prompt',
    rules,
    '--model',
    model,
  ];
  // The session is kept on disk (under ~/.claude, inside the container) so a repair pass can resume it.
  if (opts.resume) {
    args.push('--resume', opts.resume);
  } else if (opts.sessionId) {
    args.push('--session-id', opts.sessionId);
  } else {
    args.push('--no-session-persistence');
  }
  if (task.model_policy.effort) {
    args.push('--effort', String(task.model_policy.effort));
  }
  if (task.model_policy.escalate_to) {
    args.push('--fallback-model', String(task.model_policy.escalate_to));
  }
  return { bin: cfg.claudeBin, args, env: {}, keepEnv: [] };
}

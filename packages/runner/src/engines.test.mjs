import assert from 'node:assert/strict';
// node --test packages/runner/src/engines.test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateContract } from './contract.mjs';
import * as claudeCli from './engines/claude-cli.mjs';
import { DEFAULT_ENGINE, ENGINE_IDS, engineFor, engineId } from './engines/index.mjs';
import * as openhands from './engines/openhands.mjs';
import { messageEvents, usageFromMessages } from './events.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerDir = path.join(here, '..');
const cfg = { runnerHome: '/opt/vocion-runner', claudeBin: 'claude', openhandsHome: '/opt/openhands' };
const task = { task_id: 't1', model_policy: {} };
const example = JSON.parse(fs.readFileSync(path.join(runnerDir, 'contract', 'example-task.json'), 'utf8'));

describe('engine registry', () => {
  it('a contract without engine runs claude-cli, as before the field existed', () => {
    assert.equal(DEFAULT_ENGINE, 'claude-cli');
    assert.equal(engineId({}), 'claude-cli');
    assert.equal(engineFor({}), claudeCli);
    assert.equal(engineFor({ engine: { id: 'openhands' } }), openhands);
    assert.deepEqual(ENGINE_IDS, ['claude-cli', 'openhands']);
    assert.throws(() => engineFor({ engine: { id: 'codex' } }), /unknown engine codex/);
  });

  it('the schema takes an optional engine block and refuses an engine it does not know', () => {
    assert.equal(validateContract(example).ok, true);
    assert.equal(validateContract({ ...example, engine: { id: 'openhands', model: 'anthropic/claude-opus-5-5' } }).ok, true);
    assert.equal(validateContract({ ...example, engine: { id: 'codex' } }).ok, false);
    assert.equal(validateContract({ ...example, engine: { id: 'openhands', extra: 1 } }).ok, false);
  });
});

describe('claude-cli engine', () => {
  it('builds the same claude arguments the runner built before the seam', () => {
    const p = claudeCli.pass({ task: { ...task, model_policy: { effort: 'high', escalate_to: 'claude-opus-5' } }, model: 'claude-opus-5-5', budget: 4.5, opts: { sessionId: 's-1' }, cfg, rules: 'RULES' });
    assert.equal(p.bin, 'claude');
    assert.deepEqual(p.keepEnv, []);
    assert.deepEqual(p.args, ['-p', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '4.5', '--permission-mode', 'dontAsk', '--allowedTools', 'Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'Task', '--disallowedTools', 'WebSearch', 'NotebookEdit', '--settings', '/opt/vocion-runner/claude-settings.json', '--append-system-prompt', 'RULES', '--model', 'claude-opus-5-5', '--session-id', 's-1', '--effort', 'high', '--fallback-model', 'claude-opus-5']);
    assert.deepEqual(claudeCli.pass({ task, model: 'm', budget: 1, opts: { resume: 's-1' }, cfg, rules: '' }).args.slice(-2), ['--resume', 's-1']);
    assert.deepEqual(claudeCli.pass({ task, model: 'm', budget: 1, opts: {}, cfg, rules: '' }).args.slice(-1), ['--no-session-persistence']);
  });
});

describe('openhands engine', () => {
  it('names the model as LiteLLM does: Anthropic by default, Bedrock by config, the contract\'s as written', () => {
    assert.equal(openhands.liteLlmModel(task, 'claude-opus-5-5', {}), 'anthropic/claude-opus-5-5');
    assert.equal(openhands.liteLlmModel(task, 'claude-opus-5-5', { OPENHANDS_PROVIDER: 'bedrock', OPENHANDS_BEDROCK_PREFIX: 'us.anthropic.' }), 'bedrock/us.anthropic.claude-opus-5-5');
    assert.equal(openhands.liteLlmModel({ ...task, engine: { id: 'openhands', model: 'bedrock/arn:aws:bedrock:us-east-1:1:inference-profile/x' } }, 'claude-opus-5-5', {}), 'bedrock/arn:aws:bedrock:us-east-1:1:inference-profile/x');
  });

  it('runs the driver with the budget, a session, the rules file and the runner\'s hooks', () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-pass-'));
    const p = openhands.pass({ task, model: 'claude-opus-5-5', budget: 3, opts: { sessionId: 's-2' }, cfg, rules: 'RULES', repoDir: '/workspace/repo', logDir, env: {} });
    assert.equal(p.bin, '/opt/openhands/bin/python');
    assert.deepEqual(p.args, ['/opt/vocion-runner/src/engines/openhands_driver.py', '--model', 'anthropic/claude-opus-5-5', '--budget', '3', '--workdir', '/workspace/repo', '--system-suffix-file', path.join(logDir, 'system-suffix.md'), '--hooks-dir', '/opt/vocion-runner/hooks', '--session-id', 's-2']);
    assert.equal(fs.readFileSync(path.join(logDir, 'system-suffix.md'), 'utf8'), 'RULES');
    assert.deepEqual(p.keepEnv, [], 'an Anthropic-key run keeps no AWS credentials');
    const resumed = openhands.pass({ task, model: 'claude-opus-5-5', budget: 1, opts: { resume: 's-2', label: 'repair-1' }, cfg, rules: '', repoDir: '/r', logDir, env: { OPENHANDS_PROVIDER: 'bedrock' } });
    assert.deepEqual(resumed.args.slice(-2), ['--resume', 's-2']);
    assert.ok(resumed.keepEnv.includes('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI'), 'a Bedrock run keeps the task role for the driver');
    assert.ok(!resumed.keepEnv.some(k => /GITHUB|GH_|VOCION/.test(k)));
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('is unavailable in an image without the OpenHands environment', () => {
    const r = openhands.available({ ...cfg, openhandsHome: '/nonexistent' }, {});
    assert.equal(r.ok, false);
    assert.match(r.why, /open target/);
  });

  it('its stream reads as Claude Code\'s: tool events, results and usage', () => {
    const lines = [
      { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }], usage: { input_tokens: 4, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 } } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'BLOCKED by runner policy: no' }] } },
    ];
    const events = lines.flatMap(messageEvents);
    assert.deepEqual(events.map(e => e.phase), ['claude.text', 'claude.tool', 'claude.tool.result']);
    assert.equal(events[1].fields.tool, 'Bash');
    assert.equal(events[2].fields.ok, false);
    assert.deepEqual(usageFromMessages(lines), { model: 'claude-opus-5-5', inputTokens: 154, outputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 50 });
  });

  it('the driver maps OpenHands tools onto the names the runner knows', () => {
    const code = `import json,sys; sys.path.insert(0, ${JSON.stringify(path.join(here, 'engines'))}); import openhands_driver as d
print(json.dumps([d.claude_tool('terminal', {'command': 'ls'}), d.claude_tool('file_editor', {'command': 'create', 'path': '/r/a', 'file_text': 'x'}), d.claude_tool('file_editor', {'command': 'str_replace', 'path': '/r/a', 'old_str': 'x', 'new_str': 'y'}), d.claude_tool('file_editor', {'command': 'view', 'path': '/r/a'}), d.claude_tool('task_tracker', {'task_list': []})]))`;
    const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [['Bash', { command: 'ls' }], ['Write', { file_path: '/r/a', content: 'x' }], ['Edit', { file_path: '/r/a', old_string: 'x', new_string: 'y' }], ['Read', { file_path: '/r/a' }], ['TodoWrite', { todos: [] }]]);
  });
});

describe('openhands guard hook (hooks/openhands-guard.sh)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-guard-'));
  const guard = (input) => {
    const r = spawnSync(path.join(runnerDir, 'hooks', 'openhands-guard.sh'), [], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, RUNNER_ALLOWED_PATHS: '["**"]', RUNNER_REPO: repo, RUNNER_HUMAN_OWNED: '["CLAUDE.md"]' }, cwd: repo });
    return { code: r.status, err: r.stderr };
  };
  const bash = command => ({ tool_name: 'terminal', tool_input: { command } });
  const edit = (command, p) => ({ tool_name: 'file_editor', tool_input: { command, path: p } });

  it('blocks what Claude Code\'s hooks and denials block', () => {
    for (const cmd of ['git push origin main', 'git commit -am x', 'git merge main', 'gh pr merge 1', 'gh pr create', 'cat .env', 'cat ~/.ssh/id_rsa', 'printenv', 'rm -rf src', 'curl -X POST https://example.com']) {
      assert.equal(guard(bash(cmd)).code, 2, cmd);
    }
    for (const [c, p] of [['view', `${repo}/.env`], ['view', '/home/runner/.aws/credentials'], ['view', `${repo}/key.pem`], ['create', `${repo}/.github/workflows/ci.yml`], ['str_replace', `${repo}/.git/config`], ['create', `${repo}/CLAUDE.md`], ['create', '/etc/passwd'], ['create', `${repo}/.env.local`]]) {
      assert.equal(guard(edit(c, p)).code, 2, `${c} ${p}`);
    }
  });

  it('fails closed: an unknown tool or an unreadable call is blocked', () => {
    assert.equal(guard({ tool_name: 'browser_navigate', tool_input: { url: 'https://example.com' } }).code, 2);
    assert.equal(guard('not json').code, 2);
  });

  it('lets ordinary work through', () => {
    for (const cmd of ['ls -la', 'npm test', 'git status', 'git diff', 'node --test test/a.test.mjs']) {
      assert.equal(guard(bash(cmd)).code, 0, cmd);
    }
    for (const [c, p] of [['view', `${repo}/src/a.mjs`], ['create', `${repo}/src/a.mjs`], ['str_replace', `${repo}/test/a.test.mjs`], ['create', '/workspace/scratch/notes.md']]) {
      assert.equal(guard(edit(c, p)).code, 0, `${c} ${p}`);
    }
    assert.equal(guard({ tool_name: 'task_tracker', tool_input: {} }).code, 0);
    assert.equal(guard({ tool_name: 'finish', tool_input: { message: 'done' } }).code, 0);
  });
});

describe('the image', () => {
  const dockerfile = fs.readFileSync(path.join(runnerDir, 'Dockerfile'), 'utf8');

  it('copies the engines, and the default target is still the claude-cli image', () => {
    assert.ok(dockerfile.includes('COPY --chown=runner:runner src/engines/ /opt/vocion-runner/src/engines/'));
    const stages = [...dockerfile.matchAll(/^FROM \S+(?: AS (\w+))?/gm)].map(m => m[1]);
    assert.deepEqual(stages, ['base', 'open', 'internal']);
    const internal = dockerfile.slice(dockerfile.indexOf('AS internal'));
    assert.match(internal, /@anthropic-ai\/claude-code@/);
    const open = dockerfile.slice(dockerfile.indexOf('AS open'), dockerfile.indexOf('AS internal'));
    assert.doesNotMatch(open, /claude-code/);
    assert.match(open, /--no-deps/);
  });

  it('the open image\'s Python environment is pinned and carries no browser or posthog', () => {
    const reqs = fs.readFileSync(path.join(runnerDir, 'openhands-requirements.txt'), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
    assert.ok(reqs.every(l => /^[\w.-]+==\S+$/.test(l)), 'every line pinned');
    assert.ok(reqs.some(l => l.startsWith('openhands-sdk==')) && reqs.some(l => l.startsWith('openhands-tools==')));
    assert.ok(!reqs.some(l => /^(?:posthog|browser-use|openhands-agent-server)==/.test(l)));
  });
});

describe('claude-cli availability', () => {
  it('needs the claude binary on PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bin-'));
    assert.equal(claudeCli.available(cfg, { PATH: dir }).ok, false);
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(claudeCli.available(cfg, { PATH: dir }).ok, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('base_branch', () => {
  it('is optional, names a branch, and is not defaulted into the contract', () => {
    assert.equal(validateContract({ ...example, base_branch: 'eval-fixture-dataroom' }).ok, true);
    assert.equal(validateContract({ ...example, base_branch: '-x' }).ok, false);
    assert.equal(validateContract({ ...example, base_branch: 'a b' }).ok, false);
  });
});

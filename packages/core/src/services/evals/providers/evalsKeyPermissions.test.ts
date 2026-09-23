/**
 * The workspace's AWS key must be allowed every AgentCore call the eval code
 * makes, and infra/agentcore/check-evals-key.sh is where that list lives.
 *
 * A missing permission does not fail an eval run. It quietly drops part of it
 * (the cases are not copied, a custom evaluator is left out) and the scores
 * come back missing those checks, so nobody notices until they read the
 * warning. These tests keep the script's list and the code in step: a new
 * AgentCore command in the eval code cannot ship without its permission, and
 * the list does not keep granting calls the code no longer makes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');
const EVALS_DIR = join(__dirname, '..');
const CHECK_SCRIPT = join(REPO_ROOT, 'infra', 'agentcore', 'check-evals-key.sh');
const AGENTCORE_SDK_IMPORT = /from '@aws-sdk\/client-bedrock-agentcore(?:-control)?'/;

/**
 * Every non-test TypeScript file under a directory, walked with an explicit
 * stack rather than recursion.
 * @param root - Directory to walk.
 * @returns Absolute file paths.
 */
function sourceFilesUnder(root: string): string[] {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        pending.push(path);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        files.push(path);
      }
    }
  }
  return files;
}

/**
 * The IAM action for every AgentCore SDK command the eval code sends.
 *
 * `new StartBatchEvaluationCommand(...)` is authorized as
 * `bedrock-agentcore:StartBatchEvaluation`, so the action is the command name
 * without its suffix.
 * @returns Sorted, de-duplicated action names.
 */
function actionsTheEvalCodeSends(): string[] {
  const actions = new Set<string>();
  for (const file of sourceFilesUnder(EVALS_DIR)) {
    const text = readFileSync(file, 'utf8');
    if (!AGENTCORE_SDK_IMPORT.test(text)) {
      continue;
    }
    for (const match of text.matchAll(/new ([A-Z]\w+)Command\(/g)) {
      actions.add(`bedrock-agentcore:${match[1]}`);
    }
  }
  return [...actions].sort();
}

/**
 * The actions listed between the markers in check-evals-key.sh.
 * @returns Action names in the order the script lists them.
 */
function actionsTheScriptChecks(): string[] {
  const script = readFileSync(CHECK_SCRIPT, 'utf8');
  const block = script.split('# BEGIN REQUIRED ACTIONS')[1]?.split('# END REQUIRED ACTIONS')[0];
  if (!block) {
    throw new Error('check-evals-key.sh lost its BEGIN/END REQUIRED ACTIONS markers');
  }
  return block
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0] ?? '')
    .filter(action => /^[a-z-]+:[A-Z]\w+$/.test(action));
}

/**
 * Whether any eval source file passes an execution role for AWS to assume.
 * @returns True when a role ARN is handed to AgentCore.
 */
function evalCodePassesARole(): boolean {
  return sourceFilesUnder(EVALS_DIR).some(file => readFileSync(file, 'utf8').includes('evaluationExecutionRoleArn'));
}

describe('the evals key permission list in check-evals-key.sh', () => {
  it('names every AgentCore command the eval code sends', () => {
    const listed = new Set(actionsTheScriptChecks());
    const missing = actionsTheEvalCodeSends().filter(action => !listed.has(action));

    expect(missing).toEqual([]);
  });

  it('does not grant AgentCore calls the eval code no longer makes', () => {
    const sent = new Set(actionsTheEvalCodeSends());
    const stale = actionsTheScriptChecks().filter(action => action.startsWith('bedrock-agentcore:') && !sent.has(action));

    expect(stale).toEqual([]);
  });

  it('lets the key pass the evaluation execution role when the code hands one to AWS', () => {
    expect(evalCodePassesARole()).toBe(true);
    expect(actionsTheScriptChecks()).toContain('iam:PassRole');
  });
});

#!/usr/bin/env tsx
/**
 * runner-tokens — an operator's door to an account's runners (Vocion 5.1): mint, list and revoke
 * the runner tokens that claim one account's engineering runs, and name the target that builds an
 * account's or a workspace's runs. The same as Workforce › Settings › Developers › Software
 * Factory, for someone with a shell on the instance and no login in that account.
 *
 *   npm run runner-tokens -- mint   --account <id-or-slug> --name "Northwind Fargate" [--workspaces <id-or-slug>,…] [--expires-in-days <n>]
 *   npm run runner-tokens -- list   --account <id-or-slug>
 *   npm run runner-tokens -- revoke --account <id-or-slug> --id <tokenId>
 *   npm run runner-tokens -- target --account <id-or-slug> [--workspace <id-or-slug>] --target <name|any>
 *
 * The token is printed once and only its hash is stored. Exit codes: 0 success · 1 execution
 * error · 2 bad usage / not found.
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';
import { listRunnerTokens, mintRunnerToken, revokeRunnerToken } from '@/services/runners/runnerTokens';
import { setAccountRunnerTarget, setWorkspaceRunnerTarget } from '@/services/runners/workspaceTarget';
import 'dotenv/config';

const COMMANDS = ['mint', 'list', 'revoke', 'target'];

function printHelp(): void {
  console.warn(`Usage:
  runner-tokens mint   --account <id-or-slug> --name <label> [--workspaces <id-or-slug>,…] [--expires-in-days <n>] [--created-by <who>]
  runner-tokens list   --account <id-or-slug>
  runner-tokens revoke --account <id-or-slug> --id <tokenId>
  runner-tokens target --account <id-or-slug> [--workspace <id-or-slug>] --target <name|any>

Options:
  --account     The tenant account, by id or slug
  --name        Which runner holds the token (mint)
  --workspaces  Narrow the token to these workspaces of the account (mint; default: every one)
  --expires-in-days  Days until it stops working (mint; default: never)
  --created-by  Audit label for who minted it (mint; default: cli)
  --id          The token to revoke (revoke; from list)
  --workspace   Set this workspace's target instead of the account's (target)
  --target      A target the installation declares (VOCION_RUNNERS), or "any" to clear it (target)
  -h, --help    Show this help`);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(2);
}

async function resolveAccount(arg: string): Promise<string> {
  const [row] = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(or(eq(tenantAccountSchema.id, arg), eq(tenantAccountSchema.slug, arg))).limit(1);
  return row?.id ?? fail(`no account with id or slug "${arg}"`);
}

async function resolveWorkspace(accountId: string, arg: string): Promise<string> {
  const [row] = await db.select({ id: projectSchema.id }).from(projectSchema).where(and(eq(projectSchema.accountId, accountId), or(eq(projectSchema.id, arg), eq(projectSchema.slug, arg)))).limit(1);
  return row?.id ?? fail(`no workspace "${arg}" in that account`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      'account': { type: 'string' },
      'name': { type: 'string' },
      'workspaces': { type: 'string' },
      'workspace': { type: 'string' },
      'target': { type: 'string' },
      'expires-in-days': { type: 'string' },
      'created-by': { type: 'string' },
      'id': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  const command = positionals[0];
  if (values.help || !command || !COMMANDS.includes(command)) {
    printHelp();
    process.exit(values.help ? 0 : 2);
  }
  const accountId = await resolveAccount(values.account ?? fail('--account is required'));

  if (command === 'mint') {
    const name = values.name ?? fail('--name is required for mint');
    const projectIds = values.workspaces
      ? await Promise.all(values.workspaces.split(',').map(w => w.trim()).filter(Boolean).map(w => resolveWorkspace(accountId, w)))
      : null;
    const days = values['expires-in-days'];
    if (days !== undefined && (!/^\d+$/.test(days) || Number(days) === 0)) {
      fail('--expires-in-days must be a positive whole number of days');
    }
    const expiresAt = days === undefined ? null : new Date(Date.now() + Number(days) * 86_400_000);
    const { id, token } = await mintRunnerToken({ accountId, name, projectIds, createdBy: `cli:${values['created-by'] ?? 'operator'}`, expiresAt });
    console.warn(`✓ runner token minted for account ${accountId} (id: ${id}), claiming for ${projectIds ? projectIds.join(', ') : 'every workspace of the account'}`);
    console.warn('');
    console.warn(`  ${token}`);
    console.warn('');
    console.warn('⚠ Put it in the runner\'s secrets now, as VOCION_RUNNER_TOKEN. Only its hash is kept:');
    console.warn('  it cannot be shown again. Lost, it is revoked and replaced.');
    return;
  }

  if (command === 'list') {
    const tokens = await listRunnerTokens(accountId, { includeRevoked: true });
    if (tokens.length === 0) {
      console.warn(`no runner tokens for account ${accountId}`);
      return;
    }
    for (const t of tokens) {
      const status = t.revokedAt ? `REVOKED ${t.revokedAt.toISOString()}` : t.expiresAt && t.expiresAt.getTime() <= Date.now() ? `EXPIRED ${t.expiresAt.toISOString()}` : 'active';
      console.warn(`${t.id}  ${status}  ${t.keyHint ?? ''}  for ${t.workspaces ? t.workspaces.map(w => w.name).join(', ') : 'every workspace'}  last used ${t.lastUsedAt?.toISOString() ?? 'never'}  — ${t.name}`);
    }
    return;
  }

  if (command === 'revoke') {
    const id = values.id ?? fail('--id is required for revoke');
    if (!(await revokeRunnerToken(accountId, id))) {
      fail(`no runner token ${id} in account ${accountId}`);
    }
    console.warn(`✓ runner token ${id} revoked for account ${accountId}`);
    return;
  }

  // target
  const raw = values.target ?? fail('--target is required (a declared target, or "any")');
  const target = raw === 'any' ? null : raw;
  if (values.workspace) {
    const projectId = await resolveWorkspace(accountId, values.workspace);
    await setWorkspaceRunnerTarget(projectId, target);
    console.warn(`✓ workspace ${projectId} builds on ${target ?? 'its account\'s target'}`);
  } else {
    await setAccountRunnerTarget(accountId, target);
    console.warn(`✓ account ${accountId} builds on ${target ?? 'any target'} (workspaces naming their own keep it)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ runner-tokens failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });

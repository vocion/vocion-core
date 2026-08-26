#!/usr/bin/env tsx
/**
 * manage-tokens — issue / list / revoke tenant Bearer tokens (`vcn_live_…`)
 * for the write API and MCP-over-HTTP (`/api/mcp`).
 *
 * The service (`ApiTokenService`) has existed since v1.30; issuance was a
 * manual DB path until this CLI. The plaintext token is printed exactly once
 * — only its SHA-256 hash is stored.
 *
 *   npm run tokens:issue  -- --org <id-or-slug> --name "operational-ai-hub chris"
 *   npm run tokens:list   -- --org <id-or-slug>
 *   npm run tokens:revoke -- --org <id-or-slug> --id <tokenId>
 *
 * Exit codes: 0 success · 1 execution error · 2 bad usage / not found.
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { issueToken, listTokens, revokeToken } from '@/services/ApiTokenService';
import 'dotenv/config';

function printHelp(): void {
  console.warn(`Usage:
  manage-tokens issue  --org <id-or-slug> --name <label> [--role <role>] [--created-by <who>]
  manage-tokens list   --org <id-or-slug>
  manage-tokens revoke --org <id-or-slug> --id <tokenId>

Options:
  --org         Project id or slug (orgId == projectId for auth-created rows)
  --name        Human label for the token (issue)
  --role        Workspace role for the token principal (issue; default: owner)
  --created-by  Audit label for who issued it (issue; default: cli)
  --id          Token id to revoke (revoke; from list output)
  -h, --help    Show this help`);
}

async function resolveOrgId(arg: string): Promise<string | undefined> {
  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(or(eq(projectSchema.id, arg), eq(projectSchema.slug, arg)))
    .limit(1);
  return project?.id;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      'org': { type: 'string' },
      'name': { type: 'string' },
      'role': { type: 'string' },
      'created-by': { type: 'string' },
      'id': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  const command = positionals[0];
  if (values.help || !command || !['issue', 'list', 'revoke'].includes(command)) {
    printHelp();
    process.exit(values.help ? 0 : 2);
  }
  if (!values.org) {
    console.error('✗ --org is required');
    printHelp();
    process.exit(2);
  }

  const orgId = await resolveOrgId(values.org);
  if (!orgId) {
    console.error(`✗ no project found with id or slug "${values.org}"`);
    process.exit(2);
  }

  if (command === 'issue') {
    if (!values.name) {
      console.error('✗ --name is required for issue');
      process.exit(2);
    }
    const issued = await issueToken({
      orgId,
      name: values.name,
      role: values.role as Parameters<typeof issueToken>[0]['role'],
      createdBy: values['created-by'] ?? 'cli',
    });
    console.warn(`✓ token issued for org ${orgId} (id: ${issued.id})`);
    console.warn('');
    console.warn(`  ${issued.token}`);
    console.warn('');
    console.warn('⚠ Shown ONCE — only its hash is stored. Save it now (e.g. ~/.metacto/vocion.env,');
    console.warn('  chmod 600). Never commit it or place it in a repo that deploys its files.');
    return;
  }

  if (command === 'list') {
    const tokens = await listTokens(orgId);
    if (tokens.length === 0) {
      console.warn(`no tokens for org ${orgId}`);
      return;
    }
    for (const t of tokens) {
      const status = t.revokedAt ? `REVOKED ${t.revokedAt.toISOString()}` : 'active';
      const lastUsed = t.lastUsedAt ? t.lastUsedAt.toISOString() : 'never';
      console.warn(`${t.id}  ${status}  created ${t.createdAt.toISOString()}  last used ${lastUsed}  — ${t.name}`);
    }
    return;
  }

  // revoke
  if (!values.id) {
    console.error('✗ --id is required for revoke');
    process.exit(2);
  }
  await revokeToken(orgId, values.id);
  console.warn(`✓ token ${values.id} revoked for org ${orgId}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ manage-tokens failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });

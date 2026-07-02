#!/usr/bin/env tsx
/**
 * Store a source connector credential in the encrypted vault from the CLI —
 * the headless fallback for the Sources UI "Connect" button. For self-hosted
 * / cron installs with no browser, or first-boot credential seeding.
 *
 * The plaintext is AES-GCM encrypted at rest via the same vault the UI uses;
 * it never touches the DB in clear. Ensures a `source_install` exists for the
 * connector slug in the given project, then stores the credential.
 *
 * Idempotent-ish: each call adds a new credential row; the most recent
 * non-revoked one wins at sync time (so re-running rotates the key).
 *
 * Usage:
 *   tsx src/scripts/set-credential.ts \
 *     --project proj-xxxx \
 *     --source hubspot \
 *     --token pat-na1-... \
 *     [--field developerToken=abc] [--display "HubSpot prod"]
 *
 * --project accepts a project id OR slug. Extra connector fields (e.g. Google
 * Ads developerToken) go through repeated --field key=value flags.
 */
import process from 'node:process';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { storeCredentialForSource } from '@/services/SourceCredentialService';

function parseArgs(argv: string[]) {
  const out: { project?: string; source?: string; token?: string; display?: string; fields: Record<string, string> } = { fields: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--project') {
      out.project = next();
    } else if (a === '--source') {
      out.source = next();
    } else if (a === '--token') {
      out.token = next();
    } else if (a === '--display') {
      out.display = next();
    } else if (a === '--field') {
      const [k, ...rest] = next().split('=');
      if (k) {
        out.fields[k] = rest.join('=');
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // --token is optional when --field pairs are given (e.g. Google refresh
  // credentials are { refreshToken, clientId, clientSecret } with no token).
  if (!args.project || !args.source || (!args.token && Object.keys(args.fields).length === 0)) {
    console.error('Usage: set-credential --project <id|slug> --source <slug> [--token <token>] [--field k=v]… [--display name]');
    process.exit(1);
  }

  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(or(eq(projectSchema.id, args.project), eq(projectSchema.slug, args.project)))
    .limit(1);
  if (!project) {
    console.error(`No project matches "${args.project}" (by id or slug).`);
    process.exit(1);
  }

  const { installId, credentialId } = await storeCredentialForSource({
    orgId: project.id, // orgId == projectId for auth.js-created rows
    sourceSlug: args.source,
    raw: { ...(args.token ? { token: args.token } : {}), ...args.fields },
    displayName: args.display,
    userId: 'cli',
    projectId: project.id,
  });

  console.warn(`✓ stored credential #${credentialId} for source "${args.source}" (install #${installId}) in project ${project.id}`);
  console.warn('  Trigger a sync from /dashboard/sources or wait for the scheduled run.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

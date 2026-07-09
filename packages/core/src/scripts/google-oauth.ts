#!/usr/bin/env tsx
/**
 * One-time Google OAuth consent → durable refresh credentials in the vault.
 *
 * Starts a loopback listener, prints the consent URL, captures the code,
 * exchanges it for a REFRESH token, and stores
 * `{ refreshToken, clientId, clientSecret }` for each requested connector
 * (gmail / drive / ga4). Connectors + gmail.send then mint fresh access
 * tokens per run via `libs/sources/googleAuth` — no more hourly expiry.
 *
 * Usage:
 *   npm run google:oauth -- --project <id|slug> \
 *     --client-id <id> --client-secret <secret> \
 *     [--sources gmail,drive] [--port 8765]
 *
 * The OAuth client must allow redirect URI http://localhost:<port>/callback
 * (Google Cloud Console → the OAuth client's Authorized redirect URIs).
 */
import { createServer } from 'node:http';
import process from 'node:process';
import { eq, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { storeCredentialForSource } from '@/services/SourceCredentialService';

const SCOPES: Record<string, string[]> = {
  'gmail': ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  'drive': ['https://www.googleapis.com/auth/drive.readonly'],
  'ga4': ['https://www.googleapis.com/auth/analytics.readonly'],
  'google-calendar': ['https://www.googleapis.com/auth/calendar.readonly'],
};

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[++i] ?? '';
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = args['client-id'] ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = args['client-secret'] ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const projectArg = args.project;
  const sources = (args.sources ?? 'gmail,drive').split(',').map(s => s.trim()).filter(Boolean);
  const port = Number(args.port ?? 8765);
  if (!clientId || !clientSecret || !projectArg) {
    console.error('Usage: google-oauth --project <id|slug> --client-id <id> --client-secret <secret> [--sources gmail,drive] [--port 8765]');
    process.exit(1);
  }

  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(or(eq(projectSchema.id, projectArg), eq(projectSchema.slug, projectArg)))
    .limit(1);
  if (!project) {
    console.error(`No project matches "${projectArg}".`);
    process.exit(1);
  }

  const scopes = [...new Set(sources.flatMap(s => SCOPES[s] ?? []))];
  if (scopes.length === 0) {
    console.error(`No known scopes for sources: ${sources.join(', ')}`);
    process.exit(1);
  }
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl = `https://accounts.google.com/o/oauth2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent', // force a refresh token even on re-consent
  }).toString()}`;

  const code: string = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const c = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(c
        ? '<h2>✓ Connected — you can close this tab.</h2>'
        : `<h2>✗ ${err ?? 'No code returned'}</h2>`);
      server.close();
      if (c) {
        resolve(c);
      } else {
        reject(new Error(err ?? 'consent denied'));
      }
    });
    server.listen(port, () => {
      console.log(`\nOpen this URL in your browser (listening on :${port}):\n\n${authUrl}\n`);
    });
    setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for consent (10 min)'));
    }, 600_000);
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    console.error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text().catch(() => '')}`);
    process.exit(1);
  }
  const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string };
  if (!tokens.refresh_token) {
    console.error('No refresh_token returned — remove prior consent at myaccount.google.com/permissions and retry.');
    process.exit(1);
  }

  for (const source of sources) {
    const { credentialId } = await storeCredentialForSource({
      orgId: project.id,
      sourceSlug: source,
      raw: { refreshToken: tokens.refresh_token, clientId, clientSecret },
      displayName: `Google OAuth (${source})`,
      userId: 'google-oauth-cli',
      projectId: project.id,
    });
    console.log(`✓ stored durable ${source} credential #${credentialId} (refresh token, vault-encrypted)`);
  }
  console.log('\nDone. Connectors will mint fresh access tokens per run.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

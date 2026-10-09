/**
 * Sentry connector — the capability carrier for the Sentry reads, and nothing
 * else.
 *
 * Sentry is read LIVE: an agent debugging a production error asks for the
 * issues of one project and environment around one release and time, and for
 * the latest event of the one that matters; the product page counts a
 * project's open issues; the error watch reads new ones every ten minutes. A
 * mirror of events would be stale the moment it was written and would copy
 * request data nobody needs to keep. So this connector ingests nothing, the
 * way Apollo's does not. What registering it buys is everything around the
 * token: a Sentry tile on Connections, a place in the encrypted vault, and —
 * through `inspect` — a Test connection that says whether the token reads the
 * organization, which projects it sees, and whether issues come back.
 *
 * Which project an environment reports to is on the environment's own record
 * (`observability.sentry`), not here: one token serves every product.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { SentryFetch } from '@/libs/sentry/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { listIssues, listProjects, readOrganization, sentryCredentialsFrom } from '@/libs/sentry/client';
import { InspectInputError } from './inspect';

const sentryConfigSchema = z.object({
  /** The projects the reads are expected to cover, for Test connection to confirm. Blank: every project the token sees. */
  projects: z.array(z.string().min(1)).optional(),
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: the organization, its projects, one read of issues.
 * Read-only and free. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config (`projects`).
 * @param input.credentials - The credential values.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectSentry(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: SentryFetch): Promise<ConnectorInspection> {
  const parsed = sentryCredentialsFrom(input.credentials);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const c = parsed.credentials;
  const checks: ConnectorCheck[] = [];
  const org = await readOrganization(c, doFetch);
  if (!org.ok) {
    const reachable = org.error !== 'sentry_error' || org.status !== null;
    checks.push(check('organization', `Reads the ${c.org} organization`, false, org.message));
    return { reachable, authorized: false, checks, note: null, error: org.message };
  }
  checks.push(check('organization', `Reads the ${c.org} organization`, true, org.data.name ? `${org.data.name} (${org.data.slug})` : org.data.slug));

  const projects = await listProjects(c, doFetch);
  const wanted = Array.isArray(input.config.projects) ? (input.config.projects as unknown[]).map(String).filter(Boolean) : [];
  if (!projects.ok) {
    checks.push(check('projects', 'Lists its projects', false, projects.message));
  } else {
    const slugs = projects.data.map(p => p.slug);
    checks.push(check('projects', 'Lists its projects', slugs.length > 0, slugs.length > 0 ? slugs.join(', ') : 'The token sees no project in this organization.'));
    for (const p of wanted) {
      checks.push(check(`project:${p}`, `Sees project ${p}`, slugs.includes(p), slugs.includes(p) ? null : `Not among the projects this token sees (${slugs.join(', ') || 'none'}).`));
    }
  }

  const issues = await listIssues(c, { statsPeriod: '24h', limit: 1 }, doFetch);
  checks.push(check('issues', 'Reads issues (event:read)', issues.ok, issues.ok ? (issues.data[0] ? `Latest busy issue: ${issues.data[0].shortId}` : 'No unresolved issue in the last 24 hours.') : issues.message));

  const failed = checks.filter(x => !x.ok);
  return {
    reachable: true,
    authorized: true,
    checks,
    note: 'Each environment names its Sentry project on its own record (observability.sentry: org, project, environment).',
    error: failed.length > 0 ? failed.map(x => x.detail).filter(Boolean).join(' ') : null,
  };
}

export const sentryConnector: SourceConnector<typeof sentryConfigSchema> = {
  slug: 'sentry',
  name: 'Sentry',
  description: 'Production errors, read live. Issues ranked by events per project, environment and release, and each issue\'s latest stack trace, request and breadcrumbs.',
  icon: 'Bug',
  category: 'engineering',
  brand: 'sentry',
  authKind: 'apikey',
  syncless: true,
  configSchema: sentryConfigSchema,
  inspectNote: 'Reads the organization, its projects and one page of issues. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectSentry({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Sentry is read live by the agent tools and the error watch, never
    // mirrored: a copy of events would be stale and would keep request data.
  },
};

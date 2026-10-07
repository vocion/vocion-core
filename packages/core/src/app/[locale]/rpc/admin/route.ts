import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import process from 'node:process';
import { clerkAuth as auth } from '@/libs/Auth';
import { isOperator } from '@/libs/operator';

/**
 * The System page's figures, scoped to who is asking.
 *
 * One host serves several companies. An operator (`VOCION_OPERATOR_EMAILS`,
 * `libs/operator.ts`) sees the installation: every company's counts, and the
 * health of the services the deployment runs. Everyone else — an account
 * admin included — sees their own workspace's counts and no services: another
 * company's volume is not theirs to read, and the service links are the
 * operator's. `scope` says which one came back, so the page can say so.
 */

type ServiceCheck = {
  name: string;
  url: string;
  externalUrl: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  details?: Record<string, unknown>;
};

async function checkService(name: string, healthUrl: string, externalUrl: string): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - start;
    let details: Record<string, unknown> = {};

    try {
      const data = await res.json();
      details = typeof data === 'object' && data !== null ? data : {};
    } catch {
      // not JSON, that's fine
    }

    return {
      name,
      url: healthUrl,
      externalUrl,
      status: res.ok ? 'up' : 'degraded',
      latencyMs,
      details,
    };
  } catch {
    return {
      name,
      url: healthUrl,
      externalUrl,
      status: 'down',
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * The services this deployment says it runs, at the addresses it configured.
 *
 * These were hard-coded to `http://localhost:3000` and `:3200`. On a deployed
 * host that probed the container's own loopback, and the "Open" links sent
 * every browser to the viewer's own machine. A service with no configured
 * address is left out rather than guessed at.
 */
function configuredServices(): Array<{ name: string; healthUrl: string; externalUrl: string }> {
  const services: Array<{ name: string; healthUrl: string; externalUrl: string }> = [];
  const appUrl = trimSlash(process.env.NEXT_PUBLIC_APP_URL);
  if (appUrl) {
    services.push({ name: 'Vocion App', healthUrl: `${appUrl}/version.txt`, externalUrl: appUrl });
  }
  // The server reaches Langfuse at LANGFUSE_BASE_URL (an internal hostname on
  // a self-hosted stack); a browser follows NEXT_PUBLIC_LANGFUSE_BASE_URL.
  const langfuse = trimSlash(process.env.LANGFUSE_BASE_URL);
  if (langfuse) {
    services.push({ name: 'Langfuse', healthUrl: `${langfuse}/api/public/health`, externalUrl: trimSlash(process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL) ?? langfuse });
  }
  return services;
}

function trimSlash(url: string | undefined): string | undefined {
  const trimmed = url?.trim().replace(/\/+$/, '');
  return trimmed || undefined;
}

/**
 * COUNTS, NOT ROWS. These used to `select()` every row of each table — every
 * org's agents, skills, objects, and every knowledge chunk WITH its embedding
 * — only to read `.length`. The status panel polls this every 15s; each call
 * outlived the interval, calls piled up, and on 2026-09-25 (20:12Z and again
 * at 20:18Z) the app ran out of heap and stopped serving production.
 * @param table - The table to count.
 * @param orgId - The workspace to count within, or null for the whole installation (operators only).
 */
async function countOf(table: PgTable & { orgId: PgColumn }, orgId: string | null): Promise<number> {
  const { db } = await import('@/libs/DB');
  const { eq, sql } = await import('drizzle-orm');
  const query = db.select({ n: sql<number>`count(*)::int` }).from(table);
  const [row] = orgId === null ? await query : await query.where(eq(table.orgId, orgId));
  return Number((row as { n: number } | undefined)?.n ?? 0);
}

async function getDbStats(orgId: string | null): Promise<Record<string, unknown>> {
  try {
    const { agentSchema, playbookSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const [agents, skills, objects, objectTypes] = await Promise.all([
      countOf(agentSchema, orgId),
      countOf(playbookSchema, orgId),
      countOf(businessObjectSchema, orgId),
      countOf(businessObjectTypeSchema, orgId),
    ]);
    return { agents, skills, objectTypes, objects };
  } catch {
    return { error: 'Could not connect to Vocion DB' };
  }
}

async function getRetrievalStats(orgId: string | null): Promise<Record<string, unknown>> {
  try {
    const { knowledgeSourceSchema, knowledgeDocumentSchema, knowledgeChunkSchema } = await import('@/models/Schema');
    const [sources, documents, chunks] = await Promise.all([
      countOf(knowledgeSourceSchema, orgId),
      countOf(knowledgeDocumentSchema, orgId),
      countOf(knowledgeChunkSchema, orgId),
    ]);
    return { sources, documents, chunks };
  } catch {
    return { error: 'Could not query retrieval tables' };
  }
}

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const operator = await isOperator(userId);
  if (!operator && !orgId) {
    // Signed in but in no workspace: there is nothing of theirs to count.
    return new Response(JSON.stringify({ error: 'No workspace selected' }), { status: 403 });
  }
  // An operator counts the installation; everyone else, their own workspace.
  const countScope = operator ? null : orgId;

  const [services, dbStats, retrievalStats] = await Promise.all([
    operator ? Promise.all(configuredServices().map(s => checkService(s.name, s.healthUrl, s.externalUrl))) : Promise.resolve([]),
    getDbStats(countScope),
    getRetrievalStats(countScope),
  ]);

  return new Response(JSON.stringify({
    scope: operator ? 'installation' : 'workspace',
    services,
    db: dbStats,
    retrieval: retrievalStats,
    timestamp: new Date().toISOString(),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

import type { PgTable } from 'drizzle-orm/pg-core';
import { clerkAuth as auth } from '@/libs/Auth';

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
 * COUNTS, NOT ROWS. These used to `select()` every row of each table — every
 * org's agents, skills, objects, and every knowledge chunk WITH its embedding
 * — only to read `.length`. The status panel polls this every 15s; each call
 * outlived the interval, calls piled up, and on 2026-09-25 (20:12Z and again
 * at 20:18Z) the app ran out of heap and stopped serving production.
 * @param table - The table to count.
 */
async function countOf(table: PgTable): Promise<number> {
  const { db } = await import('@/libs/DB');
  const { sql } = await import('drizzle-orm');
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return Number((row as { n: number } | undefined)?.n ?? 0);
}

async function getDbStats(): Promise<Record<string, unknown>> {
  try {
    const { agentSchema, playbookSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const [agents, skills, objects, objectTypes] = await Promise.all([
      countOf(agentSchema),
      countOf(playbookSchema),
      countOf(businessObjectSchema),
      countOf(businessObjectTypeSchema),
    ]);
    return { agents, skills, objectTypes, objects };
  } catch {
    return { error: 'Could not connect to Vocion DB' };
  }
}

async function getRetrievalStats(): Promise<Record<string, unknown>> {
  try {
    const { knowledgeSourceSchema, knowledgeDocumentSchema, knowledgeChunkSchema } = await import('@/models/Schema');
    const [sources, documents, chunks] = await Promise.all([
      countOf(knowledgeSourceSchema),
      countOf(knowledgeDocumentSchema),
      countOf(knowledgeChunkSchema),
    ]);
    return { sources, documents, chunks };
  } catch {
    return { error: 'Could not query retrieval tables' };
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const [services, dbStats, retrievalStats] = await Promise.all([
    Promise.all([
      checkService('Vocion App', 'http://localhost:3000/version.txt', 'http://localhost:3000'),
      checkService('Langfuse', 'http://localhost:3200/api/public/health', 'http://localhost:3200'),
      checkService('Temporal UI', 'http://localhost:8233', 'http://localhost:8233'),
    ]),
    getDbStats(),
    getRetrievalStats(),
  ]);

  return new Response(JSON.stringify({
    services,
    db: dbStats,
    retrieval: retrievalStats,
    timestamp: new Date().toISOString(),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

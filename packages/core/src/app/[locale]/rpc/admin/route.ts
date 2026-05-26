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

async function getDbStats(): Promise<Record<string, unknown>> {
  try {
    const { db } = await import('@/libs/DB');
    const { agentSchema, skillSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const agents = await db.select().from(agentSchema);
    const skills = await db.select().from(skillSchema);
    const objects = await db.select().from(businessObjectSchema);
    const types = await db.select().from(businessObjectTypeSchema);
    return {
      agents: agents.length,
      skills: skills.length,
      objectTypes: types.length,
      objects: objects.length,
    };
  } catch {
    return { error: 'Could not connect to Vocion DB' };
  }
}

async function getRetrievalStats(): Promise<Record<string, unknown>> {
  try {
    const { db } = await import('@/libs/DB');
    const { knowledgeSourceSchema, knowledgeDocumentSchema, knowledgeChunkSchema } = await import('@/models/Schema');
    const sources = await db.select().from(knowledgeSourceSchema);
    const docs = await db.select().from(knowledgeDocumentSchema);
    const chunks = await db.select().from(knowledgeChunkSchema);
    return {
      sources: sources.length,
      documents: docs.length,
      chunks: chunks.length,
    };
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
      checkService('Vocion App', 'http://localhost:3000', 'http://localhost:3000'),
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

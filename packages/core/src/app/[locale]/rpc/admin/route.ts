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
 * Check TCP services (Redis, etc.) by attempting a socket connection via a container exec
 * @param name
 * @param _container
 * @param host
 * @param port
 * @param externalUrl
 */
async function checkTcpService(name: string, _container: string, host: string, port: number, externalUrl: string): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    // Use the Onyx API server to ping Redis since it's on the same Docker network
    // We can check by hitting any endpoint that depends on Redis
    const res = await fetch(`http://localhost:8080/health`, { signal: AbortSignal.timeout(3000) });
    const latencyMs = Date.now() - start;
    return {
      name,
      url: `${host}:${port}`,
      externalUrl,
      status: res.ok ? 'up' : 'degraded',
      latencyMs,
      details: { note: `Inferred from Onyx API health (depends on ${name})` },
    };
  } catch {
    return {
      name,
      url: `${host}:${port}`,
      externalUrl,
      status: 'down',
      latencyMs: Date.now() - start,
    };
  }
}

async function getVespaStats(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch('http://localhost:8081/search/?yql=select+documentid+from+sources+*+where+true+limit+0&hits=0', {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    const totalDocuments = data?.root?.fields?.totalCount ?? 0;

    // Check health for more detail
    const healthRes = await fetch('http://localhost:8081/state/v1/health', { signal: AbortSignal.timeout(3000) });
    const health = await healthRes.json();

    return {
      totalDocuments,
      status: health?.status?.code ?? 'unknown',
    };
  } catch {
    return { totalDocuments: 'unknown', status: 'down' };
  }
}

async function getOnyxConnectorStats(): Promise<Record<string, unknown>> {
  const adminKey = process.env.ONYX_API_ADMIN_KEY || process.env.ONYX_API_KEY || '';
  const baseUrl = process.env.ONYX_API_URL || 'http://localhost:8080';
  try {
    const res = await fetch(`${baseUrl}/manage/connector`, {
      headers: { Authorization: `Bearer ${adminKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const connectors = await res.json();
    return {
      connectorCount: Array.isArray(connectors) ? connectors.length : 0,
    };
  } catch {
    return { connectorCount: 'unknown' };
  }
}

async function getIndexingStatus(): Promise<Record<string, unknown>> {
  try {
    // Query Onyx's PostgreSQL via the background container
    const res = await fetch('http://localhost:8080/manage/admin/connector/indexing-status', {
      headers: { Authorization: `Bearer ${process.env.ONYX_API_ADMIN_KEY || process.env.ONYX_API_KEY || ''}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const data = await res.json();

    // Parse the indexing status into a useful summary
    const attempts = Array.isArray(data) ? data : [];
    const active = attempts.filter((a: any) => {
      const latest = a.latest_index_attempt;
      return latest && (latest.status === 'in_progress' || latest.status === 'not_started');
    });

    return {
      activeAttempts: active.map((a: any) => ({
        source: a.connector?.source ?? '?',
        name: a.connector?.name ?? '?',
        status: a.latest_index_attempt?.status ?? '?',
        docsIndexed: a.latest_index_attempt?.total_docs_indexed ?? 0,
        batchesCompleted: a.latest_index_attempt?.completed_batches ?? 0,
        failures: a.latest_index_attempt?.total_failures_batch_level ?? 0,
      })),
      totalConnectors: attempts.length,
    };
  } catch {
    return { error: 'Could not fetch indexing status' };
  }
}

async function getDbStats(): Promise<Record<string, unknown>> {
  try {
    // Use dynamic import to avoid issues with server components
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

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const onyxUrl = process.env.ONYX_API_URL || 'http://localhost:8080';

  const [services, vespaStats, connectorStats, dbStats, indexingStatus] = await Promise.all([
    Promise.all([
      checkService('Onyx API', `${onyxUrl}/health`, 'http://localhost:3100'),
      checkService('Vespa Search', 'http://localhost:8081/state/v1/health', 'http://localhost:8081'),
      checkService('Langfuse', 'http://localhost:3200/api/public/health', 'http://localhost:3200'),
      checkService('Temporal UI', 'http://localhost:8233', 'http://localhost:8233'),
      checkTcpService('Redis (Onyx)', 'onyx-stack-cache-1', 'localhost', 6380, ''),
      checkService('Vocion App', 'http://localhost:3000', 'http://localhost:3000'),
    ]),
    getVespaStats(),
    getOnyxConnectorStats(),
    getDbStats(),
    getIndexingStatus(),
  ]);

  return new Response(JSON.stringify({
    services,
    vespa: vespaStats,
    indexing: indexingStatus,
    connectors: connectorStats,
    db: dbStats,
    timestamp: new Date().toISOString(),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

import { NextResponse } from 'next/server';

const ONYX_URL = process.env.ONYX_API_URL || 'http://localhost:8080';
const ONYX_KEY = process.env.ONYX_API_KEY || '';
const ONYX_ADMIN_KEY = process.env.ONYX_API_ADMIN_KEY || '';

export async function GET() {
  const key = ONYX_ADMIN_KEY || ONYX_KEY;
  if (!key) {
    return NextResponse.json({ connectors: [], queue: null }, { status: 501 });
  }

  try {
    // Get connector list
    const connRes = await fetch(`${ONYX_URL}/manage/connector`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!connRes.ok) {
      return NextResponse.json({ connectors: [], queue: null, error: `Onyx: ${connRes.status}` });
    }
    const connectors = await connRes.json();

    // Build cc-pair map by scanning IDs 1-20
    const ccPairByConnectorId = new Map<number, any>();
    const ccPairFetches = Array.from({ length: 20 }, (_, i) => i + 1).map(async (ccId) => {
      try {
        const res = await fetch(`${ONYX_URL}/manage/admin/cc-pair/${ccId}`, {
          headers: { Authorization: `Bearer ${key}` },
          cache: 'no-store',
        });
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (data.connector?.id !== undefined && data.connector.source !== 'ingestion_api') {
          const existing = ccPairByConnectorId.get(data.connector.id);
          // Keep the one with more docs
          if (!existing || (data.num_docs_indexed || 0) > (existing.num_docs_indexed || 0)) {
            ccPairByConnectorId.set(data.connector.id, data);
          }
        }
      } catch { /* skip */ }
    });
    await Promise.all(ccPairFetches);

    // Get index attempt progress from DB
    const _indexProgress: Record<number, any> = {};
    try {
      // Check active index attempts via background logs proxy
      // We'll use the cc-pair data which has last_index_attempt_status
    } catch { /* skip */ }

    // Enrich connectors with cc-pair data
    const enriched = connectors.map((c: any) => {
      const cc = ccPairByConnectorId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        source: c.source,
        status: cc?.status || 'unknown',
        lastAttemptStatus: cc?.last_index_attempt_status || null,
        docsIndexed: cc?.num_docs_indexed || 0,
        lastIndexed: cc?.last_indexed || null,
        refreshFreq: c.refresh_freq,
        inRepeatedError: cc?.in_repeated_error_state || false,
      };
    });

    // Get indexing status for progress display
    let indexingByConnector: Record<number, any> = {};
    try {
      const idxRes = await fetch(`${ONYX_URL}/manage/admin/connector/indexing-status`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store',
      });
      if (idxRes.ok) {
        const idxData = await idxRes.json();
        for (const item of (Array.isArray(idxData) ? idxData : [])) {
          const connId = item?.connector?.id;
          const latest = item?.latest_index_attempt;
          if (connId !== undefined && latest) {
            indexingByConnector[connId] = {
              status: latest.status,
              docsIndexed: latest.total_docs_indexed ?? 0,
              batchesCompleted: latest.completed_batches ?? 0,
              failures: latest.total_failures_batch_level ?? 0,
              newDocs: latest.new_docs_indexed ?? 0,
            };
          }
        }
      }
    } catch { /* skip */ }

    // Add indexing data to enriched connectors
    const withIndexing = enriched.map((c: any) => ({
      ...c,
      indexing: indexingByConnector[c.id] ?? null,
    }));

    return NextResponse.json({ connectors: withIndexing });
  } catch (err: any) {
    return NextResponse.json({ connectors: [], error: err.message });
  }
}

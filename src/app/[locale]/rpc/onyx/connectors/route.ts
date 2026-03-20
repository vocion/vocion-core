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

    return NextResponse.json({ connectors: enriched });
  } catch (err: any) {
    return NextResponse.json({ connectors: [], error: err.message });
  }
}

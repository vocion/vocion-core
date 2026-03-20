import { NextResponse } from 'next/server';

const ONYX_URL = process.env.ONYX_API_URL || 'http://localhost:8080';
const ONYX_KEY = process.env.ONYX_API_KEY || '';
const ONYX_ADMIN_KEY = process.env.ONYX_API_ADMIN_KEY || '';

export async function GET() {
  const key = ONYX_ADMIN_KEY || ONYX_KEY;
  if (!key) {
    return NextResponse.json({ connectors: [] }, { status: 501 });
  }

  try {
    // Get connector list from Onyx API
    const connRes = await fetch(`${ONYX_URL}/manage/connector`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!connRes.ok) {
      return NextResponse.json({ connectors: [], error: `Onyx: ${connRes.status}` });
    }
    const connectors = await connRes.json();

    // Get cc-pair data for each connector
    const ccPairByConnectorId = new Map<number, any>();
    const ccPairFetches = Array.from({ length: 20 }, (_, i) => i + 1).map(async (ccId) => {
      try {
        const res = await fetch(`${ONYX_URL}/manage/admin/cc-pair/${ccId}`, {
          headers: { Authorization: `Bearer ${key}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.connector?.id !== undefined && data.connector.source !== 'ingestion_api') {
          const existing = ccPairByConnectorId.get(data.connector.id);
          if (!existing || (data.num_docs_indexed || 0) > (existing.num_docs_indexed || 0)) {
            ccPairByConnectorId.set(data.connector.id, data);
          }
        }
      } catch { /* skip */ }
    });
    await Promise.all(ccPairFetches);

    // Get Vespa chunk count for context
    let vespaChunks = 0;
    try {
      const vRes = await fetch('http://localhost:8081/search/?yql=select+documentid+from+danswer_chunk_nomic_ai_nomic_embed_text_v1+where+true+limit+0&hits=0', {
        signal: AbortSignal.timeout(3000),
      });
      const vData = await vRes.json();
      vespaChunks = vData?.root?.fields?.totalCount ?? 0;
    } catch { /* skip */ }

    // Enrich connectors
    const enriched = connectors
      .filter((c: any) => c.source !== 'ingestion_api')
      .map((c: any) => {
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
          // Indexing progress from index attempts
          indexing: null as any,
        };
      });

    // Get active indexing attempts per connector from Onyx DB via cc-pair data
    // Since the indexing-status API doesn't work, we'll check each connector's latest attempt
    for (const conn of enriched) {
      const cc = ccPairByConnectorId.get(conn.id);
      if (cc) {
        const lastStatus = cc.last_index_attempt_status;
        if (lastStatus === 'in_progress' || lastStatus === 'not_started') {
          conn.indexing = {
            status: lastStatus,
            docsIndexed: 0, // cc-pair doesn't have current attempt docs
            batchesCompleted: 0,
          };
        }
      }
    }

    return NextResponse.json({
      connectors: enriched,
      vespaChunks,
    });
  } catch (err: any) {
    return NextResponse.json({ connectors: [], error: err.message });
  }
}

import { NextResponse } from 'next/server';

const ONYX_URL = process.env.ONYX_API_URL || 'http://localhost:8080';
const ONYX_KEY = process.env.ONYX_API_KEY || '';
const ONYX_ADMIN_KEY = process.env.ONYX_API_ADMIN_KEY || '';

const adminKey = () => ONYX_ADMIN_KEY || ONYX_KEY;
const adminHeaders = () => ({
  'Authorization': `Bearer ${adminKey()}`,
  'Content-Type': 'application/json',
});

export async function GET() {
  const key = adminKey();
  if (!key) {
    return NextResponse.json({ connectors: [] }, { status: 501 });
  }

  try {
    // Use the POST indexing-status endpoint (returns all connectors with rich status)
    const statusRes = await fetch(`${ONYX_URL}/manage/admin/connector/indexing-status`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({}),
      cache: 'no-store',
    });

    if (!statusRes.ok) {
      const text = await statusRes.text();
      return NextResponse.json({ connectors: [], error: `Onyx indexing-status: ${statusRes.status} ${text}` });
    }

    const statusData: Array<{
      source: string;
      summary: { total_docs_indexed: number };
      indexing_statuses: Array<{
        cc_pair_id: number;
        name: string;
        source: string;
        cc_pair_status: string;
        in_progress: boolean;
        in_repeated_error_state: boolean;
        last_finished_status: string | null;
        last_status: string | null;
        last_success: string | null;
        docs_indexed: number;
        latest_index_attempt_docs_indexed: number;
      }>;
    }> = await statusRes.json();

    // Also get connector list for refresh_freq
    let connectorList: Array<{ id: number; source: string; refresh_freq: number | null; credential_ids: number[]; time_updated?: string | null }> = [];
    try {
      const connRes = await fetch(`${ONYX_URL}/manage/connector`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store',
      });
      if (connRes.ok) {
        connectorList = await connRes.json();
      }
    } catch { /* skip */ }

    const connectorMap = new Map(connectorList.map(c => [c.source, c]));

    // Get Vespa chunk count
    let vespaChunks = 0;
    try {
      const vRes = await fetch('http://localhost:8081/search/?yql=select+documentid+from+danswer_chunk_nomic_ai_nomic_embed_text_v1+where+true+limit+0&hits=0', {
        signal: AbortSignal.timeout(3000),
      });
      const vData = await vRes.json();
      vespaChunks = vData?.root?.fields?.totalCount ?? 0;
    } catch { /* skip */ }

    // Flatten indexing_statuses across all sources
    const enriched = statusData.flatMap(sourceGroup =>
      sourceGroup.indexing_statuses.map((s) => {
        const conn = connectorMap.get(s.source);
        return {
          id: s.cc_pair_id,
          connectorId: conn?.id ?? null,
          credentialIds: conn?.credential_ids ?? [],
          name: s.name,
          source: s.source,
          status: s.cc_pair_status,
          lastAttemptStatus: s.last_status,
          lastFinishedStatus: s.last_finished_status,
          lastSuccess: s.last_success,
          docsIndexed: s.docs_indexed,
          latestAttemptDocs: s.latest_index_attempt_docs_indexed,
          lastIndexed: s.last_success || conn?.time_updated || null,
          refreshFreq: conn?.refresh_freq ?? null,
          inProgress: s.in_progress,
          inRepeatedError: s.in_repeated_error_state,
        };
      }),
    ).filter(c => c.source !== 'ingestion_api');

    // Fetch details for failed + in-progress connectors
    const needsDetails = enriched.filter(c => c.lastFinishedStatus === 'failed' || c.inProgress);
    await Promise.all(needsDetails.map(async (c) => {
      try {
        const attemptsRes = await fetch(`${ONYX_URL}/manage/admin/cc-pair/${c.id}/index-attempts`, {
          headers: adminHeaders(),
          cache: 'no-store',
        });
        if (!attemptsRes.ok) {
          return;
        }
        const attemptsData = await attemptsRes.json();
        const items = attemptsData.items ?? attemptsData;
        if (!Array.isArray(items)) {
          return;
        }

        // For failed: get error details
        if (c.lastFinishedStatus === 'failed') {
          const failedAttempt = items.find((a: any) => a.status === 'failed' && a.error_msg);
          if (failedAttempt) {
            (c as any).lastError = {
              message: failedAttempt.error_msg?.slice(0, 500) ?? null,
              time: failedAttempt.time_updated ?? failedAttempt.time_started ?? null,
              docsIndexed: failedAttempt.total_docs_indexed ?? 0,
            };
          }
        }

        // For in-progress: get live indexing stats
        if (c.inProgress) {
          const activeAttempt = items.find((a: any) => a.status === 'in_progress');
          if (activeAttempt) {
            (c as any).indexingProgress = {
              newDocsIndexed: activeAttempt.new_docs_indexed ?? 0,
              totalDocsIndexed: activeAttempt.total_docs_indexed ?? 0,
              docsRemoved: activeAttempt.docs_removed_from_index ?? 0,
              errorCount: activeAttempt.error_count ?? 0,
              timeStarted: activeAttempt.time_started ?? null,
              timeUpdated: activeAttempt.time_updated ?? null,
            };
          }
        }
      } catch { /* skip */ }
    }));

    return NextResponse.json({ connectors: enriched, vespaChunks });
  } catch (err: any) {
    return NextResponse.json({ connectors: [], error: err.message });
  }
}

/* ------------------------------------------------------------------ */
/* Connector actions: re-index, cancel, pause                          */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  const key = adminKey();
  if (!key) {
    return NextResponse.json({ error: 'No API key' }, { status: 501 });
  }

  const body = await request.json();
  const { action, ccPairId, connectorId, credentialIds } = body as {
    action: 'reindex_full' | 'reindex_incremental' | 'cancel' | 'pause' | 'resume';
    ccPairId: number;
    connectorId?: number;
    credentialIds?: number[];
  };

  try {
    switch (action) {
      case 'reindex_full':
      case 'reindex_incremental': {
        if (!connectorId) {
          return NextResponse.json({ error: 'connectorId required for re-index' }, { status: 400 });
        }
        const res = await fetch(`${ONYX_URL}/manage/admin/connector/run-once`, {
          method: 'POST',
          headers: adminHeaders(),
          body: JSON.stringify({
            connector_id: connectorId,
            credential_ids: credentialIds ?? [],
            from_beginning: action === 'reindex_full',
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          return NextResponse.json({ error: `Onyx run-once: ${res.status} ${text}` }, { status: res.status });
        }
        return NextResponse.json({ ok: true, action });
      }

      case 'pause': {
        const res = await fetch(`${ONYX_URL}/manage/admin/cc-pair/${ccPairId}/status`, {
          method: 'PUT',
          headers: adminHeaders(),
          body: JSON.stringify({ status: 'PAUSED' }),
        });
        if (!res.ok) {
          const text = await res.text();
          return NextResponse.json({ error: `Onyx pause: ${res.status} ${text}` }, { status: res.status });
        }
        return NextResponse.json({ ok: true, action });
      }

      case 'resume': {
        const res = await fetch(`${ONYX_URL}/manage/admin/cc-pair/${ccPairId}/status`, {
          method: 'PUT',
          headers: adminHeaders(),
          body: JSON.stringify({ status: 'ACTIVE' }),
        });
        if (!res.ok) {
          const text = await res.text();
          return NextResponse.json({ error: `Onyx resume: ${res.status} ${text}` }, { status: res.status });
        }
        return NextResponse.json({ ok: true, action });
      }

      case 'cancel': {
        // Cancel = pause then resume (Onyx doesn't have a direct cancel for in-progress)
        const pauseRes = await fetch(`${ONYX_URL}/manage/admin/cc-pair/${ccPairId}/status`, {
          method: 'PUT',
          headers: adminHeaders(),
          body: JSON.stringify({ status: 'PAUSED' }),
        });
        if (!pauseRes.ok) {
          const text = await pauseRes.text();
          return NextResponse.json({ error: `Onyx cancel (pause): ${pauseRes.status} ${text}` }, { status: pauseRes.status });
        }
        // Resume after a beat so Onyx kills the current attempt
        await new Promise(r => setTimeout(r, 500));
        await fetch(`${ONYX_URL}/manage/admin/cc-pair/${ccPairId}/status`, {
          method: 'PUT',
          headers: adminHeaders(),
          body: JSON.stringify({ status: 'ACTIVE' }),
        });
        return NextResponse.json({ ok: true, action });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

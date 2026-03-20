#!/bin/bash
# Onyx Indexing Dashboard — watch indexing progress in real time
# Usage: bash infra/onyx-status.sh

while true; do
  clear
  echo "========================================="
  echo "  ONYX INDEXING STATUS - $(date +'%H:%M:%S')"
  echo "========================================="
  echo ""

  # Vespa doc count + health
  VESPA=$(curl -s "http://localhost:8081/search/?yql=select+documentid+from+danswer_chunk_nomic_ai_nomic_embed_text_v1+where+true+limit+0&hits=0" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('root',{}).get('fields',{}).get('totalCount', 0))" 2>/dev/null || echo "?")
  VESPA_HEALTH=$(curl -s "http://localhost:8081/state/v1/health" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',{}).get('code','?'))" 2>/dev/null || echo "down")
  REPLAY=$(docker logs --since 10s onyx-stack-index-1 2>&1 | grep "replay.progress" | tail -1 | python3 -c "import sys,json; line=sys.stdin.read(); start=line.find('\"progress\":'); end=line.find(',',start); print(f'{float(line[start+11:end])*100:.0f}%') if start>0 else print('')" 2>/dev/null)
  echo "  Vespa: ${VESPA} chunks | health: ${VESPA_HEALTH}${REPLAY:+ | replay: ${REPLAY}}"
  echo ""

  # Active indexing attempts
  docker exec onyx-stack-relational_db-1 psql -U postgres -d postgres -t -c \
    "SELECT '  ' || lpad(ia.id::text, 3) || ' | ' || rpad(c.source, 13) || ' | ' || rpad(ia.status, 22) || ' | batches=' || lpad(ia.completed_batches::text, 5) || ' | docs=' || lpad(coalesce(ia.total_docs_indexed, 0)::text, 6) || ' | fails=' || ia.total_failures_batch_level || CASE WHEN ia.status = 'IN_PROGRESS' THEN ' | ' || extract(epoch from (now() - ia.time_started))::int || 's' ELSE '' END FROM index_attempt ia JOIN connector_credential_pair ccp ON ia.connector_credential_pair_id = ccp.id JOIN connector c ON ccp.connector_id = c.id WHERE ia.status NOT IN ('CANCELED', 'FAILED', 'SUCCESS', 'COMPLETED_WITH_ERRORS') ORDER BY ia.id;" 2>/dev/null
  echo ""

  # Queue depth
  echo "--- Queue Depth ---"
  docker exec onyx-stack-background-1 python3 -c "
import redis
r = redis.Redis(host='cache', port=6379, db=15)
for q in ['connector_doc_fetching:2', 'connector_doc_processing:2']:
    name = q.split(':')[0].replace('connector_', '')
    print(f'  {name}: {r.llen(q)} queued')
# Also check docprocessing queues
for q in ['docprocessing:1', 'docprocessing:2']:
    count = r.llen(q)
    if count > 0:
        print(f'  {q}: {count} pending')
" 2>/dev/null
  echo ""

  # Connector status
  echo "--- Connectors ---"
  docker exec onyx-stack-relational_db-1 psql -U postgres -d postgres -t -c \
    "SELECT '  ' || rpad(c.source, 13) || ' | refresh=' || c.refresh_freq || 's | cc_pair=' || ccp.status FROM connector c JOIN connector_credential_pair ccp ON ccp.connector_id = c.id WHERE c.id != 0 ORDER BY c.id;" 2>/dev/null

  echo ""
  echo "Press Ctrl+C to stop. Refreshing every 10s..."
  sleep 10
done

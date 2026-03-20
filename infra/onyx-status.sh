#!/bin/bash
# Onyx Indexing Dashboard - watch indexing progress in real time
# Usage: bash infra/onyx-status.sh

while true; do
  clear
  echo "========================================="
  echo "  ONYX INDEXING STATUS - $(date +'%H:%M:%S')"
  echo "========================================="
  echo ""
  docker exec onyx-stack-relational_db-1 psql -U postgres -d postgres -t -c \
    "SELECT '  ' || lpad(ia.id::text, 3) || ' | ' || rpad(c.source, 13) || ' | ' || rpad(ia.status, 22) || ' | batches=' || lpad(ia.completed_batches::text, 5) || ' | docs=' || lpad(coalesce(ia.total_docs_indexed, 0)::text, 6) || ' | fails=' || ia.total_failures_batch_level || CASE WHEN ia.status = 'IN_PROGRESS' THEN ' | ' || extract(epoch from (now() - ia.time_started))::int || 's' ELSE '' END FROM index_attempt ia JOIN connector_credential_pair ccp ON ia.connector_credential_pair_id = ccp.id JOIN connector c ON ccp.connector_id = c.id WHERE ia.status NOT IN ('CANCELED', 'FAILED', 'SUCCESS', 'COMPLETED_WITH_ERRORS') ORDER BY ia.id;" 2>/dev/null
  echo ""
  echo "--- Queue Depth ---"
  docker exec onyx-stack-background-1 python3 -c "
import redis
r = redis.Redis(host='cache', port=6379, db=15)
for q in ['connector_doc_fetching:2', 'connector_doc_processing:2']:
    name = q.split(':')[0].replace('connector_', '')
    print(f'  {name}: {r.llen(q)} queued')
" 2>/dev/null
  echo ""
  echo "Press Ctrl+C to stop. Refreshing every 10s..."
  sleep 10
done

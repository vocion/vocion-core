-- ONE STATUS FIELD, BACKFILLED ONCE (Chris, 2026-10-02: "one enum list … a
-- hierarchy of status labels that run the logic for those 3 tabs").
--
-- A type that declares a status field (a property carrying `x-groups` and
-- `x-transitions`, libs/objects/statusModel.ts) gets it written on every
-- record that has none, from the fields views used to rebuild it from. From
-- here on the writers set it at each transition and every view reads it; this
-- runs once and never overwrites a status already written. The rule below
-- names a TRANSITION; the value is read from the record's own type, so a type
-- that declares no such transition gets nothing written (and reads In
-- progress, its default group).
--
-- Precedence, first match wins: a duplicate; dismissed or out of scope;
-- shipped (seen live, or not) unless reopened since; answered; deferred; a
-- merge recorded; stopped; a merge card waiting on a person; planning; the
-- tasks of a build (running, in QA, changes asked); a recommendation waiting
-- on a person; queued; triaged; new.
WITH typed AS (
  SELECT t.id AS type_id, p.key AS field, p.value -> 'x-transitions' AS tr
  FROM business_object_type t
  CROSS JOIN LATERAL jsonb_each(coalesce(t.schema -> 'properties', '{}'::jsonb)) AS p(key, value)
  WHERE jsonb_typeof(p.value -> 'x-groups') = 'array'
    AND jsonb_typeof(p.value -> 'x-transitions') = 'object'
),
pending_merge AS (
  SELECT DISTINCT a.org_id, (task.metadata ->> 'requestId')::int AS request_id
  FROM action_run a
  JOIN business_object task ON task.org_id = a.org_id AND (a.input ->> 'taskId') ~ '^[0-9]+$' AND task.id = (a.input ->> 'taskId')::int
  WHERE a.action_id = 'git.merge' AND a.status = 'pending' AND (task.metadata ->> 'requestId') ~ '^[0-9]+$'
),
facts AS (
  SELECT
    o.id, ty.field, ty.tr,
    o.metadata ->> 'state' AS state,
    o.metadata ->> 'recommendationState' AS rec,
    o.metadata -> 'recovery' ->> 'stage' AS stage,
    o.metadata -> 'recovery' -> 'log' -> -1 ->> 'text' AS last_line,
    coalesce((o.metadata ->> 'duplicateOf') ~ '^[1-9][0-9]*$', false) AS duplicate,
    CASE
      WHEN coalesce((o.metadata ->> 'shippedAt') ~ '^[0-9]{4}-', false) = false THEN false
      WHEN coalesce((o.metadata ->> 'reopenedAt') ~ '^[0-9]{4}-', false) = false THEN true
      ELSE (o.metadata ->> 'reopenedAt')::timestamptz <= (o.metadata ->> 'shippedAt')::timestamptz
    END AS shipped,
    o.metadata -> 'liveCheck' ->> 'state' AS live,
    o.metadata -> 'delivery' ->> 'mergedAt' IS NOT NULL AS merged,
    pm.request_id IS NOT NULL AS merge_waits,
    CASE WHEN jsonb_typeof(o.metadata -> 'runningTaskCount') = 'number' THEN (o.metadata ->> 'runningTaskCount')::numeric ELSE 0 END AS running,
    CASE WHEN jsonb_typeof(o.metadata -> 'awaitingReviewTaskCount') = 'number' THEN (o.metadata ->> 'awaitingReviewTaskCount')::numeric ELSE 0 END AS in_review,
    CASE WHEN jsonb_typeof(o.metadata -> 'changesRequestedTaskCount') = 'number' THEN (o.metadata ->> 'changesRequestedTaskCount')::numeric ELSE 0 END AS changes
  FROM business_object o
  JOIN typed ty ON ty.type_id = o.type_id
  LEFT JOIN pending_merge pm ON pm.org_id = o.org_id AND pm.request_id = o.id
  WHERE coalesce(o.metadata ->> ty.field, '') = ''
),
derived AS (
  SELECT id, field, tr, last_line, CASE
    WHEN duplicate THEN 'duplicateOf:*'
    WHEN rec = 'rejected' THEN 'recommendationState:rejected'
    WHEN state = 'out_of_scope' THEN 'state:out_of_scope'
    WHEN shipped AND live = 'seen' THEN 'live_seen'
    WHEN shipped THEN 'shipped'
    WHEN state = 'shipped' THEN 'state:shipped'
    WHEN state = 'answered' THEN 'state:answered'
    WHEN state = 'deferred' OR rec = 'deferred' THEN 'state:deferred'
    WHEN merged THEN 'merged'
    WHEN stage = 'stopped' THEN 'stopped'
    WHEN merge_waits THEN 'merge_waits'
    WHEN stage = 'planning' THEN 'planning'
    WHEN state = 'building' AND running > 0 THEN 'building'
    WHEN state = 'building' AND in_review > 0 THEN 'review'
    WHEN state = 'building' AND changes > 0 THEN 'qa_changes'
    WHEN state = 'building' OR stage = 'recovering' THEN 'building'
    WHEN rec = 'proposed' THEN 'recommendationState:proposed'
    WHEN state = 'in_scope' OR rec = 'approved' THEN 'state:in_scope'
    WHEN state = 'triaged' THEN 'state:triaged'
    WHEN state = 'new' THEN 'state:new'
  END AS transition
  FROM facts
)
UPDATE business_object o
SET metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
  d.field, d.tr ->> d.transition,
  d.field || 'Line', CASE WHEN d.transition IN ('stopped', 'merge_waits', 'planning', 'review', 'qa_changes', 'building') THEN to_jsonb(d.last_line) ELSE 'null'::jsonb END,
  d.field || 'At', to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
)
FROM derived d
WHERE o.id = d.id AND d.transition IS NOT NULL AND d.tr ? d.transition;

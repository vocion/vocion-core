-- The standing online evaluation configuration for one workspace.
--
-- Not a record of something that happened, unlike every other eval table here:
-- a mirror of a resource living in the customer's AWS account that is spending
-- their money right now. The row is a pointer plus whatever AWS last said,
-- refreshed in place rather than appended to.
--
-- `status` and `enabled` are deliberately two columns. The first is the
-- resource's lifecycle (CREATING, ACTIVE, UPDATE_FAILED); the second is
-- whether it is actually sampling traffic and therefore billing. An ACTIVE
-- config that is disabled costs nothing, and that is exactly the distinction
-- someone asking "is this charging me?" needs to see without reading AWS.
--
-- Unique on (org, region): a second configuration over the same traffic would
-- sample it twice and bill for it twice.
CREATE TABLE IF NOT EXISTS "eval_online_config" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "region" text NOT NULL,
  "config_id" text NOT NULL,
  "config_arn" text NOT NULL,
  "status" text DEFAULT 'CREATING' NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "sampling_percentage" integer DEFAULT 5 NOT NULL,
  "evaluator_ids" text[] DEFAULT '{}' NOT NULL,
  "output_log_group" text,
  "failure_reason" text,
  "synced_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_online_config_org_region_idx" ON "eval_online_config" USING btree ("org_id","region");

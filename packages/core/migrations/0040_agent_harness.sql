-- Agent harness config: per-agent knobs for the reusable agent harness
-- (provider selection, interrupt-gated tools, tool exclusions, max output
-- tokens). Authored as the `harness:` block in workspace agent YAML;
-- applied by workspace:apply. harness_arn holds the provisioned AWS
-- AgentCore harness ARN for provider: agentcore agents (NULL for local).
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "harness_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "harness_arn" text;

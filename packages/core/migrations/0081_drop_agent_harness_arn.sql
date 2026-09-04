-- Drop agent.harness_arn.
--
-- Added by 0040 for the `harness.provider: agentcore` path — the AWS-managed
-- agent loop, where workspace:apply provisioned a harness per agent and stored
-- its ARN here for the invoke adapter to read. That path is gone: we run our
-- own deepagents loop, hosted on AgentCore Runtime as a container, so there is
-- no managed harness to provision and nothing writes or reads this column.
--
-- No agent ever ran on that provider, so no data is being discarded.
ALTER TABLE "agent" DROP COLUMN IF EXISTS "harness_arn";

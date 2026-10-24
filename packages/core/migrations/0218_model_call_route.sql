-- Dynamic routing beyond the factory (ADR 0006, phase 2). Every model call an
-- agent turn makes carries how that turn's model and effort were chosen:
-- `route_selector` is `jev` (Jev picked) or `configured` (Jev was asked, or
-- tried, and the agent's configured model ran); `route_detail` is the decision
-- (choice, confidence, reason, Jev version, latency, key scope, provider,
-- fallback reason; never a key). Both stay null when no Jev key is configured,
-- so a workspace without one writes exactly the rows it wrote before.
ALTER TABLE "model_call" ADD COLUMN IF NOT EXISTS "route_selector" text;
--> statement-breakpoint
ALTER TABLE "model_call" ADD COLUMN IF NOT EXISTS "route_detail" jsonb;

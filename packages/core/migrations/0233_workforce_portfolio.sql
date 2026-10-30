CREATE TABLE "workforce_portfolio_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"event_key" text NOT NULL,
	"command_hash" text NOT NULL,
	"version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workforce_portfolio_link" (
	"org_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"item_id" text NOT NULL,
	CONSTRAINT "workforce_portfolio_link_org_id_item_id_pk" PRIMARY KEY("org_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "workforce_portfolio" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workforce_portfolio_event" ADD CONSTRAINT "workforce_portfolio_event_workflow_id_workforce_portfolio_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workforce_portfolio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_portfolio_link" ADD CONSTRAINT "workforce_portfolio_link_workflow_id_workforce_portfolio_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workforce_portfolio"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_portfolio_link" ADD CONSTRAINT "workforce_portfolio_link_item_id_workforce_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."workforce_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_portfolio_event_key_idx" ON "workforce_portfolio_event" USING btree ("org_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workforce_portfolio_event_version_idx" ON "workforce_portfolio_event" USING btree ("workflow_id","version");--> statement-breakpoint
CREATE INDEX "workforce_portfolio_link_workflow_idx" ON "workforce_portfolio_link" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workforce_portfolio_org_idx" ON "workforce_portfolio" USING btree ("org_id");
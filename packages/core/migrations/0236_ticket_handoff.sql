CREATE TABLE "ticket_handoff" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"conversation_id" integer NOT NULL,
	"source_slug" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"caller_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_body" text,
	"ticket_id" bigint,
	"ticket_status" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ticket_handoff" ADD CONSTRAINT "ticket_handoff_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_handoff_open_conversation_uq" ON "ticket_handoff" USING btree ("org_id","conversation_id") WHERE "ticket_handoff"."status" = 'open';
--> statement-breakpoint
CREATE INDEX "ticket_handoff_ticket_idx" ON "ticket_handoff" USING btree ("org_id","source_slug","ticket_id");

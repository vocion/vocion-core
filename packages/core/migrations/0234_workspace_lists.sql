CREATE TABLE "list_record" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"change" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_list" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"scope" text DEFAULT 'personal' NOT NULL,
	"title" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"fields" jsonb NOT NULL,
	"views" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_list_scope_check" CHECK ("workspace_list"."scope" in ('personal', 'workspace'))
);
--> statement-breakpoint
ALTER TABLE "list_record" ADD CONSTRAINT "list_record_list_id_workspace_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."workspace_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_revision" ADD CONSTRAINT "list_revision_list_id_workspace_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."workspace_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_list" ADD CONSTRAINT "workspace_list_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_list" ADD CONSTRAINT "workspace_list_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_record_list_idx" ON "list_record" USING btree ("list_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "list_revision_version_idx" ON "list_revision" USING btree ("list_id","version");--> statement-breakpoint
CREATE INDEX "workspace_list_scope_idx" ON "workspace_list" USING btree ("project_id","scope","owner_id");
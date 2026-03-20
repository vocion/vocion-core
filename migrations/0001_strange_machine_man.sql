CREATE TABLE "business_object" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type_id" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"summary" text,
	"summary_generated_at" timestamp,
	"created_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_object_type" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon" text,
	"schema" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_document_link" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_id" integer NOT NULL,
	"onyx_document_id" text NOT NULL,
	"source_type" text NOT NULL,
	"semantic_identifier" text,
	"link" text,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_object" ADD CONSTRAINT "business_object_type_id_business_object_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."business_object_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_document_link" ADD CONSTRAINT "object_document_link_object_id_business_object_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."business_object"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_object_type_org_slug_idx" ON "business_object_type" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "object_document_link_unique_idx" ON "object_document_link" USING btree ("object_id","onyx_document_id");
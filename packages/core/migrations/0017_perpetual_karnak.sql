CREATE TABLE "source_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"event" text NOT NULL,
	"install_id" integer,
	"credential_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_credential" (
	"id" serial PRIMARY KEY NOT NULL,
	"install_id" integer NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"dek_id" integer NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp,
	"last_refreshed_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_definition" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" text NOT NULL,
	"auth_type" text NOT NULL,
	"scope" text NOT NULL,
	"plugin_id" text NOT NULL,
	"brand" jsonb DEFAULT '{}'::jsonb,
	"oauth_scopes" jsonb DEFAULT '[]'::jsonb,
	"discoverable" text DEFAULT 'true' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_dek" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kms_key_arn" text,
	"wrapped_dek" text NOT NULL,
	"algorithm" text DEFAULT 'AES_256_GCM' NOT NULL,
	"rotated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_install" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_slug" text NOT NULL,
	"installed_by" text NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"disabled" text DEFAULT 'false' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_credential" ADD CONSTRAINT "source_credential_install_id_source_install_id_fk" FOREIGN KEY ("install_id") REFERENCES "public"."source_install"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_credential" ADD CONSTRAINT "source_credential_dek_id_source_dek_id_fk" FOREIGN KEY ("dek_id") REFERENCES "public"."source_dek"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_definition_slug_idx" ON "source_definition" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "source_dek_org_active_idx" ON "source_dek" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_install_org_slug_idx" ON "source_install" USING btree ("org_id","source_slug");
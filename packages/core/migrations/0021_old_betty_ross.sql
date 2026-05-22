ALTER TABLE "agent_budget" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "business_object" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "business_object_type" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "context_version" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "eval_dataset" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "feedback_job" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "learning" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "learning_step" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "skill_run" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "skill" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "playbook" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "source_audit" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "source_dek" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "source_install" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "agent_budget" ADD CONSTRAINT "agent_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_object" ADD CONSTRAINT "business_object_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_object_type" ADD CONSTRAINT "business_object_type_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_version" ADD CONSTRAINT "context_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_dataset" ADD CONSTRAINT "eval_dataset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_job" ADD CONSTRAINT "feedback_job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_source" ADD CONSTRAINT "knowledge_source_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning" ADD CONSTRAINT "learning_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_step" ADD CONSTRAINT "learning_step_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_run" ADD CONSTRAINT "skill_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook" ADD CONSTRAINT "playbook_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_audit" ADD CONSTRAINT "source_audit_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_dek" ADD CONSTRAINT "source_dek_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_install" ADD CONSTRAINT "source_install_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
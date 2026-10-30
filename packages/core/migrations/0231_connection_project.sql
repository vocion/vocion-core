-- A connection can belong to one project (`services/connect/connectionScope.ts`).
-- `knowledge_source.project_id` is already taken: in code a "project" is the
-- workspace, so the person's Project (a `business_object` of type `data_room`)
-- is named by its internal type, as everywhere else in core.
--
-- Null is the whole workspace, which is every connection made before this.
-- Set, only work for that project uses the connection: its token, its kept
-- sign-in, its tools and what it synced.
--
-- `on delete cascade`: a connection that belonged to a project goes with the
-- project. `set null` would widen it to the whole workspace, which is the one
-- thing this column exists to prevent.
--
-- No index: a workspace holds tens of connections, read whole.
ALTER TABLE "knowledge_source" ADD COLUMN IF NOT EXISTS "data_room_id" integer REFERENCES "business_object"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- The project a mission run works for, when it was started for one: its turns
-- use that project's connections, through every pause and resume.
ALTER TABLE "mission_run" ADD COLUMN IF NOT EXISTS "data_room_id" integer REFERENCES "business_object"("id") ON DELETE SET NULL;

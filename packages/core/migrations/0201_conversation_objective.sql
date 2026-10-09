-- What a conversation is in the middle of: one objective (setting up an app's
-- plugin) and whether the person stopped it. Its steps and progress are read
-- live from the plugin's setup, never stored here (libs/objectives/objective.ts).
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "objective" jsonb;

-- A conversation asked on someone's behalf, linked to the one that asked.
--
-- A person's own assistant lives in their personal workspace. When it asks a
-- shared workspace something (`ask_workspace`), the question and the answer are
-- that workspace's record: a conversation in it, created by the person, with
-- surface 'assistant'. This column says which conversation in the personal
-- workspace it was asked from, so the assistant's thread can show where its
-- answer came from and the workspace's members can see it was asked by an
-- assistant rather than typed in their own chat.
--
-- Expand-only: one nullable column, no default, no index. Every existing row
-- reads NULL, which is what they are — asked by a person directly. The
-- reference is ON DELETE SET NULL because the child is the workspace's record:
-- the person deleting their own thread must not delete the work that landed in
-- a shared workspace. The parent may sit in a different workspace (it usually
-- does); the parent's privacy is kept by the reads (`getConversation` with a
-- viewer refuses another person's personal workspace), not by this column.
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "parent_conversation_id" integer;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_parent_conversation_id_fk') THEN
    ALTER TABLE "conversation"
      ADD CONSTRAINT "conversation_parent_conversation_id_fk"
      FOREIGN KEY ("parent_conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL;
  END IF;
END $$;

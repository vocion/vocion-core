-- A chat turn is a record from its first token (backlog 056): the assistant
-- row is written when the turn starts, `status = 'running'`, with its stream
-- id, the process answering it and the request to answer it again. A restart
-- leaves the row behind; the next process finishes it (services/chat/turnRecovery.ts).
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "turn_json" jsonb;

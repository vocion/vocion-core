-- Which agent spoke an assistant turn (backlog 009).
--
-- The transcript's "via <specialist>" eyebrow used to be stamped on the client
-- from the composer's tags before the turn ran, and a reloaded thread had no
-- attribution at all. The runtime knows which agent it ran; it writes that
-- slug here, and the label reads it. Nullable: user rows carry none, and every
-- turn written before this column stays unattributed rather than guessed at.
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "agent_slug" text;

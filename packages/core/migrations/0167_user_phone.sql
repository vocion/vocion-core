-- A person's mobile number in E.164, set on their profile or by telling the agent in chat. A text
-- from this number is theirs: the SMS channel answers it, and a reply decides a card as them.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone" text;

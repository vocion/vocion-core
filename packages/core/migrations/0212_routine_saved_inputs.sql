-- A routine's saved inputs (services/routines/RoutineService.ts): the inputs
-- every run shares (the sign-in, the campaign), saved once by its expert so a
-- batch asked for in chat needs no password typed into the conversation.
-- `{ names, sealed }`: the names in the clear for the page, the values sealed
-- under the workspace's key.
ALTER TABLE "routine" ADD COLUMN IF NOT EXISTS "saved_inputs" jsonb;

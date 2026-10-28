-- What an answer does, said on the ask itself. An ask whose answer resumes
-- work (an SEO keyword plan: approve and the briefs start) carries one line
-- per answer — `{ "onApprove": "...", "onRevise": "...", "onReject": "..." }` —
-- and the decision sheet shows it in place of the generic "Your answer is
-- recorded…; nothing runs on its own", which was wrong for those asks.
-- Nullable, added only: every ask filed before this reads as it did.
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "outcomes" jsonb;

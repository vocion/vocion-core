-- A workflow says what each of its runs is called (`runLabel:` in workflow.yaml),
-- interpolated from the run's input when it starts. Additive and nullable: a
-- workflow without one keeps its name.
ALTER TABLE "workflow" ADD COLUMN IF NOT EXISTS "run_label" text;

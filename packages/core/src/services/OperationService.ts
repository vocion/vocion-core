/**
 * OperationService — canonical name for what was historically called
 * "SkillService". An Operation is a typed, Zod-validated, single LLM
 * call (or plugin invocation) with audit + approval gating.
 *
 * The actual implementation still lives in `./SkillService.ts` for
 * back-compat with the ~12 existing consumers. This file is the v0.2
 * public name. New code should import from here. The shim will be
 * collapsed (and SkillService removed) in a future major release once
 * all consumers have migrated.
 *
 * Naming distinction (v0.2):
 *   - **Operation** — typed LLM call + plugin (this file, prompt+plugin
 *     execution, `operation`/`skill` table, approval gates, feedback).
 *   - **Playbook** — markdown + YAML frontmatter loaded into an agent's
 *     virtual filesystem and read on demand (introduced in Phase 3).
 */

export * from './SkillService';

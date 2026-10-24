# ADR 0007 — Jev judges duplicates first

- **Status:** accepted 2026-10-23
- **Date:** 2026-10-23
- **Owners:** Jamie Schiesel (direction: a cheaper, faster yes/no when a record comes in; agents
  propose, people decide; Vocion never depends on Jev)
- **Related:** ADR 0006 (Jev, its key and its roadmap), `services/objects/duplicateCheck.ts`,
  `services/objects/jevDuplicate.ts`, `services/routing/jev.ts` (`askYesNo`), migration
  `0219_record_duplicate_check.sql`

## Context

A record whose type declares `x-duplicate-check` is read when it is filed: a deterministic
shortlist (same `within` values, open or recently settled, trigram overlap first, then the
newest), then one classifier call that names the duplicate with a confidence. At or above the
type's bar the link is written through `objects.update_meta`: done for you, with Undo, on the
trust ladder. Every create path (app, API, chat, agents, list intake, scripts) raises
`object.created`, so this is the one place a "new record" is seen. Today the factory's request
intake runs the check. Other dedupe is deterministic and stays as it is: an external key on API
upserts, `dedupOn` on proposed candidates, identity match on list intake, rule duplicates in
feedback.

Jev answers yes/no questions (`noul`) with a probability, in about 100 ms, for a fraction of a
classifier call.

## Decision

1. **Opt-in, twice.** Jev is asked only when the workspace sets `defaults.jev.duplicateCheck:
   true` (stored on `project.jev`) **and** a Jev key resolves the way routing's does (workspace,
   then instance). Otherwise the check runs exactly as before and writes nothing new.
2. **A cascade, with code deciding.**
   1. *Exact match*: the same title and compared text after folding case, accents, punctuation
      and spacing is a duplicate, and nothing is asked.
   2. *Jev*: one call with one yes/no per shortlisted record. Exactly one at or above the type's
      bar is the duplicate. All at or below 0.3 means none is (TypeSafe's suggested band).
   3. *The classifier* decides everything else: unsure, two at the bar, a missing answer, an
      error, a timeout, or the breaker open (three failures in a row, shared with routing).
3. **Nothing new is written to records.** Whatever judges, the link goes through the same
   proposal as before: done for you with Undo, or a card where the workspace holds the kind at a
   person. Nothing is dropped or merged.
4. **Jev reads the minimum.** The type's label, each title (200 characters), the compared
   fields (1,000 for the new record, 400 for each existing one) and whether each is open or
   closed. No ids, no people, no dates. Settled windows and `within` filters stay in code.
5. **Every judge asked leaves a row** in `record_duplicate_check`: judge (`exact`, `jev`,
   `model`), verdict, duplicate, confidence, a SHA-256 of what was asked, latency, model, key
   scope, provider, input tokens, why the next judge was asked, and whether it linked. No text,
   no key. No UI reads it yet (ADR 0006's roadmap, "measuring Jev as a whole").
6. **Any type can opt in.** The built-in job `record-duplicate-check` runs the check on
   `object.created` for a type whose intake does not already run it.

## Consequences

- For an opted-in workspace most checks end at Jev, and the classifier runs only for the
  unsure ones. The rows let a later review compare Jev's verdicts with the classifier's and
  with what people undid.
- The opt-in lives in workspace.yaml for now. The settings card for Jev keys is being
  redesigned; a toggle there comes with that work, with this copy: "Duplicate check: sends new
  records' titles and key fields, shortened, to TypeSafe."

## Rollback

Remove `defaults.jev` (or the key) and apply: the check is the classifier alone again. The table
and column are additive.

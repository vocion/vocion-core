/**
 * The merge action's id and the confidence QA's approve files it at, named
 * once in a leaf with no imports, so a client-safe module (the feature report,
 * drawn in the browser) can read them without pulling the action registry and
 * its database in (`libs/actions/factory.ts` defines the action itself).
 */

/** The merge's action id: what reads a merge's state or its trust rule takes it from here. */
export const MERGE_ACTION_ID = 'git.merge';

/** What the merge card is filed at, by QA's approve (`record_verdict`) — the confidence its trust rule is read at. */
export const MERGE_PROPOSAL_CONFIDENCE = 0.9;

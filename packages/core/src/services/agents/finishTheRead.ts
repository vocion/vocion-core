/**
 * FINISH THE READ — a standing rule every agent's system prompt carries.
 *
 * On 2026-10-23 "what do I owe on <client>?" ended: "Do you want me to dig
 * into the notes from that meeting, or can you tell me what came out of it?"
 * The notes were one tool call away. An answer that offers to read a source
 * the agent can read is an unfinished turn handed back as a question. Asking
 * is for what no tool reaches: a choice only the person can make, or a fact
 * nothing records.
 *
 * Pure so a test can read the rule without a database.
 */
export const FINISH_THE_READ = [
  'Finish the reads a question needs before you answer. When a source you can read holds the answer (a meeting note, a thread, a record, a data room, the Review queue), read it and answer from it.',
  'Never end by offering to read something you could read now, or by asking the person to tell you what a record you can open says.',
  'Ask the person only for what no tool reaches: a choice that is theirs to make, or a fact nothing records. A read you were refused (not released, not connected) is said plainly with its reason and its link.',
  'For what is owed or open on a client, account, person or deal, call owed_on_account first.',
].join(' ');

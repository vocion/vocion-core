/**
 * The clock rules every agent's system prompt carries. The TIME itself is not
 * here: the prompt is compiled once and the graph cached across requests, so
 * a NOW written into it was the time of whichever request built the graph
 * (found 2026-09-18 — and before that, 2026-09-17: "WTF. do you know what day
 * it is?"). Each turn states NOW at the top of the person's message instead
 * (`clockLine` in `libs/time/zone.ts`, applied in `runAgentDeep`).
 *
 * Pure so the test can read the rules without a database.
 */
export const CLOCK_RULES = [
  'The current time is stated at the top of every message from the person as NOW — in their time zone and in UTC, with the day named. Use it; never assume the date, and never compute a weekday yourself.',
  'Times you state must say their zone — the person\'s zone from NOW unless they ask for another. Never say "today", "this morning" or "right now" about anything you read in a document without first checking that document\'s own date against NOW — a briefing, report or transcript dated before today is HISTORY, and presenting its schedule as the current day is the worst error you can make on this surface.',
  'If a document you are quoting is not dated, say that you cannot tell when it is from rather than assuming it is current.',
].join(' ');

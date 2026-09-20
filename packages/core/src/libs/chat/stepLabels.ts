/**
 * What a tool step is called, for a person watching.
 *
 * "Used get_brand" names the mechanism; "Read the brand guide" names the
 * act (Chris, 2026-09-18, against the Claude app's transcript). Two tenses
 * per step — present while it runs, past once it lands — so the live line
 * and the finished trace agree.
 *
 * This module is the DETERMINISTIC half, shared by the server (fallback
 * when no model is available) and the client (the same words on reload).
 * The model half lives in `services/agents/stepLabeler.ts`, which asks a
 * cheap model the same question given only the call — never the result —
 * so a label can describe an action and cannot claim an outcome.
 */

export type StepLabels = {
  /** Present participle, ends with an ellipsis: `Reading the brand guide…` */
  running: string;
  /** Past tense: `Read the brand guide` */
  done: string;
};

/** Hand-written names for the tools whose humanised name would mislead or read badly. */
const KNOWN: Record<string, StepLabels> = {
  get_brand: { running: 'Reading the brand guide…', done: 'Read the brand guide' },
  brand_lookup: { running: 'Looking up the brand…', done: 'Looked up the brand' },
  search_knowledge: { running: 'Searching sources…', done: 'Searched sources' },
  web_search: { running: 'Searching the web…', done: 'Searched the web' },
  fetch_url: { running: 'Reading a web page…', done: 'Read a web page' },
  fetch_image: { running: 'Fetching the image…', done: 'Fetched the image' },
  crawl_site: { running: 'Crawling the site…', done: 'Crawled the site' },
  lookup_objects: { running: 'Looking up records…', done: 'Looked up records' },
  render_markdown: { running: 'Writing the document…', done: 'Wrote the document' },
  render_document: { running: 'Rendering the document…', done: 'Rendered the document' },
  edit_document: { running: 'Editing the document…', done: 'Edited the document' },
  read_document: { running: 'Reading the document…', done: 'Read the document' },
  verify_document: { running: 'Verifying the document…', done: 'Verified the document' },
  red_team_document: { running: 'Reading it as the buyer…', done: 'Read it as the buyer' },
  export_document_pdf: { running: 'Exporting the PDF…', done: 'Exported the PDF' },
  render_table: { running: 'Building the table…', done: 'Built the table' },
  render_chart: { running: 'Drawing the chart…', done: 'Drew the chart' },
  render_record: { running: 'Laying out the record…', done: 'Laid out the record' },
  create_artifact: { running: 'Creating the artifact…', done: 'Created the artifact' },
  update_artifact: { running: 'Updating the artifact…', done: 'Updated the artifact' },
  read_artifact: { running: 'Reading the artifact…', done: 'Read the artifact' },
  list_wiki_pages: { running: 'Listing the wiki…', done: 'Listed the wiki' },
  read_wiki_page: { running: 'Reading the wiki…', done: 'Read the wiki' },
  write_wiki_page: { running: 'Writing to the wiki…', done: 'Wrote to the wiki' },
  list_capabilities: { running: 'Checking what can be turned on…', done: 'Checked what can be turned on' },
  get_briefing: { running: 'Reading the briefing…', done: 'Read the briefing' },
  refresh_briefing: { running: 'Refreshing the briefing…', done: 'Refreshed the briefing' },
  publish_briefing: { running: 'Publishing the briefing…', done: 'Published the briefing' },
  calendar_events: { running: 'Reading the calendar…', done: 'Read the calendar' },
  get_gmail_thread: { running: 'Reading the email thread…', done: 'Read the email thread' },
  get_zoom_transcript: { running: 'Reading the call transcript…', done: 'Read the call transcript' },
  read_discovery_transcript: { running: 'Reading the call transcript…', done: 'Read the call transcript' },
  list_data_rooms: { running: 'Listing the data rooms…', done: 'Listed the data rooms' },
  read_data_room: { running: 'Reading the data room…', done: 'Read the data room' },
  create_data_room: { running: 'Opening a data room…', done: 'Opened a data room' },
  update_data_room: { running: 'Updating the data room…', done: 'Updated the data room' },
  file_to_data_room: { running: 'Filing into the data room…', done: 'Filed into the data room' },
  unfile_from_data_room: { running: 'Taking it out of the data room…', done: 'Took it out of the data room' },
  add_open_item: { running: 'Adding an open item…', done: 'Added an open item' },
  propose_action: { running: 'Proposing an action…', done: 'Proposed an action' },
  recommend_action: { running: 'Preparing a recommendation…', done: 'Recommended an action' },
  request_human_review: { running: 'Requesting a decision…', done: 'Requested a decision' },
  remember_preference: { running: 'Noting the preference…', done: 'Noted the preference' },
  add_learning: { running: 'Recording the rule…', done: 'Recorded the rule' },
  get_learnings: { running: 'Reading the team’s rules…', done: 'Read the team’s rules' },
  page_context: { running: 'Reading the page…', done: 'Read the page' },
  run_code: { running: 'Running code…', done: 'Ran code' },
  generate_image: { running: 'Generating an image…', done: 'Generated an image' },
  task: { running: 'Handing off to a specialist…', done: 'Delegated to a specialist' },
};

/** Leading verb of a snake_case tool → its two tenses. */
const VERBS: Record<string, [running: string, done: string]> = {
  get: ['Reading', 'Read'],
  read: ['Reading', 'Read'],
  list: ['Listing', 'Listed'],
  search: ['Searching', 'Searched'],
  find: ['Finding', 'Found'],
  lookup: ['Looking up', 'Looked up'],
  fetch: ['Fetching', 'Fetched'],
  count: ['Counting', 'Counted'],
  render: ['Rendering', 'Rendered'],
  draw: ['Drawing', 'Drew'],
  write: ['Writing', 'Wrote'],
  edit: ['Editing', 'Edited'],
  verify: ['Verifying', 'Verified'],
  export: ['Exporting', 'Exported'],
  create: ['Creating', 'Created'],
  update: ['Updating', 'Updated'],
  save: ['Saving', 'Saved'],
  file: ['Filing', 'Filed'],
  add: ['Adding', 'Added'],
  remove: ['Removing', 'Removed'],
  publish: ['Publishing', 'Published'],
  refresh: ['Refreshing', 'Refreshed'],
  propose: ['Proposing', 'Proposed'],
  recommend: ['Recommending', 'Recommended'],
  request: ['Requesting', 'Requested'],
  queue: ['Queueing', 'Queued'],
  remember: ['Remembering', 'Remembered'],
  classify: ['Classifying', 'Classified'],
  match: ['Matching', 'Matched'],
  crawl: ['Crawling', 'Crawled'],
  generate: ['Generating', 'Generated'],
  check: ['Checking', 'Checked'],
  record: ['Recording', 'Recorded'],
  reconcile: ['Reconciling', 'Reconciled'],
  enrich: ['Enriching', 'Enriched'],
  run: ['Running', 'Ran'],
  next: ['Picking', 'Picked'],
  freshen: ['Refreshing', 'Refreshed'],
};

/** Vendor prefixes that name WHERE, not WHAT: `hubspot_get_contact` → "Reading the HubSpot contact". */
const VENDORS: Record<string, string> = { hubspot: 'HubSpot', apollo: 'Apollo', zoom: 'Zoom', gmail: 'Gmail', granola: 'Granola', slack: 'Slack' };

/**
 * A deterministic name for a tool step. Never wrong, occasionally plain:
 * the model half improves on it when it can.
 * @param tool - The raw tool name, e.g. `hubspot_get_contact`.
 */
export function fallbackStepLabels(tool: string): StepLabels {
  const known = KNOWN[tool];
  if (known) {
    return known;
  }
  const words = tool.split(/[-_]/).filter(Boolean).map(w => w.toLowerCase());
  let vendor: string | undefined;
  if (words.length > 1 && VENDORS[words[0]!]) {
    vendor = VENDORS[words.shift()!];
  }
  const verbEntry = words.length > 0 ? VERBS[words[0]!] : undefined;
  const [running, done] = verbEntry ?? ['Running', 'Ran'];
  const rest = verbEntry ? words.slice(1) : words;
  const objectWords = rest.join(' ');
  const object = [vendor, objectWords].filter(Boolean).join(' ');
  const noun = object ? ` the ${object}` : '';
  return { running: `${running}${noun}…`, done: `${done}${noun}` };
}

/**
 * The label a step shows for its status, when a pair of labels is known.
 * @param labels - The pair.
 * @param status - The step's status.
 */
export function stepLabelFor(labels: StepLabels, status: 'start' | 'progress' | 'done' | 'error'): string {
  if (status === 'error') {
    return `${labels.done} — failed`;
  }
  return status === 'done' ? labels.done : labels.running;
}

/**
 * The running label with the step's own progress note on the end —
 * `Building the document… sheet 7 of 12`.
 *
 * "'working…' isn't much info" (Chris, twice, 2026-09-18): a twelve-sheet
 * render is one step line for a minute, so the step says where it has got to.
 * The note is composed by whatever is doing the work and is always a plain
 * phrase about the WORK, never a claim about the result — same rule the
 * labels themselves follow.
 *
 * Pure and additive: the label is never rewritten, so a note that stops
 * arriving leaves the line reading exactly as it did before.
 * @param label - The step's label for its current status.
 * @param progress - The note, e.g. `sheet 7 of 12`. Absent leaves the label alone.
 */
export function stepProgressLabel(label: string, progress?: string | null): string {
  const note = progress?.trim();
  return note ? `${label} ${note}` : label;
}

/** Words a label may not use: they claim an outcome the call alone cannot know. */
const OUTCOME_WORDS = /\b(?:found|successfully|succeeded|confirmed|verified that|no issues|completed|finished|returned|\d+ (?:results?|records?|sources?|matches))\b/i;

/**
 * Whether a model-written pair is safe to show: short, two tenses, and
 * describing the act rather than its result.
 * @param candidate - Whatever the model returned, parsed.
 */
export function isSafeStepLabels(candidate: unknown): candidate is StepLabels {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const { running, done } = candidate as Record<string, unknown>;
  if (typeof running !== 'string' || typeof done !== 'string') {
    return false;
  }
  const ok = (s: string) => s.trim().length >= 3 && s.trim().length <= 60 && !OUTCOME_WORDS.test(s) && !/[{}[\]<>]/.test(s);
  return ok(running) && ok(done) && !/…\s*$/.test(done);
}

/**
 * Normalise a model pair: trim, make sure the running form ends in an ellipsis.
 * @param labels - A pair that passed `isSafeStepLabels`.
 */
export function normalizeStepLabels(labels: StepLabels): StepLabels {
  const running = labels.running.trim().replace(/[.…]+$/, '');
  const done = labels.done.trim().replace(/[.…]+$/, '');
  return { running: `${running}…`, done };
}

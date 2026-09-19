/**
 * Where to do X in Vocion — the one table of "go here, click this".
 *
 * On 2026-09-18 the workspace lead answered a Zoom scope error with eight
 * paragraphs of instructions and no link: the person had to guess which page
 * in Vocion held the Zoom connector and what to press when they got there.
 * The agent knew the fact (a credential needs re-authorising) but not the
 * place. This table is the place — the exact relative route and the one
 * line that says what to do on it — so an answer can carry the link inline
 * and the chat renders it as a chip (`features/dashboard/chat/links.ts`).
 *
 * Kept as data, not prose in a prompt (CLAUDE.md, structural over
 * prompting): the `where_to` tool reads it, and a test pins every route to
 * the navigation registry so a moved page cannot leave a dead link here.
 */

export type WhereToIntent
  = | 'connect-source'
    | 'sync-source'
    | 'reconnect-zoom'
    | 'fix-credential'
    | 'add-tool-key'
    | 'read-briefing'
    | 'review-proposals'
    | 'review-queue'
    | 'adopt-learning'
    | 'open-data-rooms'
    | 'open-data-room'
    | 'open-connector'
    | 'browse-artifacts'
    | 'search-knowledge'
    | 'manage-agents'
    | 'manage-missions'
    | 'manage-automations'
    | 'manage-plugins'
    | 'run-evals'
    | 'invite-member'
    | 'api-token'
    | 'model-settings'
    | 'workspace-settings'
    | 'all-conversations'
    | 'new-chat';

export type WhereTo = {
  intent: WhereToIntent;
  /** Short verb phrase: "Connect a system". */
  label: string;
  /** Relative route. `{slug}` / `{id}` mark a segment the caller fills in. */
  path: string;
  /** What to do once there — one sentence, the click named. */
  instruction: string;
  /** Words a person or a model might use for this intent. */
  keywords: readonly string[];
};

const T = (
  intent: WhereToIntent,
  label: string,
  path: string,
  instruction: string,
  keywords: readonly string[],
): WhereTo => ({ intent, label, path, instruction, keywords });

export const WHERE_TO: readonly WhereTo[] = [
  T('connect-source', 'Connect a system', '/dashboard/connectors', 'Find the system in the list and click Connect; a connected row expands to show its sync history, size and any missing scopes.', ['connector', 'connect', 'integration', 'source', 'ingest', 'gmail', 'drive', 'hubspot', 'slack', 'notion', 'calendar', 'granola']),
  T('sync-source', 'Sync a connected system now', '/dashboard/connectors', 'Expand the connected row and click Sync now; the run\'s progress and its last result show in the same row.', ['sync', 'refresh', 'resync', 'reindex']),
  T('reconnect-zoom', 'Re-authorise Zoom', '/dashboard/connectors', 'Expand Zoom: the row lists the scopes it needs and marks the ones the last error said were missing. Add those scopes to the Zoom Marketplace app, save, then click Reconnect here.', ['zoom', 'scope', 'scopes', '4711', 'recording', 'transcript', 'reauthorize', 'reauthorise']),
  T('fix-credential', 'Fix a revoked or expired credential', '/dashboard/connectors', 'The row says "Credential revoked" or "expired"; expand it and click Reconnect to store a fresh one.', ['credential', 'revoked', 'expired', 'token', 'reconnect', 'key']),
  T('add-tool-key', 'Add a vendor key for a tool', '/dashboard/tools', 'Open the provider (Tavily, Brave, Firecrawl, OpenAI, Anthropic) and use Save key; the catalogue then shows it as ready.', ['api key', 'vendor', 'provider', 'tavily', 'brave', 'firecrawl', 'openai', 'anthropic', 'tool key']),
  T('read-briefing', 'Read the latest briefing', '/dashboard/briefings', 'The newest brief is at the top; each item carries its date and the evidence it rests on.', ['briefing', 'brief', 'morning', 'rollup', 'report']),
  T('review-proposals', 'Approve or reject proposed actions', '/dashboard/inbox?kind=proposal', 'Each card says why it is there and what is recommended; Approve executes it, Reject teaches the team with your note.', ['proposal', 'approve', 'reject', 'proposed', 'hubspot update', 'send email', 'queue']),
  T('review-queue', 'Open the review queue', '/dashboard/inbox', 'Everything waiting on a person, newest first; open a card to decide.', ['review', 'inbox', 'waiting', 'decision', 'ask', 'hitl']),
  T('adopt-learning', 'Adopt or reject a learning', '/dashboard/learnings', 'Pending candidates are listed with who said it and how often; Adopt makes it a rule, Reject drops it.', ['learning', 'rule', 'candidate', 'adopt', 'teach', 'feedback']),
  T('open-data-rooms', 'Open the data rooms', '/dashboard/rooms', 'One room per engagement: status, sources, decision logs and open items. Open a room to read or export it.', ['data room', 'rooms', 'engagement', 'client', 'deal room']),
  T('open-data-room', 'Open one data room', '/dashboard/rooms/{id}', 'The room\'s status, cast, sources and open items; Download context exports it, Draft a document starts a proposal from it.', ['room', 'engagement', 'proposal']),
  T('open-connector', 'Open one connector\'s detail', '/dashboard/connectors/{slug}', 'The connector\'s configuration (secrets redacted), its sync checkpoint and what it has ingested.', ['connector detail', 'checkpoint', 'configuration']),
  T('browse-artifacts', 'Find an artifact', '/dashboard/artifacts', 'Every document, table and chart an agent or a person made, with versions; open one to read, edit or export it.', ['artifact', 'document', 'table', 'chart', 'version', 'export', 'pdf']),
  T('search-knowledge', 'Search the knowledge base', '/dashboard/search', 'Type a question or a name; results cite the connected system they came from.', ['search', 'find', 'knowledge', 'retrieval']),
  T('manage-agents', 'See the team and its agents', '/dashboard/agents', 'Each agent\'s prompt, skills and tools; edits are made in the workspace repo, applied here.', ['agent', 'agents', 'team', 'prompt', 'skills']),
  T('manage-missions', 'Open the missions', '/dashboard/missions', 'A mission is a standing goal; open one for its runs, notes and what it last did.', ['mission', 'goal', 'runs']),
  T('manage-automations', 'Open the automations', '/dashboard/automation', 'Schedules and triggers, each with its next run; a paused one says so.', ['automation', 'schedule', 'cron', 'trigger', 'when']),
  T('manage-plugins', 'Turn a plugin on or off', '/dashboard/marketplace', 'The Plugins section of the Marketplace lists each plugin — wiki, data rooms, proposals — with what it adds; Turn on edits workspace.yaml and applies it.', ['plugin', 'plugins', 'module', 'app', 'enable', 'turn on', 'install', 'marketplace', 'wiki', 'data rooms', 'proposals', 'capability']),
  T('run-evals', 'Run or read an eval', '/dashboard/evals', 'Datasets per agent with pass rates; Compare models runs the same set on two models.', ['eval', 'evaluation', 'dataset', 'pass rate', 'compare models']),
  T('invite-member', 'Invite a teammate', '/dashboard/members', 'Invite by email and pick a role; the invite lands in their inbox.', ['invite', 'member', 'teammate', 'user', 'role', 'admin']),
  T('api-token', 'Create an API token', '/dashboard/developers', 'Mint a token and copy it once; it authenticates outside callers to this workspace.', ['api', 'token', 'developer', 'bearer', 'integration']),
  T('model-settings', 'Change the models agents use', '/dashboard/models', 'Which model each role runs on and the vendor keys behind them.', ['model', 'sonnet', 'opus', 'haiku', 'bedrock', 'openai', 'llm']),
  T('workspace-settings', 'Open the workspace settings', '/dashboard/workspace', 'The workspace-as-code manifest, its version and what is pending apply.', ['workspace', 'settings', 'manifest', 'apply', 'configuration']),
  T('all-conversations', 'Find an earlier conversation', '/dashboard/conversations', 'Every thread, searchable by title or content; open one to continue it.', ['conversation', 'history', 'thread', 'chat history', 'earlier']),
  T('new-chat', 'Start a new chat', '/dashboard/chat?new=1', 'A fresh thread with the workspace; ⌘⇧O does the same from anywhere.', ['chat', 'new chat', 'ask']),
];

/**
 * The entry for an intent, or null.
 * @param intent - A known intent id.
 */
export function whereTo(intent: string): WhereTo | null {
  return WHERE_TO.find(w => w.intent === intent) ?? null;
}

/**
 * Entries whose label, intent or keywords match every word of a free-text
 * query, best first. Empty query → everything.
 * @param query - Words a person or model used: "zoom scopes", "approve".
 */
export function findWhereTo(query: string): WhereTo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...WHERE_TO];
  }
  const scored = WHERE_TO.map((w) => {
    const hay = `${w.intent} ${w.label} ${w.keywords.join(' ')}`.toLowerCase();
    const hits = words.filter(word => hay.includes(word)).length;
    return { w, hits };
  }).filter(s => s.hits > 0);
  scored.sort((a, b) => b.hits - a.hits || a.w.label.localeCompare(b.w.label));
  return scored.map(s => s.w);
}

/**
 * Fill `{slug}` / `{id}` in a path. Unfilled placeholders are left as-is so
 * a caller can see what is still needed.
 * @param path
 * @param params
 */
export function fillPath(path: string, params: Record<string, string | undefined> = {}): string {
  return path.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = params[key];
    return v ? encodeURIComponent(v) : m;
  });
}

/**
 * The line an agent puts in its answer: a markdown link, then the instruction.
 * @param w
 * @param params
 */
export function whereToLine(w: WhereTo, params?: Record<string, string | undefined>): string {
  return `[${w.label}](${fillPath(w.path, params)}) — ${w.instruction}`;
}

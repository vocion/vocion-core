/**
 * A Decision is the ask, read as one shape. Fixtures are fictional
 * (Northwind, Kestrel Capital).
 */
import type { AskLike } from './decision';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DECIDER } from '@/libs/needsYou/deadlines';
import { answerLine, answerProblem, clipAtWord, decisionAnswerWire, decisionForModel, decisionKindOf, decisionOptionsOf, decisionStateOf, decisionTitle, decisionViewOf, factsOf, factsTable, pictureOf, plainText, previewText, readDecisionAnswerWire } from './decision';

const repo: AskLike = {
  id: 41,
  kind: 'ruling',
  title: 'Which repo should the factory build in?',
  body: 'Two repos match "Northwind".',
  options: [
    { id: 'portal', label: 'Northwind Portal', description: 'Builds land in the customer portal.' },
    { id: 'api', label: 'Northwind API', description: 'Builds land in the API; CI runs on every push.', recommended: true, action: { id: 'objects.update_meta', input: { objectId: 7 } } },
  ],
  status: 'open',
  agentSlug: 'product-manager',
  ownerUserId: 'usr-dana',
  conversationId: 392,
  allowOther: true,
  multiSelect: false,
  createdAt: new Date('2026-10-08T12:00:00Z'),
};

describe('a Decision read off an ask', () => {
  it('maps the ask\'s kinds onto the five Decision kinds, without a vocabulary of its own', () => {
    expect(decisionKindOf('input')).toBe('question');
    expect(decisionKindOf('credential')).toBe('question');
    expect(decisionKindOf('ruling')).toBe('choice');
    expect(decisionKindOf('recommendation')).toBe('choice');
    expect(decisionKindOf('approval')).toBe('approval');
    expect(decisionKindOf('merge')).toBe('approval');
    expect(decisionKindOf('gate')).toBe('approval');
    expect(decisionKindOf('signoff')).toBe('signoff');
    expect(decisionKindOf('setup')).toBe('setup');
  });

  it('draws the recommended option first, with its consequence and whether it runs an effect', () => {
    expect(decisionOptionsOf(repo)).toEqual([
      { id: 'api', label: 'Northwind API', consequence: 'Builds land in the API; CI runs on every push.', recommended: true, hasEffect: true },
      { id: 'portal', label: 'Northwind Portal', consequence: 'Builds land in the customer portal.' },
    ]);
  });

  it('answers an approval that named no options with Approve or Reject, and a question with words only', () => {
    expect(decisionOptionsOf({ kind: 'approval', options: [] }).map(o => o.id)).toEqual(['approve', 'reject']);
    expect(decisionOptionsOf({ kind: 'input', options: [] })).toEqual([]);
    expect(decisionViewOf({ ...repo, kind: 'input', options: [], allowOther: false }).allowOther).toBe(true);
  });

  it('reads the state off the row: open, answered, skipped, defaulted, withdrawn, expired, undone', () => {
    expect(decisionStateOf({ status: 'open' })).toBe('open');
    expect(decisionStateOf({ status: 'open' }, { clockHeld: true })).toBe('expired');
    expect(decisionStateOf({ status: 'done', decidedBy: 'usr-dana' })).toBe('answered');
    expect(decisionStateOf({ status: 'approved', decidedBy: DEFAULT_DECIDER })).toBe('defaulted');
    expect(decisionStateOf({ status: 'skipped', decidedBy: 'usr-dana' })).toBe('skipped');
    expect(decisionStateOf({ status: 'superseded' })).toBe('withdrawn');
    expect(decisionStateOf({ status: 'done', decidedBy: 'usr-dana' }, { effectUndone: true })).toBe('undone');
  });

  it('carries what was answered, by option id and label, every option chosen', () => {
    const view = decisionViewOf({ ...repo, multiSelect: true, status: 'done', decision: 'api', chosenOptionIds: ['api', 'portal'], decidedBy: 'usr-dana', decidedAt: new Date('2026-10-08T12:05:00Z'), decidedVia: 'card' });

    expect(view.state).toBe('answered');
    expect(view.answer).toEqual({ kind: 'option', optionIds: ['api', 'portal'], labels: ['Northwind API', 'Northwind Portal'], freeText: null, by: 'usr-dana', at: '2026-10-08T12:05:00.000Z', via: 'card' });
  });

  it('reads an "other" answer as their own words', () => {
    const view = decisionViewOf({ ...repo, status: 'done', decision: 'other', decisionNote: 'Neither — Kestrel Capital\'s fork', decidedBy: 'usr-dana', decidedVia: 'composer' });

    expect(view.answer).toMatchObject({ kind: 'free_text', freeText: 'Neither — Kestrel Capital\'s fork', via: 'composer' });
  });
});

describe('what an answer may be', () => {
  const view = decisionViewOf(repo);

  it('takes one known option, a non-empty answer in words where words are offered, or a skip', () => {
    expect(answerProblem(view, { kind: 'option', optionIds: ['api'] })).toBeNull();
    expect(answerProblem(view, { kind: 'free_text', text: 'use the fork' })).toBeNull();
    expect(answerProblem(view, { kind: 'skip' })).toBeNull();
  });

  it('refuses two options on a Decision that takes one, an unknown option, empty words, and words where only options are offered', () => {
    expect(answerProblem(view, { kind: 'option', optionIds: ['api', 'portal'] })).toBe('this decision takes one option');
    expect(answerProblem(view, { kind: 'option', optionIds: ['gateway'] })).toBe('no such option: gateway');
    expect(answerProblem(view, { kind: 'free_text', text: '  ' })).toMatch(/cannot be empty/);
    expect(answerProblem({ ...view, allowOther: false }, { kind: 'free_text', text: 'x' })).toMatch(/takes one of its options/);
  });

  it('refuses any answer to a Decision already decided', () => {
    expect(answerProblem({ ...view, state: 'answered' }, { kind: 'option', optionIds: ['api'] })).toBe('it was already decided');
  });

  it('takes several options where several may be chosen', () => {
    expect(answerProblem({ ...view, multiple: true }, { kind: 'option', optionIds: ['api', 'portal'] })).toBeNull();
    expect(answerProblem({ ...view, multiple: true }, { kind: 'option', optionIds: ['api', 'api'] })).toMatch(/twice/);
  });
});

describe('the answer on the wire and to the agent', () => {
  it('reads exactly one of options, words or skip — and nothing else', () => {
    expect(readDecisionAnswerWire({ id: 41, option_ids: ['api'] })).toEqual({ id: 41, subject: 'ask', answer: { kind: 'option', optionIds: ['api'] }, via: 'card' });
    expect(readDecisionAnswerWire({ id: 41, free_text: ' the fork ' })).toEqual({ id: 41, subject: 'ask', answer: { kind: 'free_text', text: 'the fork' }, via: 'card' });
    expect(readDecisionAnswerWire({ id: 41, skip: true })).toEqual({ id: 41, subject: 'ask', answer: { kind: 'skip' }, via: 'card' });
    expect(readDecisionAnswerWire({ id: 6061, subject: 'proposal', option_ids: ['approve'] })).toEqual({ id: 6061, subject: 'proposal', answer: { kind: 'option', optionIds: ['approve'] }, via: 'card' });
    expect(readDecisionAnswerWire({ id: 41 })).toBeNull();
    expect(readDecisionAnswerWire({ id: 41, skip: true, option_ids: ['api'] })).toBeNull();
    expect(readDecisionAnswerWire({ id: -1, skip: true })).toBeNull();
    expect(readDecisionAnswerWire('approve')).toBeNull();
    expect(readDecisionAnswerWire({ id: 41, option_ids: ['approve'], via: 'chat_chip' })).toEqual({ id: 41, subject: 'ask', answer: { kind: 'option', optionIds: ['approve'] }, via: 'chat_chip' });
  });

  it('round-trips through the wire shape the client sends, ask or proposal', () => {
    for (const answer of [{ kind: 'option' as const, optionIds: ['api'] }, { kind: 'free_text' as const, text: 'the fork' }, { kind: 'skip' as const }]) {
      expect(readDecisionAnswerWire(decisionAnswerWire({ id: 41 }, answer))).toEqual({ id: 41, subject: 'ask', answer, via: 'card' });
      expect(readDecisionAnswerWire(decisionAnswerWire({ id: 6061, subject: 'proposal' }, answer))).toEqual({ id: 6061, subject: 'proposal', answer, via: 'card' });
    }
  });

  it('is told to the asking agent as the record of what was chosen, by id — never as their words', () => {
    const view = decisionViewOf(repo);
    const told = decisionForModel(view, { kind: 'option', optionIds: ['api'] });

    expect(told).toContain('[decision #41 answered] Which repo should the factory build in?');
    expect(told).toContain('Chosen: Northwind API (option api) — its action ran as theirs');
    expect(told).toContain('do not ask it again');
    expect(decisionForModel(view, { kind: 'skip' })).toContain('Skipped: the person chose not to answer');
    expect(decisionForModel(view, { kind: 'free_text', text: 'the fork' })).toContain('Answered in their own words: the fork');
  });

  it('says the answer in one line for the transcript\'s receipt', () => {
    const view = decisionViewOf(repo);

    expect(answerLine(view, { kind: 'option', optionIds: ['api', 'portal'] })).toBe('Northwind API, Northwind Portal');
    expect(answerLine(view, { kind: 'skip' })).toBe('Skipped');
  });
});

describe('phase two: subjects, links, sign-off', () => {
  it('keys a Decision by its subject and id, so a question and a proposal never collide', async () => {
    const { decisionKey } = await import('./decision');

    expect(decisionKey({ id: 41 })).toBe('ask:41');
    expect(decisionKey({ id: 41, subject: 'proposal' })).toBe('proposal:41');
  });

  it('keeps a link option only when it opens an in-app path', () => {
    const options = decisionOptionsOf({ kind: 'setup', options: [
      { id: 'connect:github', label: 'Connect with GitHub', href: '/api/connect/github/start?connector=github' },
      { id: 'evil', label: 'Elsewhere', href: 'https://evil.example/login' },
      { id: 'proto', label: 'Protocol-relative', href: '//evil.example' },
    ] });

    expect(options.map(o => [o.id, o.href ?? null])).toEqual([['connect:github', '/api/connect/github/start?connector=github'], ['evil', null], ['proto', null]]);
  });

  it('a sign-off with no options is Approve or Discard — revising is the answer in their own words', () => {
    const view = decisionViewOf({ id: 9, kind: 'signoff', title: 'Sign off the Northwind proposal v3?', status: 'open', objectRefs: [{ type: 'artifact', id: '77' }] });

    expect(view.kind).toBe('signoff');
    expect(view.options).toEqual([
      { id: 'approve', label: 'Approve', consequence: 'Marks it approved, as it stands.', recommended: true },
      { id: 'reject', label: 'Discard', consequence: 'Nothing is kept or sent.' },
    ]);
    expect(view.allowOther).toBe(true);
    expect(view.refs).toEqual([{ type: 'artifact', id: '77' }]);
  });

  it('tells the asker what it asked with and what the answer was about, and a proposal as a proposal', () => {
    const told = decisionForModel({ id: 12, question: 'Build "Request link creator"', body: 'Why: no link can be made today', refs: [{ type: 'artifact', id: '41' }], options: [{ id: 'build', label: 'Build it', consequence: 'Files it as a request and starts the build.' }] }, { kind: 'option', optionIds: ['build'] });

    expect(told).toContain('Asked with: Why: no link can be made today');
    expect(told).toContain('About: artifact #41');
    expect(told).toContain('Chosen: Build it (option build) — Files it as a request and starts the build.');
    expect(decisionForModel({ id: 6061, subject: 'proposal', question: 'Move Northwind', options: [] }, { kind: 'skip' })).toContain('[proposal #6061 answered]');
  });

  it('links a context URL only when it is an in-app path', () => {
    expect(decisionViewOf({ ...repo, contextUrl: '/dashboard/missions/pipeline/41' }).href).toBe('/dashboard/missions/pipeline/41');
    expect(decisionViewOf({ ...repo, contextUrl: 'https://github.example/pull/127' }).href).toBeUndefined();
  });
});

describe('the picture an ask carries', () => {
  const shot = '/api/artifacts/org-northwind-3f9a/org-northwind-3f9a.jpg';

  it('reads an in-app image out of the long form as the card\'s picture, leaving the rest', () => {
    expect(pictureOf(`Batch #12 · run 3 · Dana Whitfield\n\n![The page as it stopped](${shot})`)).toEqual({
      picture: { src: shot, alt: 'The page as it stopped' },
      rest: 'Batch #12 · run 3 · Dana Whitfield',
    });
    expect(pictureOf(`![](${shot} "hover")`)).toEqual({ picture: { src: shot, alt: 'Picture' }, rest: null });
  });

  it('loads only what the app serves: an outside image, or a link that is not an image, stays text', () => {
    expect(pictureOf('![tracker](https://evil.example/p.gif)')).toEqual({ picture: null, rest: '![tracker](https://evil.example/p.gif)' });
    expect(pictureOf(`[The page as it stopped](${shot})`).picture).toBeNull();
    expect(pictureOf(null)).toEqual({ picture: null, rest: null });
  });

  it('is on every kind of Decision, and an approval\'s payload is the text without it', () => {
    const md = `\`\`\`\nTo: ops@kestrel.example\n\`\`\`\n\n![The page as it stopped](${shot})`;

    expect(decisionViewOf({ ...repo, contextMd: md }).picture).toEqual({ src: shot, alt: 'The page as it stopped' });

    const approval = decisionViewOf({ id: 7, kind: 'approval', title: 'Send the renewal?', status: 'open', contextMd: md });

    expect(approval.picture?.src).toBe(shot);
    expect(approval.preview).toBe('To: ops@kestrel.example');
    expect(decisionViewOf(repo).picture).toBeUndefined();
  });
});

describe('the facts an ask is decided on', () => {
  const facts = [{ label: 'Board says', value: 'IL LCSW 149.012345' }, { label: 'Name search', value: 'Owen J. Fitzgerald | LCSW 149.021345 | Active' }];

  it('travel as the two-column table the long form opens with, and read back whole — a | in a value included', () => {
    const md = `${factsTable(facts)}\n\nAutomation run 12 · run 3 · Owen Fitzgerald`;

    expect(factsOf(md)).toEqual({ facts, rest: 'Automation run 12 · run 3 · Owen Fitzgerald' });
  });

  it('a table of another width is not facts, and stays in the text', () => {
    const plan = '| Keyword | Type | Intent |\n| --- | --- | --- |\n| ledger export | head | buy |';

    expect(factsOf(plan)).toEqual({ facts: [], rest: plan });
    expect(factsOf('No table here.')).toEqual({ facts: [], rest: 'No table here.' });
    expect(factsTable([])).toBe('');
  });

  it('are on the Decision beside its picture, and out of an approval\'s payload', () => {
    const shot = '/api/artifacts/org-northwind-3f9a/org-northwind-3f9a.jpg';
    const md = `${factsTable(facts)}\n\nAutomation run 12 · run 3\n\n![The page as it stopped](${shot})`;
    const view = decisionViewOf({ ...repo, contextMd: md });

    expect(view.facts).toEqual(facts);
    expect(view.picture?.src).toBe(shot);
    expect(decisionViewOf({ id: 8, kind: 'approval', title: 'Save it?', status: 'open', contextMd: md }).preview).toBe('Automation run 12 · run 3');
    expect(decisionViewOf(repo).facts).toBeUndefined();
  });
});

describe('a line cut to fit', () => {
  it('ends on a whole word, never mid-word', () => {
    const line = 'Dana Whitfield: the Kestrel license on file expires 11/30/2026 — only renewals filed before then keep the enrollment';
    const cut = clipAtWord(line, 90);

    expect(cut.length).toBeLessThanOrEqual(90);
    expect(cut).toBe('Dana Whitfield: the Kestrel license on file expires 11/30/2026 — only renewals filed…');
    expect(clipAtWord('Northwind renewal', 90)).toBe('Northwind renewal');
  });

  it('drops a dangling dash or comma before the ellipsis, and cuts a single overlong word where it must', () => {
    expect(clipAtWord('Submit the application — then wait', 26)).toBe('Submit the application…');
    expect(clipAtWord('x'.repeat(40), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('an approval, asked as a permission prompt', () => {
  it('is titled "Allow <agent> to <plain action>?" — a question already asked as one keeps its words', () => {
    expect(decisionTitle({ kind: 'approval', question: 'Move Northwind to Negotiation' }, 'Revenue lead')).toBe('Allow Revenue lead to move Northwind to Negotiation?');
    expect(decisionTitle({ kind: 'approval', question: 'HubSpot: update deal 4410.' }, null)).toBe('Allow the agent to HubSpot: update deal 4410?');
    expect(decisionTitle({ kind: 'approval', question: 'Send the follow-up to Kestrel Capital?' }, 'Revenue lead')).toBe('Send the follow-up to Kestrel Capital?');
    expect(decisionTitle({ kind: 'choice', question: 'Which repo' }, 'Product manager')).toBe('Which repo');
  });

  it('shows its payload as plain text — the storage fence is not part of it — and an approval with no named options is Allow once or Deny', () => {
    expect(previewText('```json\n{\n  "to": "pat@northwind.example"\n}\n```')).toBe('{\n  "to": "pat@northwind.example"\n}');
    expect(previewText('dealstage → negotiation')).toBe('dealstage → negotiation');
    expect(previewText('  ')).toBeNull();

    const view = decisionViewOf({ ...repo, kind: 'gate', options: [], contextMd: '```json\n{"to":"pat@northwind.example"}\n```' });

    expect(view.options.map(o => [o.id, o.label])).toEqual([['approve', 'Allow once'], ['reject', 'Deny']]);
    expect(view.preview).toBe('{"to":"pat@northwind.example"}');
    expect(decisionViewOf({ ...repo, contextMd: 'not an approval' }).preview).toBeUndefined();
  });
});

it('passes failed execution to the continuation instead of telling it to act again', () => {
  const text = decisionForModel({ id: 7, subject: 'proposal', question: 'Correct expense', options: [{ id: 'approve', label: 'Allow once', consequence: 'Runs it as you.' }] }, { kind: 'option', optionIds: ['approve'] }, { runId: 7, status: 'failed', error: 'MCP tool reported failure' });

  expect(text).toContain('Execution result for ACT-7: failed');
  expect(text).toContain('not pending or processing');
  expect(text).toContain('MCP tool reported failure');
  expect(text).not.toContain('Act on it now');
  expect(text).not.toContain('Runs it as you.');
});

it('does not execute a completed approved action again', () => {
  const text = decisionForModel({ id: 7, subject: 'proposal', question: 'Correct expense', options: [] }, { kind: 'option', optionIds: ['approve'] }, { runId: 7, status: 'done' });

  expect(text).toContain('already executed');
  expect(text).toContain('do not submit or propose it again');
});

// 2026-10-23: a bulk decline read only "done", and the reply said "Done.
// Cleared 100" beside a queue still holding rows it was asked to clear.
it('hands the continuation the action\'s own account, and forbids "done" while it says something is open', () => {
  const text = decisionForModel({ id: 9, subject: 'proposal', question: 'Decline 112 decisions: Open decisions waiting 7 days or more', options: [{ id: 'approve', label: 'Allow once', consequence: 'Runs it as you.' }] }, { kind: 'option', optionIds: ['approve'] }, { runId: 9, status: 'done', resultLine: 'Declined 112 of the 112 on the card. Still open in that selection: 6 runs (a paused run is resumed or cancelled on its own page).' });

  expect(text).toContain('What it did, in its own words: Declined 112 of the 112 on the card. Still open in that selection: 6 runs');
  expect(text).toContain('never call it done or cleared');
});

describe('text a synced system escaped', () => {
  it('reads a CRM deal name the way the person typed it', () => {
    const view = decisionViewOf({ ...repo, title: 'Northwind &amp; Kestrel: 8 weekly flags, no action', options: [{ id: 'close', label: 'Mark &quot;closed-lost&quot;', description: 'Removes it from open pipeline &#8212; both deals' }] });

    expect(view.question).toBe('Northwind & Kestrel: 8 weekly flags, no action');
    expect(view.options[0]?.label).toBe('Mark "closed-lost"');
    expect(view.options[0]?.consequence).toBe('Removes it from open pipeline — both deals');
  });

  it('leaves text with no entity, and an unknown one, as it is', () => {
    expect(plainText('Q3 & Q4 <draft>')).toBe('Q3 & Q4 <draft>');
    expect(plainText('a &notanentity; b')).toBe('a &notanentity; b');
  });
});

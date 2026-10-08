import type { ActionGateDeps, CriticChoice, DeclaredGate, GateFinding, GateRecord } from './actionGate';
import { describe, expect, it } from 'vitest';
import { lintCopy, PLATFORM_DEFAULT_VOICE_RULES } from '@/libs/writing/voiceRules';
import {
  declaredActionGates,
  gateCardFields,
  gateOutcome,
  gatesForAction,
  parseCritique,
  pickCritic,
  publishableText,
  routeFindings,
  runActionGates,
  vendorOfModel,
  voiceFindings,
} from './actionGate';

// The red-team gate's decisions, without a model or a database: which gates
// read an action, which vendor reads whose draft, and where the typed findings
// send the work.

const GATE: DeclaredGate = { name: 'red-team', label: 'Red team', plugin: 'red-team', actions: ['gmail.send', 'release.announce'], critic: { vendor: 'different', rubric: 'red-team-critique' }, returns: 1 };

const serious = (over: Partial<GateFinding> = {}): GateFinding => ({ severity: 'serious', rule: 'fact', quote: 'ships Friday', why: 'The release page says the 14th.', fix: 'Say the 14th.', source: 'critic', ...over });
const minor = (over: Partial<GateFinding> = {}): GateFinding => ({ severity: 'minor', rule: 'voice', quote: 'utilize', why: 'Prefer use.', fix: 'Use "use".', source: 'critic', ...over });

const OPENAI: CriticChoice = { provider: 'openai', vendor: 'openai', model: 'gpt-4o' };
const ANTHROPIC: CriticChoice = { provider: 'anthropic', vendor: 'anthropic', model: 'claude-sonnet-5-5' };
const BEDROCK_CLAUDE: CriticChoice = { provider: 'bedrock', vendor: 'anthropic', model: 'us.anthropic.claude-sonnet-4-6' };

describe('which gates read an action', () => {
  it('collects every plugin\'s declared gates and matches an action by its id or a former one', () => {
    const declared = declaredActionGates([
      { slug: 'wiki', actionGates: [] },
      { slug: 'red-team', actionGates: [{ name: 'red-team', label: 'Red team', actions: ['gmail.send', 'github.open_pull'], critic: { vendor: 'different' }, returns: 1 }] },
      { slug: 'proposals' },
    ]);

    expect(declared.map(g => `${g.plugin}/${g.name}`)).toEqual(['red-team/red-team']);
    expect(gatesForAction(declared, ['gmail.send'])).toHaveLength(1);
    expect(gatesForAction(declared, ['repo.open_pull', 'github.open_pull'])).toHaveLength(1);
    expect(gatesForAction(declared, ['hubspot.update'])).toEqual([]);
  });
});

describe('a different vendor reads the draft', () => {
  it('reads a vendor off the model, not the host: Claude on Bedrock is Anthropic\'s', () => {
    expect(vendorOfModel('anthropic', 'claude-sonnet-5-5')).toBe('anthropic');
    expect(vendorOfModel('openai', 'gpt-4o')).toBe('openai');
    expect(vendorOfModel('bedrock', 'us.anthropic.claude-sonnet-4-6')).toBe('anthropic');
    expect(vendorOfModel('bedrock', 'amazon.titan-text-premier-v1:0')).toBe('amazon');
    expect(vendorOfModel('bedrock', 'us.meta.llama3-1-70b-instruct-v1:0')).toBe('meta');
    expect(vendorOfModel('bedrock', undefined)).toBe('anthropic');
    expect(vendorOfModel(undefined, 'gpt-5.4-mini')).toBe('openai');
    expect(vendorOfModel(undefined, 'claude-haiku-4-5-20251001')).toBe('anthropic');
    expect(vendorOfModel('scripted', 'scripted')).toBe('unknown');
  });

  it('never picks the author\'s own vendor — wherever it is hosted', () => {
    expect(pickCritic('anthropic', [ANTHROPIC, BEDROCK_CLAUDE, OPENAI])).toEqual(OPENAI);
    expect(pickCritic('openai', [OPENAI, ANTHROPIC])).toEqual(ANTHROPIC);
    expect(pickCritic('openai', [OPENAI, BEDROCK_CLAUDE])).toEqual(BEDROCK_CLAUDE);
    expect(pickCritic('anthropic', [ANTHROPIC, BEDROCK_CLAUDE])).toBeNull();
    expect(pickCritic('unknown', [ANTHROPIC])).toEqual(ANTHROPIC);
  });
});

describe('reading the critic', () => {
  it('takes one JSON object of typed findings, fenced or not', () => {
    expect(parseCritique('```json\n{"findings":[{"severity":"serious","rule":"fact","quote":"ships Friday","why":"w","fix":"f"}]}\n```')).toEqual([
      { severity: 'serious', rule: 'fact', quote: 'ships Friday', why: 'w', fix: 'f', source: 'critic' },
    ]);
    expect(parseCritique('{"findings":[]}')).toEqual([]);
    expect(parseCritique('{"findings":[{"severity":"serious","rule":"tone","quote":"q"}]}')![0]!.rule).toBe('other');
  });

  it('calls an unreadable answer unreadable — never an empty pass', () => {
    expect(parseCritique('Looks great to me!')).toBeNull();
    expect(parseCritique('{"findings":[{"severity":"catastrophic"}]}')).toBeNull();
  });

  it('turns the workspace\'s own voice rules into findings: a blocking rule is serious, a steer minor', () => {
    const findings = voiceFindings(lintCopy('Quick question — I hope this finds you well.', PLATFORM_DEFAULT_VOICE_RULES).violations);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every(f => f.rule === 'voice' && f.source === 'voice-rules')).toBe(true);
    expect(findings.some(f => f.severity === 'serious')).toBe(true);
  });
});

describe('routing on the typed findings', () => {
  const base = { criticRan: true, priorReturns: 0, returns: 1, onPersonsWord: false };

  it('passes an agent\'s draft with nothing serious, minor findings and all', () => {
    expect(routeFindings({ ...base, findings: [] })).toBe('pass');
    expect(routeFindings({ ...base, findings: [minor()] })).toBe('pass');
  });

  it('returns a serious first draft to its author once, then a person decides', () => {
    expect(routeFindings({ ...base, findings: [serious()] })).toBe('return');
    expect(routeFindings({ ...base, findings: [serious()], priorReturns: 1 })).toBe('escalate');
    expect(routeFindings({ ...base, findings: [serious()], returns: 0 })).toBe('escalate');
    expect(routeFindings({ ...base, findings: [serious()], returns: 2, priorReturns: 1 })).toBe('return');
  });

  it('sends a draft nobody could read to a person — a reading that did not happen is not a pass', () => {
    expect(routeFindings({ ...base, findings: [], criticRan: false })).toBe('escalate');
  });

  it('never stops the person\'s own word: serious findings are advice, anything else passes', () => {
    expect(routeFindings({ ...base, onPersonsWord: true, findings: [serious()] })).toBe('advise');
    expect(routeFindings({ ...base, onPersonsWord: true, findings: [serious()], priorReturns: 5 })).toBe('advise');
    expect(routeFindings({ ...base, onPersonsWord: true, findings: [minor()] })).toBe('pass');
    expect(routeFindings({ ...base, onPersonsWord: true, findings: [], criticRan: false })).toBe('pass');
  });
});

const record = (over: Partial<GateRecord>): GateRecord => ({ gate: 'red-team', label: 'Red team', plugin: 'red-team', verdict: 'pass', findings: [], author: 'anthropic', critic: { vendor: 'openai', model: 'gpt-4o' }, priorReturns: 0, at: '2026-10-08T12:00:00.000Z', ...over });

describe('one next step from every gate', () => {
  it('a return wins, and tells the author what to fix and what happens next', () => {
    const out = gateOutcome([record({ verdict: 'pass' }), record({ verdict: 'return', findings: [serious(), minor()] })]);

    expect(out.returned).not.toBeNull();
    expect(out.returned!.message).toContain('"ships Friday"');
    expect(out.returned!.message).toContain('a person decides');
    expect(out.returned!.message).not.toContain('utilize');
    expect(out.hold).toBeNull();
  });

  it('a hold says why a person decides', () => {
    expect(gateOutcome([record({ verdict: 'escalate', findings: [serious()], priorReturns: 1 })]).hold).toMatch(/still stand after a revision/);
    expect(gateOutcome([record({ verdict: 'escalate', critic: null, note: 'no model from a vendor other than anthropic is reachable' })]).hold).toMatch(/could not read it \(no model/);
  });

  it('advice is one line per gate, and never holds anything', () => {
    const out = gateOutcome([record({ verdict: 'advise', findings: [serious()] })]);

    expect(out.hold).toBeNull();
    expect(out.returned).toBeNull();
    expect(out.advice).toHaveLength(1);
    expect(out.advice[0]).toMatch(/went out as the person asked/);
  });
});

describe('what the critic reads and what a person sees', () => {
  it('reads the words the action\'s own card shows, else every string in its input', () => {
    const card = { title: 'Send to Kestrel', headline: 'Email the Kestrel Capital team', summary: 'Renewal note', content: [{ kind: 'email', id: 's1', label: 'Day 0', subject: 'Your renewal', body: 'The new plan ships Friday.' }], fields: [{ label: 'To', value: 'ops@kestrel.example' }] };
    const text = publishableText(card, { to: 'ops@kestrel.example' });

    expect(text).toContain('The new plan ships Friday.');
    expect(text).toContain('Your renewal');
    expect(text).toContain('To: ops@kestrel.example');
    expect(publishableText(null, { to: 'a@acme.example', body: { text: 'Hello' } })).toBe('to: a@acme.example\nbody.text: Hello');
  });

  it('puts the findings on the card a person decides from', () => {
    const rows = gateCardFields({ gates: [record({ verdict: 'escalate', findings: [serious(), minor()], priorReturns: 1 })] });

    expect(rows[0]).toEqual({ label: 'Red team', value: '1 serious, 1 minor — read by gpt-4o (openai); written on anthropic; returned 1× before' });
    expect(rows[1]!.value).toContain('"ships Friday"');
    expect(gateCardFields({})).toEqual([]);
    expect(gateCardFields(null)).toEqual([]);
  });
});

/**
 * Deps with a scripted critic: records which model it was asked to be.
 * @param over - Overrides.
 */
function deps(over: Partial<ActionGateDeps> & { answer?: string } = {}): ActionGateDeps & { asked: CriticChoice[] } {
  const asked: CriticChoice[] = [];
  return {
    asked,
    author: async () => 'anthropic',
    candidates: async () => [ANTHROPIC, OPENAI],
    text: async () => 'The new plan ships Friday.',
    voice: async () => ({ rules: null, text: '' }),
    lint: () => [],
    facts: async () => [{ title: 'Release calendar', slug: 'release-calendar', excerpt: 'The plan ships on the 14th.' }],
    rubric: async () => '# Red-team critique',
    critique: async (choice) => {
      asked.push(choice);
      return over.answer ?? '{"findings":[{"severity":"serious","rule":"fact","quote":"ships Friday","why":"The release calendar says the 14th.","fix":"Say the 14th."}]}';
    },
    priorReturns: async () => 0,
    now: () => new Date('2026-10-08T12:00:00.000Z'),
    ...over,
  };
}

describe('running a gate', () => {
  it('has a different vendor read an Anthropic author\'s draft, and returns it on a serious finding', async () => {
    const d = deps();
    const [r] = await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: false }, d);

    expect(d.asked).toEqual([OPENAI]);
    expect(r).toMatchObject({ verdict: 'return', author: 'anthropic', critic: { vendor: 'openai', model: 'gpt-4o' }, priorReturns: 0 });
    expect(r!.findings[0]).toMatchObject({ severity: 'serious', rule: 'fact', quote: 'ships Friday' });
  });

  it('has an Anthropic model read an OpenAI author\'s draft', async () => {
    const d = deps({ author: async () => 'openai' });
    await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: false }, d);

    expect(d.asked).toEqual([ANTHROPIC]);
  });

  it('sends the revised draft to a person when it still has a serious finding', async () => {
    const [r] = await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: false }, deps({ priorReturns: async () => 1 }));

    expect(r!.verdict).toBe('escalate');
  });

  it('passes a clean draft', async () => {
    const [r] = await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: false }, deps({ answer: '{"findings":[]}' }));

    expect(r!.verdict).toBe('pass');
  });

  it('with no other vendor reachable, says so and a person reads it — no model is called', async () => {
    const d = deps({ candidates: async () => [ANTHROPIC, BEDROCK_CLAUDE] });
    const [r] = await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: false }, d);

    expect(d.asked).toEqual([]);
    expect(r).toMatchObject({ verdict: 'escalate', critic: null });
    expect(r!.note).toMatch(/no model from a vendor other than anthropic/);
  });

  it('when the critic fails, says why and holds it for a person', async () => {
    const [r] = await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: false }, deps({ critique: async () => {
      throw new Error('rate limited');
    } }));

    expect(r).toMatchObject({ verdict: 'escalate' });
    expect(r!.note).toMatch(/rate limited/);
  });

  it('counts the workspace\'s own voice rules even when the critic finds nothing', async () => {
    const [r] = await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: false }, deps({
      answer: '{"findings":[]}',
      voice: async () => ({ rules: PLATFORM_DEFAULT_VOICE_RULES, text: '' }),
      text: async () => 'Quick question about your renewal.',
      lint: (text, rules) => voiceFindings(lintCopy(text, rules).violations),
    }));

    expect(r!.verdict).toBe('return');
    expect(r!.findings.some(f => f.source === 'voice-rules' && f.severity === 'serious')).toBe(true);
  });

  it('on the person\'s own word, reads it all the same and only advises', async () => {
    const d = deps({ priorReturns: async () => 9 });
    const [r] = await runActionGates({ gates: [GATE], actionLabel: 'Send email', onPersonsWord: true }, d);

    expect(d.asked).toEqual([OPENAI]);
    expect(r).toMatchObject({ verdict: 'advise', priorReturns: 0 });
  });

  it('runs no gate when none reads the action', async () => {
    expect(await runActionGates({ gates: [], actionLabel: 'x', onPersonsWord: false }, deps())).toEqual([]);
  });
});

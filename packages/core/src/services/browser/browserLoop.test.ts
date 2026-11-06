import { describe, expect, it } from 'vitest';
import { fillSecrets, maskSecrets } from './browserLoop';

describe('a secret input', () => {
  const secrets = { password: 'fixture-pass-42' };

  it('reaches the page only as the engine types it', () => {
    expect(fillSecrets('{{password}}', secrets, {})).toBe('fixture-pass-42');
    expect(fillSecrets('{{ password }}', secrets, {})).toBe('fixture-pass-42');
    expect(fillSecrets('{{email}}', secrets, { email: 'ap@larkfield.example' })).toBe('ap@larkfield.example');
    expect(fillSecrets('{{unknown}}', secrets, {})).toBe('{{unknown}}');
  });

  it('is never read back: any echo of its value is its placeholder again', () => {
    expect(maskSecrets('textbox "Password": fixture-pass-42', secrets)).toBe('textbox "Password": {{password}}');
  });
});

describe('goingInCircles', () => {
  it('sees two pages visited in turn three times', async () => {
    const { goingInCircles } = await import('./browserLoop');

    expect(goingInCircles(['click:/users', 'click:/users/new', 'click:/users', 'click:/users/new', 'click:/users', 'click:/users/new'])).toBe(true);
    expect(goingInCircles(['click:/users', 'click:/users/new', 'type:/users/new', 'click:/users/new', 'click:/users', 'click:/users/new'])).toBe(false);
    expect(goingInCircles(['open:/a', 'open:/a', 'open:/a', 'open:/a', 'open:/a', 'open:/a'])).toBe(false);
  });
});

describe('a secret the page echoes back', () => {
  it('is said to have gone in as its real value, so a refused sign-in never blames the placeholder', async () => {
    const { SECRET_ECHO_RULE, typedSecretNote } = await import('./browserLoop');
    const secrets = { password: 'fixture-pass-42', body_html: '<p>x</p>' };

    expect(typedSecretNote('{{password}}', secrets)).toContain('typed the real value of {{password}}');
    expect(typedSecretNote('{{ password }}', secrets)).toContain('{{password}}');
    expect(typedSecretNote('editor@northwind-home.example', secrets)).toBeNull();
    expect(typedSecretNote('{{email}}', secrets)).toBeNull();
    expect(SECRET_ECHO_RULE).toContain('never the braces');
    expect(SECRET_ECHO_RULE).toContain('never blame the placeholder');
  });
});

describe('an escalation to the expert', () => {
  const mask = (x: string) => maskSecrets(x, { password: 'fixture-pass-42' });

  it('waits on typed parts: a question, the facts, the rule, answers with what each does — and composes text for older surfaces', async () => {
    const { escalationOf } = await import('./browserLoop');
    const w = escalationOf({
      question: 'Correct Owen Fitzgerald’s license number on the board to 149.021345?',
      found: [{ label: 'Board says', value: 'IL LCSW 149.012345' }, { label: 'Signed in as', value: 'fixture-pass-42' }, { label: '', value: 'dropped' }],
      rule: 'A license number that does not match the state lookup goes to the expert.',
      options: [{ label: 'Correct it', consequence: 'Updates the board record.' }, { label: 'Leave it', consequence: '' }, 'Ask the provider', 'A fourth'],
    }, mask);

    expect(w).toMatchObject({ kind: 'question', escalation: true, question: 'Correct Owen Fitzgerald’s license number on the board to 149.021345?', rule: 'A license number that does not match the state lookup goes to the expert.' });
    expect(w.found).toEqual([{ label: 'Board says', value: 'IL LCSW 149.012345' }, { label: 'Signed in as', value: '{{password}}' }]);
    expect(w.choices).toEqual([{ label: 'Correct it', consequence: 'Updates the board record.' }, { label: 'Leave it' }, { label: 'Ask the provider' }]);
    expect(w.options).toEqual(['Correct it', 'Leave it', 'Ask the provider']);
    expect(w.text).toContain('Correct Owen Fitzgerald’s license number');
    expect(w.text).toContain('Board says: IL LCSW 149.012345');
  });

  it('reads the tool\'s earlier shape (what, evidence, plain options) as a question and one fact', async () => {
    const { escalationOf } = await import('./browserLoop');
    const w = escalationOf({ what: 'Two accounts match this email.', evidence: '“Northwind Ops” and “Northwind Ops (old)”', options: ['Use the first'] }, mask);

    expect(w.question).toBe('Two accounts match this email.');
    expect(w.found).toEqual([{ label: 'On the page', value: '“Northwind Ops” and “Northwind Ops (old)”' }]);
    expect(w.choices).toEqual([{ label: 'Use the first' }]);
  });
});

describe('an escalation the expert reads on a card', () => {
  it('is sent back when its question will not fit the card, or it offers no answers', async () => {
    const { escalationUnfit, ESCALATION_QUESTION_MAX } = await import('./browserLoop');
    const choices = [{ label: 'Enroll the existing account' }];

    expect(escalationUnfit({ question: 'Enroll Aisha Karim’s existing account instead of adding a second one?', choices })).toBeNull();
    expect(escalationUnfit({ question: 'x'.repeat(ESCALATION_QUESTION_MAX + 1), choices })).toMatch(/characters/);
    expect(escalationUnfit({ question: 'Enroll Aisha Karim’s existing account?', choices: [] })).toMatch(/answers/);
  });
});

describe('a rule the run followed instead of asking', () => {
  it('is a typed step on the run, naming the rule, whose it is, and what it decided', async () => {
    const { runBrowserLoop } = await import('./browserLoop');
    const calls = [
      { name: 'followed_rule', args: { rule: 2, decided: 'Ruth Calloway (LMFT) goes through Hospital and other providers' } },
      { name: 'followed_rule', args: { rule: 9, decided: 'nothing' } },
      { name: 'finish', args: { summary: 'Done.', result: {} } },
    ];
    let n = 0;
    const replies: string[] = [];
    const model = { bindTools: () => ({ invoke: async (messages: Array<{ content: unknown }>) => {
      const last = messages.at(-1)?.content;
      if (n > 0) {
        replies.push(String(last).split('\n')[0]!);
      }
      const c = calls[Math.min(n, calls.length - 1)]!;
      n += 1;
      return { content: '', tool_calls: [{ id: `c${n}`, name: c.name, args: c.args }] };
    } }) } as never;
    // No real browser: the loop reads the page through the engine, which falls back when it cannot.
    const session = { page: { url: () => 'https://larkspur.example/apply', isClosed: () => false } } as never;
    const steps: Array<Record<string, unknown>> = [];
    const out = await runBrowserLoop(model, session, {
      task: 'Submit the application.',
      startUrl: null,
      inputs: {},
      secrets: {},
      outputs: [],
      continuing: true,
      routine: {
        name: 'Submit a Larkspur group application',
        expert: 'Marcus Hale',
        rules: ['Type the tax ID by hand.', 'LMFTs go through Hospital and other providers.'],
        ruleFrom: [null, { askId: 41, by: 'Marcus Hale', version: 3 }],
        escalations: [],
        prohibited: [],
        postconditions: [],
        writes: [],
        autoWrites: false,
      },
    }, { now: () => Date.now(), stopped: () => false, charge: async () => {}, step: async (st) => {
      steps.push(st);
    }, wait: async () => ({ kind: 'timeout' }) });

    expect(out.status).toBe('done');

    const rule = steps.find(st => st.kind === 'rule');

    expect(rule).toMatchObject({
      label: 'Followed Marcus’s rule (v3): LMFTs go through Hospital and other providers.',
      why: 'Ruth Calloway (LMFT) goes through Hospital and other providers',
      rule: { n: 2, text: 'LMFTs go through Hospital and other providers.', from: { askId: 41, by: 'Marcus Hale', version: 3 } },
    });
    // A rule it does not have is refused, for the model to fix, and records nothing.
    expect(steps.filter(st => st.kind === 'rule')).toHaveLength(1);
    expect(replies[1]).toMatch(/^Not done: There is no rule 9/);
  });
});

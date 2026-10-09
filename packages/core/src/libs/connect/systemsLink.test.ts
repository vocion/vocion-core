import { describe, expect, it } from 'vitest';
import { connectSystemsHref, connectSystemsInputOf, connectSystemsInputOfHref } from './systemsLink';

describe('the link into "Connect your systems"', () => {
  it('round-trips what to plan', () => {
    const href = connectSystemsHref({ app: 'gtm', named: ['slack', 'jira'] });

    expect(href).toBe('/dashboard/chat?objective=connect-systems&app=gtm&named=slack%2Cjira');
    expect(connectSystemsInputOfHref(href)).toEqual({ app: 'gtm', named: ['slack', 'jira'] });
    expect(connectSystemsInputOf({ objective: 'connect-systems' })).toEqual({});
  });

  it('drops anything that is not a slug, and is not the objective without its name', () => {
    expect(connectSystemsInputOf(new URLSearchParams('objective=connect-systems&app=../x&named=ok,<b>'))).toEqual({ named: ['ok'] });
    expect(connectSystemsInputOf({ app: 'gtm' })).toBeNull();
    expect(connectSystemsInputOfHref('/dashboard/chat')).toBeNull();
  });

  it('carries the lead\'s line for each step, one clean line per system', () => {
    const href = connectSystemsHref({ app: 'software-factory', say: { 'github': 'The factory reads your pull requests here.', 'bad slug': 'dropped', 'jira': '  two\nlines  ' } });
    const back = connectSystemsInputOfHref(href)!;

    expect(back.say).toEqual({ github: 'The factory reads your pull requests here.', jira: 'two lines' });
    expect(connectSystemsInputOfHref(connectSystemsHref({ say: { github: 'x'.repeat(400) } }))!.say!.github).toHaveLength(240);
    expect(connectSystemsInputOfHref(connectSystemsHref({ say: { github: '   ' } }))).toEqual({});
  });
});

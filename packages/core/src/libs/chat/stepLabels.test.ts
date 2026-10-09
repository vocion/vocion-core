import { describe, expect, it } from 'vitest';
import { echoesToolName, fallbackStepLabels, isSafeStepLabels, normalizeStepLabels, personFacingStepLabels, proposalStepLabels, restProposalWords, restSourceOfTool, stepLabelFor, stepProgressLabel } from './stepLabels';

describe('fallbackStepLabels', () => {
  it('names the act, not the mechanism, for the tools a person sees most', () => {
    expect(fallbackStepLabels('get_brand')).toEqual({ running: 'Reading the brand guide…', done: 'Read the brand guide' });
    expect(fallbackStepLabels('render_markdown').done).toBe('Wrote the document');
  });

  it('humanises an unknown tool from its verb and object, vendor first', () => {
    expect(fallbackStepLabels('hubspot_get_contact')).toEqual({ running: 'Reading the HubSpot contact…', done: 'Read the HubSpot contact' });
    expect(fallbackStepLabels('apollo_search_people')).toEqual({ running: 'Searching the Apollo people…', done: 'Searched the Apollo people' });
    // No verb it knows: the plain act, never the tool's own words back.
    expect(fallbackStepLabels('frobnicate_widgets')).toEqual({ running: 'Working on it…', done: 'Worked on it' });
  });

  it('picks the tense from the status, and says failed plainly', () => {
    const labels = fallbackStepLabels('get_brand');

    expect(stepLabelFor(labels, 'start')).toBe('Reading the brand guide…');
    expect(stepLabelFor(labels, 'done')).toBe('Read the brand guide');
    expect(stepLabelFor(labels, 'error')).toBe('Read the brand guide — failed');
  });
});

describe('model-written labels are checked before they are shown', () => {
  it('accepts a short two-tense pair', () => {
    expect(isSafeStepLabels({ running: 'Reading the brand guide', done: 'Read the brand guide' })).toBe(true);
    expect(normalizeStepLabels({ running: 'Reading the brand guide.', done: 'Read the brand guide…' })).toEqual({ running: 'Reading the brand guide…', done: 'Read the brand guide' });
  });

  it('refuses a label that claims an outcome the call cannot know', () => {
    expect(isSafeStepLabels({ running: 'Searching…', done: 'Found 3 matching deals' })).toBe(false);
    expect(isSafeStepLabels({ running: 'Verifying…', done: 'Verified successfully' })).toBe(false);
    expect(isSafeStepLabels({ running: 'Reading…', done: 'Completed the read' })).toBe(false);
  });

  it('refuses junk: missing tense, too long, markup', () => {
    expect(isSafeStepLabels({ running: 'x' })).toBe(false);
    expect(isSafeStepLabels({ running: 'a'.repeat(80), done: 'Read it' })).toBe(false);
    expect(isSafeStepLabels({ running: '<b>Reading</b>', done: 'Read' })).toBe(false);
  });
});

describe('a long step says where it has got to', () => {
  /**
   * "'working…' isn't much info" (Chris, twice, 2026-09-18). The note is
   * appended to the running label, never substituted for it, so a call that
   * stops reporting reads exactly as it did before.
   */
  it('appends the note to the running label and leaves the label alone without one', () => {
    const labels = { running: 'Rendering the document…', done: 'Rendered the document' };

    expect(stepProgressLabel(stepLabelFor(labels, 'progress'), 'sheet 7 of 12')).toBe('Rendering the document… sheet 7 of 12');
    expect(stepProgressLabel(stepLabelFor(labels, 'progress'))).toBe('Rendering the document…');
    expect(stepProgressLabel(stepLabelFor(labels, 'progress'), '  ')).toBe('Rendering the document…');
    expect(stepProgressLabel(stepLabelFor(labels, 'done'), 'sheet 7 of 12')).toBe('Rendered the document sheet 7 of 12');
  });
});

describe('a REST source\'s tools name the source, then the act', () => {
  const hints = { restSources: [
    { slug: 'acme-delivery', prefix: 'delivery', name: 'Acme Delivery API' },
    { slug: 'api', prefix: 'api', name: 'Short API' },
    { slug: 'api-v2', prefix: 'api_v2', name: 'Longer API' },
  ] };

  it('renders <prefix>_<name> as "<Source name> · <name humanised>", in both tenses', () => {
    expect(fallbackStepLabels('delivery_list_projects', hints)).toEqual({ running: 'Acme Delivery API · Listing projects…', done: 'Acme Delivery API · Listed projects' });
    expect(fallbackStepLabels('delivery_get_project', hints)).toEqual({ running: 'Acme Delivery API · Reading project…', done: 'Acme Delivery API · Read project' });
    expect(fallbackStepLabels('delivery_list_actions', hints)).toEqual({ running: 'Acme Delivery API · Listing actions…', done: 'Acme Delivery API · Listed actions' });
    // A name with no known verb still reads as the source, then the words.
    expect(fallbackStepLabels('delivery_milestones_due', hints)).toEqual({ running: 'Acme Delivery API · Running milestones due…', done: 'Acme Delivery API · Ran milestones due' });
  });

  it('matches the longest prefix, and leaves every other tool to the generic rules', () => {
    expect(restSourceOfTool('api_v2_list_users', hints)?.name).toBe('Longer API');
    expect(restSourceOfTool('api_list_users', hints)?.name).toBe('Short API');
    expect(restSourceOfTool('apix_list_users', hints)).toBeUndefined();
    expect(fallbackStepLabels('hubspot_get_contact', hints).done).toBe('Read the HubSpot contact');
    // Without hints the prefix is just a word, as it always was.
    expect(fallbackStepLabels('delivery_list_projects')).toEqual({ running: 'Working on it…', done: 'Worked on it' });
  });

  it('reads a rest.request proposal as "Proposed <action> on <source>", by display name when known, else the slug', () => {
    const args = { action_id: 'rest.request', action_input: { sourceSlug: 'acme-delivery', action: 'update_milestone', input: { documentId: 'm-12' }, summary: 'Move it.' } };

    expect(proposalStepLabels(args, hints)).toEqual({ running: 'Proposing update milestone on Acme Delivery API…', done: 'Proposed update milestone on Acme Delivery API' });
    expect(proposalStepLabels(args)).toEqual({ running: 'Proposing update milestone on acme-delivery…', done: 'Proposed update milestone on acme-delivery' });
    expect(restProposalWords(args.action_input, hints)).toBe('update milestone on Acme Delivery API');
  });

  it('leaves every other proposal, and a malformed rest.request, to the generic draft label', () => {
    expect(proposalStepLabels({ action_id: 'hubspot.update', action_input: { sourceSlug: 'hubspot' } }, hints)).toBeNull();
    expect(proposalStepLabels({ action_id: 'rest.request', action_input: { sourceSlug: 'acme-delivery' } }, hints)).toBeNull();
    expect(proposalStepLabels({ action_id: 'rest.request' }, hints)).toBeNull();
    expect(proposalStepLabels(undefined, hints)).toBeNull();
    expect(restProposalWords('nope')).toBeNull();
  });
});

/**
 * Founder, 2026-10-09: "Ran the offer connection", "Set up options, described
 * the setup and proposed the setup". A step that asks the person something or
 * sets something up says what it did for them.
 */
describe('what a step did for the person', () => {
  const hints = { connectorName: (slug: string) => ({ jira: 'Jira', github: 'GitHub' })[slug] ?? slug };

  it('says who was asked to connect what, from the call', () => {
    expect(personFacingStepLabels('offer_connection', { connector: 'jira' }, hints)).toEqual({ running: 'Asking you to connect Jira…', done: 'Asked you to connect Jira' });
    expect(personFacingStepLabels('connect_system', { named: ['github', 'jira'] }, hints)!.done).toBe('Asked you to connect GitHub and Jira');
    expect(personFacingStepLabels('connect_system', {}, hints)!.done).toBe('Asked you to connect your systems');
    expect(fallbackStepLabels('offer_connection', hints, { connector: 'github' }).done).toBe('Asked you to connect GitHub');
  });

  it('says the setup and the asks as outcomes', () => {
    expect(personFacingStepLabels('describe_setup', {})!.done).toBe('Checked what setup is left');
    expect(personFacingStepLabels('propose_setup', {})!.done).toBe('Put the next setup step in front of you');
    expect(personFacingStepLabels('file_ask', {})!.done).toBe('Asked you a question');
    expect(personFacingStepLabels('search_knowledge', {})).toBeNull();
  });

  it('refuses a model label that says the tool\'s name back', () => {
    expect(echoesToolName('Ran the offer connection', 'offer_connection')).toBe(true);
    expect(echoesToolName('Used offer_connection', 'offer_connection')).toBe(true);
    expect(echoesToolName('Asked you to connect Jira', 'offer_connection')).toBe(false);
    expect(isSafeStepLabels({ running: 'Running offer connection…', done: 'Ran offer connection' }, 'offer_connection')).toBe(false);
    expect(isSafeStepLabels({ running: 'Asking you to connect Jira…', done: 'Asked you to connect Jira' }, 'offer_connection')).toBe(true);
  });
});

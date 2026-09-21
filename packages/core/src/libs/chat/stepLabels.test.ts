import { describe, expect, it } from 'vitest';
import { fallbackStepLabels, isSafeStepLabels, normalizeStepLabels, stepLabelFor, stepProgressLabel } from './stepLabels';

describe('fallbackStepLabels', () => {
  it('names the act, not the mechanism, for the tools a person sees most', () => {
    expect(fallbackStepLabels('get_brand')).toEqual({ running: 'Reading the brand guide…', done: 'Read the brand guide' });
    expect(fallbackStepLabels('render_markdown').done).toBe('Wrote the document');
  });

  it('humanises an unknown tool from its verb and object, vendor first', () => {
    expect(fallbackStepLabels('hubspot_get_contact')).toEqual({ running: 'Reading the HubSpot contact…', done: 'Read the HubSpot contact' });
    expect(fallbackStepLabels('apollo_search_people')).toEqual({ running: 'Searching the Apollo people…', done: 'Searched the Apollo people' });
    expect(fallbackStepLabels('frobnicate_widgets')).toEqual({ running: 'Running the frobnicate widgets…', done: 'Ran the frobnicate widgets' });
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

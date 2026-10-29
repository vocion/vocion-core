import { describe, expect, it } from 'vitest';
import { givenRunLabel, hasOwnLabel, isMachineTitle, isSlugName, isTitledSlug, RUN_LABEL_MAX, runLabel } from './runLabel';

describe('isSlugName and isTitledSlug', () => {
  it('knows a slug, and a slug with its hyphens turned to spaces', () => {
    expect(isSlugName('seo-continue')).toBe(true);
    expect(isSlugName('software-factory/request')).toBe(true);
    expect(isSlugName('')).toBe(true);
    expect(isTitledSlug('Seo continue', 'seo-continue')).toBe(true);
    expect(isTitledSlug('SEO Continue', 'seo-continue')).toBe(true);
  });

  it('passes a name a person wrote', () => {
    expect(isSlugName('Seo continue')).toBe(false);
    expect(isTitledSlug('Month-end close', 'month-end-close')).toBe(false);
    expect(isTitledSlug('Finance', 'finance')).toBe(false);
    expect(isTitledSlug('Draft the release announcement', 'release-announcement-draft')).toBe(false);
  });
});

describe('isMachineTitle', () => {
  it('knows the `<slug>: <charter>` a fire used to write', () => {
    expect(isMachineTitle('seo-continue: Every client\'s SEO pages keep moving')).toBe(true);
    expect(isMachineTitle('Researching Google results and writing briefs · SB-506 Northwind: Boiler care')).toBe(false);
    expect(isMachineTitle('Review: the Q3 plan')).toBe(false);
  });
});

describe('givenRunLabel', () => {
  it('reads the label a fire was handed, on one line', () => {
    expect(givenRunLabel({ runLabel: '  Writing the sample drafts\n · SB-506  ' })).toBe('Writing the sample drafts · SB-506');
  });

  it('ignores what is not a label', () => {
    expect(givenRunLabel(null)).toBeNull();
    expect(givenRunLabel({})).toBeNull();
    expect(givenRunLabel({ runLabel: 42 })).toBeNull();
    expect(givenRunLabel({ runLabel: 'seo-continue' })).toBeNull();
    expect(givenRunLabel({ runLabel: '   ' })).toBeNull();
  });

  it('cuts a long one to a line in a list', () => {
    const label = givenRunLabel({ runLabel: `Drafting ${'and reviewing '.repeat(30)}` })!;

    expect(label.length).toBe(RUN_LABEL_MAX);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('runLabel', () => {
  const seo = { doing: 'Researching, briefing and drafting SEO pages', name: 'Research, brief, draft and review released SEO pages', fallback: 'Automation run' };

  it('names the run by the record it works on, when the code that knew it said', () => {
    expect(runLabel({ ...seo, given: 'Researching Google results and writing briefs · SB-506 Northwind: Boiler care (3 pages)' }))
      .toBe('Researching Google results and writing briefs · SB-506 Northwind: Boiler care (3 pages)');
  });

  it('falls back to the definition\'s present-tense words, then its name', () => {
    expect(runLabel(seo)).toBe('Researching, briefing and drafting SEO pages');
    expect(runLabel({ ...seo, doing: null })).toBe('Research, brief, draft and review released SEO pages');
  });

  it('never shows a slug or the old machine title', () => {
    expect(runLabel({ name: 'seo-continue', fallback: 'Automation run' })).toBe('Automation run');
    expect(runLabel({ given: 'seo-continue', doing: null, name: 'Weekly digest', fallback: 'Workflow run' })).toBe('Weekly digest');
    expect(runLabel({ stored: 'seo-continue: Every client\'s SEO pages keep moving', ...seo })).toBe('Researching, briefing and drafting SEO pages');
  });

  it('keeps a mission run\'s own stored title', () => {
    expect(runLabel({ stored: 'Reconcile the Northwind invoices', fallback: 'Mission run' })).toBe('Reconcile the Northwind invoices');
  });
});

describe('hasOwnLabel', () => {
  const auto = { name: 'Research, brief, draft and review released SEO pages', doing: 'Researching, briefing and drafting SEO pages' };

  it('is true for a label set from the record, false for the automation\'s own words or the machine title', () => {
    expect(hasOwnLabel('Writing the sample drafts · SB-506', auto)).toBe(true);
    expect(hasOwnLabel('Researching, briefing and drafting SEO pages', auto)).toBe(false);
    expect(hasOwnLabel('Research, brief, draft and review released SEO pages', auto)).toBe(false);
    expect(hasOwnLabel('seo-continue: Every client\'s SEO pages keep moving', auto)).toBe(false);
    expect(hasOwnLabel(null, auto)).toBe(false);
  });
});

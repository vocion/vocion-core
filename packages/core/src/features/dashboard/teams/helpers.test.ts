/**
 * F1 slice 3 — the org chart's display contract, tested where the
 * acceptance criteria live:
 *  - provenance labeling: explicit owner = bare name; inherited owner =
 *    the mandated VISIBLE text "«Name» (workspace default)" (mock
 *    walkthrough fix; acceptance #6) — asserted through the real en.json
 *    messages, not copies of them;
 *  - degraded states: lead-less teams, ungrouped agents, no-owner-anywhere
 *    (acceptance #10–12);
 *  - the sample-seed button renders ONLY at zero teams (plan decision 2).
 */

import type { TeamAgent } from '@/services/TeamService';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import {
  approvalBoundary,
  consultCoverage,
  hasOwnerAnywhere,
  initials,
  ownerDisplayName,
  ownerProvenance,
  showSeedSampleButton,
  ungroupedAgents,
} from './helpers';

const t = createTranslator({ locale: 'en', messages: en, namespace: 'Teams' });

const owner = (source: 'team' | 'workspace') => ({
  userId: 'u1',
  name: 'Chris Fitkin',
  email: 'chris@example.com',
  source,
});

const agent = (slug: string, teamSlug: string | null = null): TeamAgent => ({
  slug,
  name: slug,
  description: null,
  icon: null,
  accent: null,
  teamSlug,
});

describe('owner provenance labeling (acceptance #6)', () => {
  it('classifies explicit vs inherited vs missing', () => {
    expect(ownerProvenance(owner('team'))).toBe('explicit');
    expect(ownerProvenance(owner('workspace'))).toBe('inherited');
    expect(ownerProvenance(null)).toBe('missing');
  });

  it('renders the inherited owner as visible text — "Name (workspace default)", not a glyph', () => {
    const label = t('owner_inherited', { name: ownerDisplayName(owner('workspace')) });

    expect(label).toBe('Chris Fitkin (workspace default)');
  });

  it('an explicit owner is the bare name — no workspace-default suffix', () => {
    const name = ownerDisplayName(owner('team'));

    expect(name).toBe('Chris Fitkin');
    expect(name).not.toContain('workspace default');
  });

  it('a missing owner renders the warning label, never a blank', () => {
    expect(t('owner_missing')).toBe('No owner');
  });

  it('falls back to email when the user has no display name', () => {
    expect(ownerDisplayName({ name: null, email: 'lili@example.com' })).toBe('lili@example.com');
    expect(ownerDisplayName({ name: '  ', email: 'lili@example.com' })).toBe('lili@example.com');
  });

  it('builds avatar initials from names and emails', () => {
    expect(initials('Chris Fitkin')).toBe('CF');
    expect(initials('Lili')).toBe('L');
    expect(initials('lili.chen@example.com')).toBe('LC');
  });
});

describe('workspace-lead band coverage (acceptance #11)', () => {
  it('reports full coverage when every team has a lead', () => {
    const coverage = consultCoverage([{ lead: agent('a') }, { lead: agent('b') }]);

    expect(coverage).toEqual({ consulted: 2, total: 2, partial: false });
  });

  it('reports partial coverage — "consults N of M teams" — when a team is lead-less', () => {
    const coverage = consultCoverage([{ lead: agent('a') }, { lead: null }, { lead: null }]);

    expect(coverage.partial).toBe(true);
    expect(t('consults_partial', { consulted: coverage.consulted, total: coverage.total }))
      .toContain('Consults 1 of 3 teams');
  });
});

describe('ungrouped agents strip (parentless agents render, never vanish)', () => {
  const teams = [{ slug: 'revops' }];

  it('collects agents with no team and agents whose team slug dangles', () => {
    const agents = [agent('on-team', 'revops'), agent('loose'), agent('dangling', 'ghost-team')];

    expect(ungroupedAgents(agents, teams, null).map(a => a.slug)).toEqual(['dangling', 'loose']);
  });

  it('excludes the workspace lead — it has the band, not the strip', () => {
    const agents = [agent('revenue-director'), agent('hiring-manager')];

    expect(ungroupedAgents(agents, teams, 'revenue-director').map(a => a.slug)).toEqual(['hiring-manager']);
  });
});

describe('sample-seed button gating (plan decision 2)', () => {
  it('renders ONLY when the workspace has zero teams', () => {
    expect(showSeedSampleButton(0)).toBe(true);
    expect(showSeedSampleButton(1)).toBe(false);
    expect(showSeedSampleButton(4)).toBe(false);
  });
});

describe('no-owner-anywhere warning (acceptance #12)', () => {
  it('is quiet when the workspace default exists', () => {
    expect(hasOwnerAnywhere({ accountable: owner('workspace') }, [{ accountable: null }])).toBe(true);
  });

  it('is quiet when any team has its own owner', () => {
    expect(hasOwnerAnywhere({ accountable: null }, [{ accountable: null }, { accountable: owner('team') }])).toBe(true);
  });

  it('fires when neither the workspace nor any team names an owner', () => {
    expect(hasOwnerAnywhere({ accountable: null }, [{ accountable: null }, { accountable: null }])).toBe(false);
    expect(t('no_owner_banner')).toContain('Set a workspace owner');
  });
});

describe('approval boundary derivation (design §2b "what runs free / what waits")', () => {
  const skills = [
    { slug: 'read-pipeline', category: 'query', requiresApproval: null },
    { slug: 'send-email', category: 'mutation', requiresApproval: null },
    { slug: 'run-play', category: 'composite', requiresApproval: 'true' },
  ];

  it('counts wired skills once across members and flags the gated ones', () => {
    const boundary = approvalBoundary(
      [['read-pipeline', 'send-email'], ['send-email', 'run-play'], null],
      skills,
    );

    expect(boundary).toEqual({ total: 3, gated: 2 });
  });

  it('reports an empty boundary for a team with nothing wired', () => {
    expect(approvalBoundary([null, []], skills)).toEqual({ total: 0, gated: 0 });
  });
});

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AgentManifestSchema } from '@/libs/workspace/schemas';
import { catalogRoot, getCatalogEntry, listCatalog, listCatalogTeams, readCatalogSkill } from '@/services/CatalogService';

/**
 * The catalog's own integrity, checked against the real schema rather than a
 * fixture. These are the invariants the marketplace design rests on: an entry
 * composes skills that exist, names connector categories rather than vendors,
 * and declares no permissions. Break one and the failure is a catalog somebody
 * cannot trust, not a broken build — which is exactly why it needs a test.
 */

const ROOT = catalogRoot();

/**
 * Vendor names that must never appear in a `requires` block. A category is
 *  the contract; naming a product here would let one entry quietly prefer a
 *  vendor and would make "needs a ledger" unrenderable.
 */
const VENDOR_NAMES = [
  'salesforce',
  'hubspot',
  'zoho',
  'pipedrive',
  'quickbooks',
  'xero',
  'netsuite',
  'myob',
  'sage',
  'gmail',
  'outlook',
  'office365',
  'microsoft365',
  'slack',
  'teams',
  'zoom',
  'notion',
  'confluence',
  'jira',
  'asana',
  'linear',
  'monday',
  'clickup',
  'workday',
  'bamboohr',
  'gusto',
  'greenhouse',
  'lever',
  'stripe',
  'paypal',
  'square',
  'shopify',
  'figma',
  'github',
  'gitlab',
  'docusign',
];

describe('catalog tree', () => {
  it('ships a catalog with agents and skills', () => {
    expect(existsSync(join(ROOT, 'pack.yaml'))).toBe(true);
    expect(readdirSync(join(ROOT, 'agents')).length).toBeGreaterThan(0);
    expect(readdirSync(join(ROOT, 'skills')).length).toBeGreaterThan(0);
  });

  it('every agent manifest validates against AgentManifestSchema', () => {
    const files = readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      const raw = parseYaml(readFileSync(join(ROOT, 'agents', file), 'utf8'));

      // .parse throws with the offending path, which is the message we want
      // on a broken manifest — do not soften it to safeParse.
      expect(() => AgentManifestSchema.parse(raw), file).not.toThrow();
    }
  });

  it('agent filename matches its slug', () => {
    for (const file of readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.yaml'))) {
      const manifest = AgentManifestSchema.parse(parseYaml(readFileSync(join(ROOT, 'agents', file), 'utf8')));

      expect(`${manifest.slug}.yaml`).toBe(file);
    }
  });
});

describe('entries compose, they do not inline', () => {
  it('every skill an agent names exists in the library', () => {
    const library = new Set(readdirSync(join(ROOT, 'skills')));
    const missing: string[] = [];
    for (const entry of listCatalog(ROOT)) {
      for (const skill of entry.skills) {
        if (!library.has(skill)) {
          missing.push(`${entry.slug} → ${skill}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('every skill in the library is reached by at least one agent', () => {
    const reached = new Set(listCatalog(ROOT).flatMap(e => e.skills));
    const orphans = readdirSync(join(ROOT, 'skills')).filter(s => !reached.has(s));

    // An orphan skill is speculation — built ahead of a caller, which is the
    // thing the forcing function exists to prevent.
    expect(orphans).toEqual([]);
  });

  it('every skill folder has a SKILL.md with a readable body', () => {
    for (const slug of readdirSync(join(ROOT, 'skills'))) {
      const skill = readCatalogSkill(slug, ROOT);

      expect(skill, slug).not.toBeNull();
      expect(skill!.body.length, slug).toBeGreaterThan(200);
      expect(skill!.body.startsWith('---'), slug).toBe(false);
    }
  });

  it('skill frontmatter slug matches its folder', () => {
    for (const slug of readdirSync(join(ROOT, 'skills'))) {
      const raw = readFileSync(join(ROOT, 'skills', slug, 'SKILL.md'), 'utf8');

      expect(raw, slug).toContain(`slug: ${slug}\n`);
    }
  });
});

describe('requires names categories, never vendors', () => {
  it('no connector category is a product name', () => {
    const offenders: string[] = [];
    for (const entry of listCatalog(ROOT)) {
      for (const category of [...entry.requires, ...entry.optional]) {
        if (VENDOR_NAMES.includes(category.toLowerCase())) {
          offenders.push(`${entry.slug} requires "${category}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every entry declares a files-only degradation path', () => {
    for (const file of readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.yaml'))) {
      const manifest = AgentManifestSchema.parse(parseYaml(readFileSync(join(ROOT, 'agents', file), 'utf8')));

      // A missing connector picks a tier; it never fails the entry.
      expect(manifest.requires.degradesTo, file).toBe('files');
    }
  });

  it('no entry needs more than one connector category to run', () => {
    // An entry gated on several categories at once is unusable until an
    // implementation has done a lot of integration work — which is exactly
    // what hiring is meant not to wait on.
    for (const entry of listCatalog(ROOT)) {
      expect(entry.requires.length, entry.slug).toBeLessThanOrEqual(1);
    }
  });
});

describe('every entry belongs to a team', () => {
  it('each agent names a team that exists in teams/', () => {
    // `assertTeams` only validates team refs once a workspace defines teams,
    // so an unresolvable ref here would pass the loader and surface later as
    // an agent stranded in the "not on a team yet" strip.
    const teams = listCatalogTeams(ROOT);
    const dangling = listCatalog(ROOT)
      .filter(e => !e.team || !teams.has(e.team))
      .map(e => `${e.slug} → ${e.team ?? '(none)'}`);

    expect(dangling).toEqual([]);
  });

  it('every team has at least one member', () => {
    const claimed = new Set(listCatalog(ROOT).map(e => e.team));
    const empty = [...listCatalogTeams(ROOT).keys()].filter(t => !claimed.has(t));

    expect(empty).toEqual([]);
  });

  it('every team\'s lead is an agent in the catalog, on that team', () => {
    const bySlug = new Map(listCatalog(ROOT).map(e => [e.slug, e]));
    const bad: string[] = [];
    for (const team of listCatalogTeams(ROOT).values()) {
      if (!team.lead) {
        continue;
      }
      const lead = bySlug.get(team.lead);
      if (!lead) {
        bad.push(`${team.slug}: lead "${team.lead}" is not a catalog agent`);
      } else if (lead.team !== team.slug) {
        bad.push(`${team.slug}: lead "${team.lead}" is on team "${lead.team}"`);
      }
    }

    expect(bad).toEqual([]);
  });

  it('carries the team name, which is what the card renders', () => {
    for (const entry of listCatalog(ROOT)) {
      expect(entry.teamName, entry.slug).toBeTruthy();
    }
  });

  it('a missing teams directory reads as no teams, not a throw', () => {
    expect(listCatalogTeams('/tmp/definitely-not-a-catalog-dir').size).toBe(0);
  });
});

describe('entries declare no permissions', () => {
  it('no manifest carries a permission or tier field', () => {
    // Whether an agent may write belongs to the installation. A definition
    // asserting its own tier is a package making a claim about somebody
    // else's org — and a careless one would simply claim the highest.
    const banned = /^\s*(?:ships_at|shipsAt|tier|permissions|writeAccess|write_access)\s*:/m;
    for (const file of readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.yaml'))) {
      const raw = readFileSync(join(ROOT, 'agents', file), 'utf8');

      expect(banned.test(raw), `${file} declares a permission field`).toBe(false);
    }
  });
});

describe('entries carry a real system prompt', () => {
  it('every entry has a substantive prompt and description', () => {
    for (const file of readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.yaml'))) {
      const manifest = AgentManifestSchema.parse(parseYaml(readFileSync(join(ROOT, 'agents', file), 'utf8')));

      expect(manifest.systemPrompt, file).toBeTruthy();
      expect(manifest.systemPrompt!.length, file).toBeGreaterThan(300);
      expect(manifest.systemPrompt, file).not.toMatch(/TODO/);
      expect(manifest.description, file).toBeTruthy();
    }
  });

  it('no prompt hardcodes a standard that should be an authored playbook', () => {
    // The tell: a prompt naming specific taxonomy values, thresholds or
    // frameworks is a concretion wearing a catalog entry's clothes, and it
    // stops being reusable the moment a second client sees it.
    const concretions = /\bP[0-4]\s*[-–—/]|MEDDIC|BANT|SPIN selling|\b(?:30|60|90)-day trial\b/i;
    for (const file of readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.yaml'))) {
      const manifest = AgentManifestSchema.parse(parseYaml(readFileSync(join(ROOT, 'agents', file), 'utf8')));

      expect(concretions.test(manifest.systemPrompt ?? ''), `${file} hardcodes a client standard`).toBe(false);
    }
  });
});

describe('lookup', () => {
  it('getCatalogEntry finds a known entry and misses an unknown one', () => {
    const all = listCatalog(ROOT);
    const first = all[0]!;

    expect(getCatalogEntry(first.slug, ROOT)?.name).toBe(first.name);
    expect(getCatalogEntry('no-such-agent', ROOT)).toBeNull();
  });

  it('listCatalog is sorted by name', () => {
    const names = listCatalog(ROOT).map(e => e.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('a missing catalog directory reads as an empty catalog, not a throw', () => {
    expect(listCatalog('/tmp/definitely-not-a-catalog-dir')).toEqual([]);
  });

  it('readCatalogSkill returns null for an unknown slug', () => {
    expect(readCatalogSkill('no-such-skill', ROOT)).toBeNull();
  });
});

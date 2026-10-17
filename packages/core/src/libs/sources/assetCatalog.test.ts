import { describe, expect, it } from 'vitest';
import { rankAssets } from '@/services/personalization/assetCatalog';
import { assetDoc, configCatalogRows, dedupeByUrl, normalizeAssetUrl, parseCatalogGrid } from './assetCatalog';

// The shape of a marketing team's asset sheet: a title row, then headers.
const GRID: unknown[][] = [
  ['Northwind | Sales & Marketing Asset Guide'],
  ['Asset Title', 'Asset Type', 'Funnel Stage', 'Topic / Theme', 'Persona / Role', 'Industry / Vertical', 'Gated?', 'What It\'s For', 'Buyer Question It Answers', 'Suggested Next Step / CTA', 'Page Link', 'File Link'],
  ['Field Crews Case Study', 'Case Study', 'MOFU', 'Field Operations', 'COO', 'Construction', 'Yes', 'How field data became reportable', 'What changes on the job site?', '', 'N/A', 'https://files.northwind.example/crews.pdf'],
  ['Construction Blueprint', 'Blueprint', 'BOFU', 'AI Roles', 'COO', 'Construction', 'Yes', 'A governed workforce for construction', 'What would it look like here?', 'Book a call', 'https://www.northwind.example/whitepapers/construction-blueprint', 'https://files.northwind.example/blueprint.pdf'],
  ['Workflow Scorecard', 'Scorecard', 'MOFU', 'AI Strategy', 'COO', 'All industries', 'Yes', 'Rank which workflow to automate first', 'Which workflow first?', '', 'https://www.northwind.example/whitepapers/scorecard', ''],
  ['Agency Case Study', 'Case Study', 'MOFU', 'Revenue Ops', 'Agency Owner', 'Marketing Agencies', 'Yes', 'GTM as governed workflows', 'What does it change?', '', 'N/A', ''],
  ['Ungated Guide', 'Blog', 'TOFU', 'AI Strategy', 'CEO', 'All industries', 'No', 'A point of view', 'Where to start?', '', '', 'https://files.northwind.example/guide.pdf'],
  ['Construction Blueprint (again)', 'Blueprint', 'BOFU', 'AI Roles', 'COO', 'Construction', 'Yes', '', '', '', 'https://northwind.example/whitepapers/construction-blueprint/', ''],
];

describe('reading an asset sheet', () => {
  const parsed = parseCatalogGrid(GRID, 'sheet:abc');

  it('finds the header below a title row and reads columns by name', () => {
    expect(parsed.rows.map(r => r.title)).toEqual(['Construction Blueprint', 'Workflow Scorecard', 'Ungated Guide', 'Construction Blueprint (again)']);
    expect(parsed.rows[0]).toMatchObject({ type: 'Blueprint', funnelStage: 'BOFU', industry: 'Construction', gated: true, cta: 'Book a call', origin: 'sheet:abc' });
  });

  it('links a gated asset\'s landing page, never its file, and skips one that has only a file', () => {
    expect(parsed.rows[0]!.url).toBe('https://www.northwind.example/whitepapers/construction-blueprint');
    expect(parsed.skipped).toContainEqual({ title: 'Field Crews Case Study', why: expect.stringMatching(/gated, and only a file link/) });
  });

  it('links an ungated asset\'s file when it has no page, and skips a row with no link at all', () => {
    expect(parsed.rows.find(r => r.title === 'Ungated Guide')?.url).toBe('https://files.northwind.example/guide.pdf');
    expect(parsed.skipped).toContainEqual({ title: 'Agency Case Study', why: 'no link' });
  });

  it('keeps the first row for a link and names the duplicate', () => {
    const unique = dedupeByUrl(parsed.rows);

    expect(unique.rows.map(r => r.title)).not.toContain('Construction Blueprint (again)');
    expect(unique.skipped).toEqual([{ title: 'Construction Blueprint (again)', why: 'same link as "Construction Blueprint"' }]);
  });

  it('says so when a sheet has no header it can read', () => {
    expect(parseCatalogGrid([['just', 'words']], 'sheet:x').skipped[0]!.why).toMatch(/no header row/);
  });
});

describe('links compared by what they point at', () => {
  it('ignores scheme case, www, query, fragment and trailing slash', () => {
    expect(normalizeAssetUrl('https://WWW.Northwind.example/tools/roi/?utm_source=x#top')).toBe(normalizeAssetUrl('https://northwind.example/tools/roi'));
  });

  it('files each row under a stable id from its link', () => {
    const [a] = configCatalogRows([{ title: 'ROI Calculator', type: 'Tool', url: 'https://northwind.example/tools/roi' }]);

    expect(assetDoc(a!).externalId).toBe(assetDoc({ ...a!, url: 'https://www.northwind.example/tools/roi/' }).externalId);
    expect(assetDoc(a!).metadata).toMatchObject({ kind: 'asset', title: 'ROI Calculator', origin: 'config' });
  });
});

describe('ranking for a lead', () => {
  const assets = [
    ...parseCatalogGrid(GRID, 'sheet:abc').rows,
    ...configCatalogRows([{ title: 'ROI Calculator', type: 'Tool', funnelStage: 'MOFU', industry: 'All industries', url: 'https://northwind.example/tools/roi' }]),
  ].map((r, i) => ({ ...r, id: i + 1 }));

  it('puts the lead\'s industry first, then assets for every industry, and drops other industries', () => {
    const ranked = rankAssets(assets, { industry: 'construction' }).map(a => a.title);

    expect(ranked[0]).toMatch(/Construction Blueprint/);
    expect(ranked).toContain('ROI Calculator');
    expect(rankAssets(assets, { industry: 'education' }).map(a => a.title)).not.toContain('Construction Blueprint');
  });

  it('narrows by stage and type, and never offers a link that did not answer', () => {
    expect(rankAssets(assets, { funnelStage: 'MOFU', type: 'Tool' }).map(a => a.title)).toEqual(['ROI Calculator']);
    expect(rankAssets(assets.map(a => ({ ...a, linkOk: a.title !== 'ROI Calculator' })), { type: 'Tool' })).toEqual([]);
  });
});

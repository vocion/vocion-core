import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromRepoRoot } from '@/libs/repo-root';
import { contractFromTask, deriveContract, runnerEnvironment, runnerSurfaces } from './factory-dispatch';

// The runner's own validator and schema (packages/runner): the one contract both sides hold to.
// Loaded by path, since the runner is plain ESM with no type declarations.
type RunnerContract = {
  validateContract: (raw: unknown) => { ok: boolean; errors: string[] };
  normalizeQa: (qa: unknown) => { surfaces: Record<string, { build?: { command?: string } }> } | null;
};
const { normalizeQa, validateContract } = await import(pathToFileURL(fromRepoRoot('packages/runner/src/contract.mjs')).href) as RunnerContract;

// Backlog 052: what the runner needs to build a repository comes from its repo record and the
// product's environments, never from the runner's code. Every name below is invented.

const repo = {
  title: 'Acme/northwind-portal',
  checks: [{ name: 'test', command: 'npm test -- --run' }, { name: 'typecheck' }, { name: 'e2e-local', command: 'npx playwright test --project local' }],
  riskDefaults: { 'apps/web/**': 'ui' },
  productPaths: { portal: ['apps/web/**'] },
  qaSurface: 'app',
  surfaces: {
    app: {
      environment: 'web',
      build: { command: 'npm run build -w @northwind/web', dist: 'apps/web/dist', port: 5274, spaFallback: true, env: { VITE_API_URL: 'https://api.northwind.example' }, signedInEnv: { VITE_MOCK_API: '1' } },
      listRoutes: ['/library'],
      errorText: ['Nothing at this address'],
      previewNote: 'The preview answers from apps/web/src/mock.',
    },
  },
  services: [{ name: 'postgres', url: 'postgresql://runner:runner@localhost:55432/portal', setup: ['npm run db:migrate -w @northwind/api'] }],
  humanOwned: ['infra/secrets/**'],
  engineerRules: ['Short declaratives, plain nouns.'],
};
const environments = [
  { surface: 'web', stage: 'production', url: 'https://app.northwind.example/' },
  { surface: 'web', stage: 'staging', url: 'https://staging.northwind.example' },
  { surface: 'api', stage: 'production', url: 'https://api.northwind.example' },
];
const request = { title: 'Find a document', product: 'portal', surface: 'ui', outcome: 'A person finds a document by name.', acceptance: ['Typing narrows the list.'], visuals: { surfaceUrl: 'https://app.northwind.example/library' } };

describe('the runner contract from the records (backlog 052)', () => {
  it('reads each surface\'s live URL from the production environment that serves it, and its build from the repo record', () => {
    expect(runnerSurfaces(repo, environments)).toEqual({
      app: {
        live_url: 'https://app.northwind.example',
        build: { command: 'npm run build -w @northwind/web', dist: 'apps/web/dist', port: 5274, spa_fallback: true, env: { VITE_API_URL: 'https://api.northwind.example' }, signed_in_env: { VITE_MOCK_API: '1' } },
        list_routes: ['/library'],
        error_text: ['Nothing at this address'],
        preview_note: 'The preview answers from apps/web/src/mock.',
      },
    });
    // No environment serves it: no live URL, and the before shot says so.
    expect(runnerSurfaces(repo, [])).not.toHaveProperty('app.live_url');
    expect(runnerSurfaces({}, environments)).toEqual({});
  });

  it('carries the repo record\'s services, check commands, owned files and rules into the contract', () => {
    const meta = deriveContract({ given: {}, request, plan: null, repo, environments });
    const contract = contractFromTask({ id: 41, title: String(meta.title), meta: { ...meta, requestId: 12 } }, { product: 'portal' });

    expect(contract.environment).toEqual({ services: repo.services });
    // Every check the repo defines is required; the two with a command carry it, typecheck is a built-in.
    expect(contract.required_checks).toEqual(['test', 'typecheck', 'e2e-local']);
    expect(contract.checks).toEqual([{ name: 'test', command: 'npm test -- --run' }, { name: 'e2e-local', command: 'npx playwright test --project local' }]);
    expect(contract.human_owned).toEqual(['infra/secrets/**']);
    expect(contract.engineer_rules).toEqual(['Short declaratives, plain nouns.']);
    expect((contract.qa as { surface: string; surfaces: Record<string, unknown> }).surface).toBe('app');
    expect((contract.qa as { surfaces: Record<string, { live_url?: string }> }).surfaces.app?.live_url).toBe('https://app.northwind.example');
  });

  it('stays a contract the runner accepts when the request is titled with a whole long ask (Walk 18, FE-419)', () => {
    const meta = deriveContract({ given: {}, request, plan: null, repo, environments });
    const long = 'On the portal\'s room list, let me sort the rooms by name, created date or last visited, newest first by default, and remember my choice next time I open the list';
    const contract = contractFromTask({ id: 41, title: long, meta: { ...meta, requestId: 12 } }, { product: 'portal' });

    expect(validateContract(contract)).toEqual({ ok: true, errors: [] });
    expect(String(contract.title).length).toBeLessThanOrEqual(120);
    expect(String(contract.title)).toMatch(/^On the portal's room list, let me sort .*…$/);
  });

  it('is labelled with the work\'s ticket-sized name when it has one (Chris, 2026-10-03)', () => {
    const meta = deriveContract({ given: {}, request, plan: null, repo, environments });
    const long = 'On the portal\'s room list, let me sort the rooms by name, created date or last visited, newest first by default, and remember my choice next time I open the list';
    const contract = contractFromTask({ id: 41, title: long, meta: { ...meta, requestId: 12, name: 'Sort the room list by name, date or last visited' } }, { product: 'portal' });

    expect(contract.title).toBe('Sort the room list by name, date or last visited');
    expect(validateContract(contract)).toEqual({ ok: true, errors: [] });
  });

  it('is a contract the runner accepts, validated by the runner\'s own schema', () => {
    const meta = deriveContract({ given: {}, request, plan: null, repo, environments });
    const contract = contractFromTask({ id: 41, title: String(meta.title), meta: { ...meta, requestId: 12 } }, { product: 'portal' });

    expect(validateContract(contract)).toEqual({ ok: true, errors: [] });
    expect(normalizeQa(contract.qa)?.surfaces.app?.build?.command).toBe('npm run build -w @northwind/web');
  });

  it('keeps the older environment block working, with services over it', () => {
    expect(runnerEnvironment({ environment: { services: ['postgres'] } })).toEqual({ services: ['postgres'] });
    expect(runnerEnvironment({ environment: { services: ['postgres'] }, services: [{ name: 'postgres', url: 'postgresql://x@localhost/y' }] })).toEqual({ services: [{ name: 'postgres', url: 'postgresql://x@localhost/y' }] });
    expect(runnerEnvironment({})).toBeUndefined();
  });
});

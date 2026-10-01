import { describe, expect, it } from 'vitest';
import { productionErrorsLine } from './factory-dispatch';

describe('what production recorded rides the engineer\'s objective', () => {
  it('names each issue, its request, release and the product\'s frames', () => {
    const line = productionErrorsLine({ errors: [{ source: 'sentry', shortId: 'NW-API-3', title: 'EngineInitError: engine not found', culprit: 'GET /v1/orgs', request: 'GET https://api.northwind.example/v1/orgs → 500', release: 'aaaaaaa1111111111', events: 184, url: 'https://northwind.sentry.io/issues/77/', frames: ['packages/core/src/auth/plugin.ts:210 in Object.?'] }] });

    expect(line).toBe('\n\nWhat production recorded (start from the frame that threw):\n- NW-API-3: EngineInitError: engine not found (at GET /v1/orgs; GET https://api.northwind.example/v1/orgs → 500; first seen in release aaaaaaa11111; 184 events; https://northwind.sentry.io/issues/77/)\n  Stack (the product\'s frames, innermost last):\n    packages/core/src/auth/plugin.ts:210 in Object.?');
  });

  it('is nothing when the request carries no error', () => {
    expect(productionErrorsLine({ urls: ['https://x.example'] })).toBe('');
    expect(productionErrorsLine(undefined)).toBe('');
  });
});

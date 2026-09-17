import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import committedDocument from '../libs/openapi/openapi.generated.json';
import { routeFileToApiPath } from '../libs/openapi/parseRouteModule';
import {
  GENERATED_SPEC_PATH,
  generateOpenApiDocument,
  listRouteFiles,
  serializeDocument,
  V1_ROUTES_DIRECTORY,
} from './generate-openapi';

/**
 * The spec is committed so the app can serve it in production, which means it
 * is a copy of something else and copies go stale. This is the test that stops
 * that: add an endpoint without regenerating and CI says so, in the same run
 * that would otherwise have shipped an API nobody could read.
 */

const document = committedDocument as unknown as {
  openapi: string;
  paths: Record<string, Record<string, {
    operationId: string;
    summary: string;
    tags: string[];
    parameters?: { name: string; in: string }[];
    responses: Record<string, { description: string; content: Record<string, { schema: Record<string, unknown> }> }>;
  }>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
};

describe('the committed OpenAPI document', () => {
  it('is what the route handlers generate today', () => {
    const regenerated = serializeDocument(generateOpenApiDocument(V1_ROUTES_DIRECTORY, readVersion()));

    expect(readFileSync(GENERATED_SPEC_PATH, 'utf-8')).toBe(regenerated);
  });

  it('documents every route file under /api/v1', () => {
    const documented = new Set(Object.keys(document.paths));
    const missing = listRouteFiles(V1_ROUTES_DIRECTORY)
      .map(routeFileToApiPath)
      .filter(path => !documented.has(path));

    expect(missing).toEqual([]);
  });

  it('describes an endpoint per route file, not one shared entry', () => {
    expect(Object.keys(document.paths).length).toBe(listRouteFiles(V1_ROUTES_DIRECTORY).length);
  });
});

describe('the document is usable by a client generator', () => {
  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
  );

  it('is OpenAPI 3.1 with the security scheme the API actually accepts', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.components.securitySchemes).toHaveProperty('bearerToken');
  });

  it('gives every operation a unique id', () => {
    const ids = operations.map(entry => entry.operation.operationId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every operation a summary, a tag and at least one response', () => {
    for (const { path, method, operation } of operations) {
      expect(operation.summary, `${method} ${path}`).not.toBe('');
      expect(operation.tags.length, `${method} ${path}`).toBeGreaterThan(0);
      expect(Object.keys(operation.responses).length, `${method} ${path}`).toBeGreaterThan(0);
    }
  });

  it('declares every parameter its path template names', () => {
    for (const { path, method, operation } of operations) {
      const templated = [...path.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
      const declared = (operation.parameters ?? []).filter(parameter => parameter.in === 'path').map(parameter => parameter.name);

      expect(declared.sort(), `${method} ${path}`).toEqual(templated.sort());
    }
  });

  it('answers every failure with the shared error envelope', () => {
    for (const { path, method, operation } of operations) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400) {
          continue;
        }

        expect(response.content['application/json']?.schema, `${method} ${path} ${status}`)
          .toEqual({ $ref: '#/components/schemas/Error' });
      }
    }
  });

  it('says a 401 is possible everywhere, because every endpoint authenticates', () => {
    const unauthenticated = operations
      .filter(entry => !Object.keys(entry.operation.responses).includes('401'))
      .map(entry => `${entry.method} ${entry.path}`);

    expect(unauthenticated).toEqual([]);
  });
});

/** The version the generator publishes, read the way the generator reads it. */
function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version?: string };
  return packageJson.version ?? '0.0.0';
}

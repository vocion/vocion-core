/**
 * The shapes the OpenAPI document publishes for each route's answers (#1196),
 * read from fixture routes compiled beside the real ones. What these pin is
 * that a client generator gets the JSON the route really sends: what
 * `JSON.stringify` writes, which fields can be missing or null, and which
 * values a field can only ever hold.
 */
import type ts from 'typescript';
import type { JsonSchema } from './responseSchema';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fromRepoRoot } from '../repo-root';
import { parseRouteModule } from './parseRouteModule';
import { createRouteProgram } from './routeProgram';

/** Where the fixture routes pretend to live, so their imports resolve as real routes' do. */
const FIXTURE_DIRECTORY = fromRepoRoot('packages/core/src/app/api/v1/__openapi_fixtures__');

/** Fixture route sources, by name. Each is served from memory, never written to disk. */
const FIXTURES: Record<string, string> = {
  'json-semantics': `
import { NextResponse } from 'next/server';

type Run = {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  note?: string;
  error: string | undefined;
  retry: () => void;
  labels: Record<string, number>;
};

declare function loadRun(): Promise<Run>;

/** GET /api/v1/fixture — one run. */
export async function GET() {
  return NextResponse.json({ run: await loadRun() });
}
`,
  'literals': `
import { NextResponse } from 'next/server';

declare const decision: 'reject' | 'approve' | 'snooze';
declare const priority: 3 | 1 | 2;
declare const urgent: boolean;

/** POST /api/v1/fixture — decide. */
export async function POST() {
  return NextResponse.json({ ok: true, decision, priority, urgent, kind: 'review' as const });
}
`,
  'to-json': `
import { NextResponse } from 'next/server';

class Money {
  constructor(private readonly cents: number) {}
  toJSON(): { cents: number; currency: string } {
    return { cents: this.cents, currency: 'USD' };
  }
}

/** GET /api/v1/fixture — a price. */
export async function GET() {
  return NextResponse.json({ price: new Money(100) });
}
`,
  'recursive': `
import { NextResponse } from 'next/server';

type Folder = { name: string; children: Folder[] };

declare const root: Folder;

/** GET /api/v1/fixture — a folder tree. */
export async function GET() {
  return NextResponse.json({ root });
}
`,
  'two-shapes': `
import { NextResponse } from 'next/server';

/** POST /api/v1/fixture — run now or later. */
export async function POST(req: Request) {
  if (req.headers.get('prefer') === 'respond-async') {
    return NextResponse.json({ runId: 7 }, { status: 202 });
  }
  if (req.headers.get('x-dry-run')) {
    return NextResponse.json({ ok: true, dryRun: true });
  }
  if (req.headers.get('x-same')) {
    return NextResponse.json({ ok: true, dryRun: true });
  }
  return NextResponse.json({ result: 'done' });
}
`,
  'unreadable': `
import { NextResponse } from 'next/server';

declare const loose: any;

/** GET /api/v1/fixture — one typed answer, one untyped. */
export async function GET(req: Request) {
  if (req.headers.get('x-typed')) {
    return NextResponse.json({ typed: true });
  }
  return NextResponse.json(loose);
}
`,
  'nullable-object': `
import { NextResponse } from 'next/server';

declare const owner: { id: string } | null;

/** GET /api/v1/fixture — who owns it, if anyone. */
export async function GET() {
  return NextResponse.json({ owner });
}
`,
  'json-file': `
import { NextResponse } from 'next/server';
import document from './document.json';

/** GET /api/v1/fixture — a JSON file as it is today. */
export async function GET() {
  return NextResponse.json(document);
}
`,
  'too-big': `
import { NextResponse } from 'next/server';

declare const page: Document;

/** GET /api/v1/fixture — a type nobody meant to send. */
export async function GET() {
  return NextResponse.json({ page });
}
`,
};

let program: ts.Program;

beforeAll(() => {
  const inMemory = new Map<string, string>();
  for (const [name, source] of Object.entries(FIXTURES)) {
    inMemory.set(fixturePath(name), source);
  }
  inMemory.set(join(FIXTURE_DIRECTORY, 'json-file', 'document.json'), '{ "openapi": "3.0.3", "paths": { "/a": {} } }');
  program = createRouteProgram([...inMemory.keys()].filter(path => path.endsWith('.ts')), inMemory);
});

/**
 * Where a fixture route is served from.
 * @param name - The fixture's name.
 */
function fixturePath(name: string): string {
  return join(FIXTURE_DIRECTORY, name, 'route.ts');
}

/**
 * The published schema of a fixture route's success answer at a status.
 * @param name - The fixture's name.
 * @param status - The success status.
 */
function answerShape(name: string, status: number = 200): JsonSchema | null {
  const sourceFile = program.getSourceFile(fixturePath(name))!;
  const [operation] = parseRouteModule(sourceFile.text, '/api/v1/fixture', { checker: program.getTypeChecker(), sourceFile });
  const response = operation!.responses.find(candidate => candidate.status === status);
  return response ? response.bodySchema : null;
}

describe('the shape published for a route\'s answer', () => {
  it('describes what JSON.stringify writes: dates as strings, functions gone, missing and null fields marked', () => {
    expect(answerShape('json-semantics')).toEqual({
      type: 'object',
      properties: {
        run: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            startedAt: { type: 'string', format: 'date-time' },
            finishedAt: { type: 'string', format: 'date-time', nullable: true },
            note: { type: 'string' },
            error: { type: 'string' },
            labels: { type: 'object', additionalProperties: { type: 'number' } },
          },
          // `note` is optional and `error` can be undefined: either may be absent.
          required: ['id', 'startedAt', 'finishedAt', 'labels'],
        },
      },
      required: ['run'],
    });
  });

  it('publishes the only values a field can hold, sorted, and keeps a plain boolean a boolean', () => {
    expect(answerShape('literals')).toEqual({
      type: 'object',
      properties: {
        ok: { type: 'boolean', enum: [true] },
        decision: { type: 'string', enum: ['approve', 'reject', 'snooze'] },
        priority: { type: 'number', enum: [1, 2, 3] },
        urgent: { type: 'boolean' },
        kind: { type: 'string', enum: ['review'] },
      },
      required: ['ok', 'decision', 'priority', 'urgent', 'kind'],
    });
  });

  it('describes a value with toJSON by what toJSON returns', () => {
    expect(answerShape('to-json')).toEqual({
      type: 'object',
      properties: { price: { type: 'object', properties: { cents: { type: 'number' }, currency: { type: 'string' } }, required: ['cents', 'currency'] } },
      required: ['price'],
    });
  });

  it('stops a type that contains itself at its second appearance instead of nesting forever', () => {
    expect(answerShape('recursive')).toEqual({
      type: 'object',
      properties: {
        root: {
          type: 'object',
          properties: { name: { type: 'string' }, children: { type: 'array', items: { type: 'object' } } },
          required: ['name', 'children'],
        },
      },
      required: ['root'],
    });
  });

  it('gives each status its own shape, and offers every distinct shape a status can send, once each', () => {
    expect(answerShape('two-shapes', 202)).toEqual({ type: 'object', properties: { runId: { type: 'number' } }, required: ['runId'] });
    expect(answerShape('two-shapes', 200)).toEqual({
      oneOf: [
        { type: 'object', properties: { ok: { type: 'boolean', enum: [true] }, dryRun: { type: 'boolean', enum: [true] } }, required: ['ok', 'dryRun'] },
        { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
      ],
    });
  });

  it('marks an object that can be null as nullable rather than offering null as a second shape', () => {
    expect(answerShape('nullable-object')).toEqual({
      type: 'object',
      properties: { owner: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], nullable: true } },
      required: ['owner'],
    });
  });
});

describe('when the shape cannot honestly be published', () => {
  it('publishes no shape for a status when one of its bodies is untyped, rather than only the typed one', () => {
    expect(answerShape('unreadable')).toBeNull();
  });

  it('does not describe data read from a JSON file, whose type is just today\'s contents', () => {
    expect(answerShape('json-file')).toEqual({ type: 'object' });
  });

  it('gives up on a type far too big to be a deliberate answer', () => {
    expect(answerShape('too-big')).toBeNull();
  });

  it('publishes no shape when given the syntax alone', () => {
    const [operation] = parseRouteModule(FIXTURES.literals!, '/api/v1/fixture');

    expect(operation!.responses.find(response => response.status === 200)?.bodySchema).toBeNull();
  });
});

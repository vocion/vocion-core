/**
 * A fake Zendesk for tests: answers the token endpoint and API paths from
 * queues, and records every request, so a test can say exactly where the
 * client secret went and how many tokens were minted. Nothing reaches the
 * network.
 */
import type { ZendeskDeps } from './client';

/** `body: null` answers with no body at all, as a 204 must. */
export type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/**
 * A Zendesk that answers each path from its own queue, repeating the last
 * answer once the queue runs down, and records every request it was sent.
 */
export class FakeZendesk {
  readonly calls: Array<{ url: string; init: RequestInit }> = [];
  /** Every answer handed out, so a test can check none was left unread. */
  readonly responses: Response[] = [];
  readonly waits: number[] = [];
  now = Date.parse('2026-11-25T12:00:00Z');
  private readonly answers: Map<string, Answer[]>;

  constructor(answers: Record<string, Answer[]>) {
    this.answers = new Map(Object.entries(answers));
  }

  async send(url: string, init: RequestInit): Promise<Response> {
    this.calls.push({ url, init });
    const queue = this.answers.get(new URL(url).pathname) ?? [{ status: 404 }];
    const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (answer instanceof Error) {
      throw answer;
    }
    const response = new Response(bodyText(answer.body), { status: answer.status, headers: answer.headers });
    this.responses.push(response);
    return response;
  }

  async wait(ms: number): Promise<void> {
    this.waits.push(ms);
  }

  /**
   * Requests made to one path.
   * @param path - The URL path, like `/oauth/tokens`.
   */
  sentTo(path: string) {
    return this.calls.filter(call => new URL(call.url).pathname === path);
  }
}

/**
 * The raw body for an answer: a string as given, nothing for null, anything
 * else as JSON (an empty object when left out).
 * @param body - The answer's body.
 */
function bodyText(body: unknown): string | null {
  if (body === null) {
    return null;
  }
  return typeof body === 'string' ? body : JSON.stringify(body ?? {});
}

/**
 * The injectable network, clock and wait for this fake.
 * @param fake - The fake Zendesk.
 */
export function depsFor(fake: FakeZendesk): ZendeskDeps {
  return { fetch: (url, init) => fake.send(url, init), now: () => fake.now, sleep: ms => fake.wait(ms) };
}

/**
 * A token answer as the migration guide's client-credentials example shows it.
 * @param token - The access token.
 * @param extra - Fields to add or override.
 */
export function tokenAnswer(token: string, extra: Record<string, unknown> = {}): Answer {
  return { status: 200, body: { access_token: token, token_type: 'bearer', scope: 'users:read', expires_in: 3600, ...extra } };
}

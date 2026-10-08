/**
 * A fetch for the people providers' tests: answers from a table keyed by
 * "METHOD pathname", records each call, and never goes out.
 */

export type SeenCall = { method: string; url: string; auth: string | null; headers: Record<string, string> };

/**
 * Build the fake.
 * @param table - "METHOD /path" → JSON body, or `{ status, body }` for a failure.
 * @param seen - Where each call is recorded.
 */
export function fakeFetch(table: Record<string, unknown>, seen: SeenCall[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    seen.push({ method, url, auth: headers.authorization ?? null, headers });
    const entry = table[`${method} ${u.pathname}`];
    if (entry === undefined) {
      return new Response(JSON.stringify({ message: `No such route: ${method} ${u.pathname}` }), { status: 404 });
    }
    if (entry && typeof entry === 'object' && 'status' in entry && typeof (entry as { status: unknown }).status === 'number' && 'body' in entry) {
      const e = entry as { status: number; body: unknown };
      return new Response(JSON.stringify(e.body), { status: e.status });
    }
    return new Response(JSON.stringify(entry), { status: 200 });
  };
}

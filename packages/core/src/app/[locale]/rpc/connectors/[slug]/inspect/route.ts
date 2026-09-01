/**
 * POST /rpc/connectors/[slug]/inspect — look at a third-party instance with
 * candidate connection details, before any source row or credential exists.
 *
 * Body: `{ config: { baseUrl }, credentials: { token }, collections?: string[] }`.
 * Answers what the instance is, whether the token reads content, and which
 * collections it exposes, so the Add-source dialog can offer a pick-list
 * instead of asking an operator to type plural api ids from memory.
 *
 * Nothing is persisted — no source row, no credential, no vault write. The
 * token is used for the outbound requests and dropped. Admin-only, because it
 * takes a credential and makes the server talk to an arbitrary host.
 *
 * Only `strapi` supports inspection today; every other slug answers 501 so the
 * client can fall back to its plain form rather than guessing.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { getConnector } from '@/libs/sources/registry';
import { inspectStrapiInstance } from '@/libs/sources/strapi';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string; locale: string }> },
) {
  const { orgId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can inspect a connector instance' }, { status: 403 });
  }

  const { slug } = await ctx.params;
  if (!getConnector(slug)) {
    return Response.json({ error: `Unknown connector: ${slug}` }, { status: 404 });
  }
  if (slug !== 'strapi') {
    return Response.json({ error: `${slug} does not support inspection` }, { status: 501 });
  }

  let body: {
    config?: { baseUrl?: unknown };
    credentials?: { token?: unknown };
    collections?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const baseUrl = typeof body.config?.baseUrl === 'string' ? body.config.baseUrl.trim() : '';
  const token = typeof body.credentials?.token === 'string' ? body.credentials.token.trim() : '';
  if (baseUrl === '' || token === '') {
    return Response.json({ error: 'A base URL and an API token are both required' }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return Response.json({ error: 'The base URL must start with http:// or https://' }, { status: 400 });
  }

  const collections = Array.isArray(body.collections)
    ? body.collections.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map(entry => entry.trim())
    : [];

  try {
    const inspection = await inspectStrapiInstance({ baseUrl, token, collections });
    return Response.json({ inspection });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}

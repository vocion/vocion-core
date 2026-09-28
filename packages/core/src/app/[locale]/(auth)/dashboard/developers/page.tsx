import type { Metadata } from 'next';
import { BookOpen, Code2, ExternalLink } from 'lucide-react';
import { headers } from 'next/headers';
import { ApiTokensPanel } from '@/features/api-tokens/ApiTokensPanel';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
import { appBaseUrl } from '@/libs/links';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * Developers — everything an integrator needs to connect something to this
 * workspace, on one page under Organization (nav sweep, 2026-09-15): the MCP
 * and REST endpoints with how to authenticate, the credentials that open
 * them (admins issue and store; members see who to ask), and the docs.
 * `/dashboard/api-tokens` redirects here.
 *
 * Credentials stay admin-only for the reason the old page gave: a Vocion
 * token acts with the `owner` role and a stored platform key decides whose
 * account a model run bills. The router enforces that; this page just does
 * not offer a member a form that would 403.
 */

export const metadata: Metadata = { title: 'Developers' };

/** The externally reachable origin: the configured app URL, else the request's own host. */
async function publicOrigin(): Promise<string> {
  const configured = appBaseUrl();
  if (configured) {
    return configured;
  }
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) {
    return '';
  }
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function DevelopersPage() {
  const { has } = await requireOrganization();
  const isAdmin = has({ role: ORG_ROLE.ADMIN });
  const origin = await publicOrigin();
  const mcpUrl = `${origin}/api/mcp`;
  const restUrl = `${origin}/api/v1`;
  const mcpConfig = JSON.stringify({ mcpServers: { vocion: { url: mcpUrl, headers: { Authorization: 'Bearer vcn_live_…' } } } }, null, 2);

  return (
    <>
      <TitleBar
        title="Developers"
        description="Connect outside tools to this workspace — the MCP server, the REST API, the credentials that open them, and the docs."
      />

      <DashboardSection
        title="Connect"
        description="Point any MCP client (Claude, Cursor, Zed) at the endpoint with a Vocion token as a bearer header. The same token opens the REST API. Both are scoped to this workspace."
      >
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">MCP server</dt>
          <dd><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] break-all">{mcpUrl}</code></dd>
          <dt className="text-muted-foreground">REST API</dt>
          <dd><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] break-all">{restUrl}</code></dd>
          <dt className="text-muted-foreground">Authenticate</dt>
          <dd><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">Authorization: Bearer vcn_live_…</code></dd>
        </dl>
        <p className="mt-4 mb-2 text-[13px] text-muted-foreground">Remote-server entry for an MCP client:</p>
        <pre className="overflow-x-auto rounded-lg bg-muted/60 px-4 py-3 font-mono text-[12px] leading-relaxed">{mcpConfig}</pre>
      </DashboardSection>

      {/* CONNECT AN ASSISTANT (backlog 027): the same door, signed into from
          Claude.ai, ChatGPT or Claude Code with OAuth — no token to paste. */}
      <DashboardSection
        title="Connect an assistant"
        description="Chat to this workspace from Claude, ChatGPT or Claude Code. They add the MCP URL, send you here once to press Allow, and ask the workspace with your permissions. Decisions stay in the app."
      >
        <ol className="max-w-prose space-y-2 text-sm">
          <li className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-x-2">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">01</span>
            <span className="min-w-0 break-words">
              <strong>Claude.ai or Claude Desktop</strong>
              : Settings → Connectors → Add custom connector → paste
              {' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] break-all">{mcpUrl}</code>
              . Nothing else to fill in.
            </span>
          </li>
          <li className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-x-2">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">02</span>
            <span className="min-w-0 break-words">
              <strong>Claude Code</strong>
              :
              {' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] break-all">{`claude mcp add --transport http vocion ${mcpUrl}`}</code>
              , then
              {' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">/mcp</code>
              {' '}
              to sign in.
            </span>
          </li>
          <li className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-x-2">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">03</span>
            <span className="min-w-0 break-words">
              <strong>ChatGPT</strong>
              {' '}
              (developer mode → Connectors) takes the same URL. The token an assistant gets lasts thirty days and shows below under API credentials — revoke it there to disconnect.
            </span>
          </li>
        </ol>
      </DashboardSection>

      <DashboardSection
        // The credentials table carries seven columns plus a revoke action, which
        // does not fit the default reading-width cap.
        fullWidthContent
        title="API credentials"
        description={isAdmin
          ? 'A Vocion token lets a caller into this workspace — send it as a bearer token to /api/v1 or /api/mcp, and copy it now, because it is shown only once. A key for any other platform goes the other way: Vocion calls that platform for you, so models, embeddings, reranking and image tools bill your account. Store none and those calls stay on ours.'
          : 'Workspace admins issue Vocion tokens and store the platform keys model runs bill to. Ask an admin for a token to call the API or the MCP server.'}
      >
        {isAdmin && <ApiTokensPanel />}
      </DashboardSection>

      <DashboardSection
        title="Docs"
        description="How the workforce is authored and driven — the API is for starting work and approving it, not for defining agents (that is always files)."
      >
        <ul className="flex flex-wrap gap-2 text-[13px]">
          <li>
            <Link href="/api-docs" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 px-3 font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
              <Code2 className="size-3.5" aria-hidden />
              API reference
            </Link>
          </li>
          <li>
            <Link href="/dashboard/docs" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 px-3 font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
              <BookOpen className="size-3.5" aria-hidden />
              In-app docs
            </Link>
          </li>
          <li>
            <a href="https://www.vocion.ai/docs" target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 px-3 font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
              <ExternalLink className="size-3.5" aria-hidden />
              vocion.ai/docs
            </a>
          </li>
        </ul>
      </DashboardSection>
    </>
  );
}

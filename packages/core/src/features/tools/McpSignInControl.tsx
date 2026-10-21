'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/** The caller's own sign-in to a per-person MCP server, as the Tools page shows it. */
export type McpSignIn = { source: string; signedIn: boolean; signInHref: string };

/**
 * Signed in, with Disconnect; or Sign in. Disconnect deletes only the caller's
 * own grant, which every workspace declaring the server shares.
 * @param props
 * @param props.signIn - The caller's state for this server.
 */
export function McpSignInControl({ signIn }: { signIn: McpSignIn }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!signIn.signedIn) {
    return (
      <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[11px]">
        <a href={signIn.signInHref}>Sign in</a>
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-[11px] text-muted-foreground" data-testid={`mcp-signed-in-${signIn.source}`}>
      You are signed in
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px]"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await client.personal.mcpSignOut({ source: signIn.source });
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Disconnecting…' : 'Disconnect'}
      </Button>
    </span>
  );
}

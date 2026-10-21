'use client';

import type { PersonalMcpOffer } from '@/services/outboundMcp/personalEnable';
import { Plug } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ListRow, ListRows } from '@/components/patterns/ListRow';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';

/**
 * In a person's Personal: the per-person MCP servers their workspaces declare,
 * each one press from their own assistant. Nothing to show, nothing drawn.
 * @param props
 * @param props.offers - From `personalMcpOffers`.
 */
export function PersonalMcpOffers({ offers }: { offers: PersonalMcpOffer[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (offers.length === 0) {
    return null;
  }
  async function enable(offer: PersonalMcpOffer) {
    setBusy(offer.url);
    setError(null);
    try {
      await client.personal.enableMcp({ fromOrgId: offer.fromOrgId, slug: offer.slug });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enable it.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <section data-testid="personal-mcp-offers" className="mb-6">
      <h2 className="mb-1 text-xs font-medium text-muted-foreground">From your workspaces</h2>
      <p className="mb-2 max-w-2xl text-xs text-muted-foreground">Servers your workspaces use that answer each person as themselves. Enable one for your own assistant; your one sign-in covers it.</p>
      <ListRows>
        {offers.map(offer => (
          <ListRow
            key={offer.url}
            icon={Plug}
            title={offer.name}
            subline={`MCP server · from ${offer.fromWorkspace}`}
            actionsAlways
            actions={<Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void enable(offer)}>{busy === offer.url ? 'Enabling…' : 'Enable'}</Button>}
          />
        ))}
      </ListRows>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

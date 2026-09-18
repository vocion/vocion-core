import { Radar } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListEmpty, ListPage } from '@/components/patterns';
import { DiscoveryLedger } from '@/features/discovery/DiscoveryLedger';
import { clerkAuth as auth } from '@/libs/Auth';
import { loadDiscoveryLedger } from '@/services/discovery/ledger';

/**
 * Discovery calls (the discovery ledger) — the operational record of every call the detection agent
 * assessed: the meeting, who it was with, what Vocion decided, why, and what a
 * person did with that. The model's internals (thresholds, prompt version, run
 * id, transcript hash) sit behind a disclosure on each row.
 *
 * This file reads (`services/discovery/ledger.ts` assembles the three
 * dimensions); the ledger itself is `features/discovery/DiscoveryLedger`.
 * Spec: `docs/specs/discovery-ledger-v2.md`.
 * @param props
 * @param props.params
 */
export default async function DiscoveryLedgerPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  // The seller's own domain is an argument the RevOps Lead passes per match
  // run (`services/agents/tools/discovery.ts`), not something the workspace
  // stores, so the ledger has nothing to read it from. Without it every
  // attendee reads as external, which is the safe direction: the row says who
  // was on the call and claims nothing about which side they are on.
  const entries = await loadDiscoveryLedger(orgId);

  return (
    <ListPage
      title="Discovery calls"
      description="Every call the detection agent assessed — what it decided, why, and what you did with it."
    >
      {entries.length === 0
        ? (
            <ListEmpty
              icon={Radar}
              title="No assessed calls yet"
              description="The hourly discovery check records every matched meeting here — or ask the RevOps Lead to run a detection pass in chat."
            />
          )
        : <DiscoveryLedger entries={entries} />}
    </ListPage>
  );
}

# Client documents — a sample workspace

The client-engagement workflow as a workspace: one **data room** per
engagement (a `data_room` record — status, cast, sources with their weight,
open items as asks), and the paginated, print-ready **documents** written from
it, each render-verified before it is called done.

Metacto is the seller. Every client in this sample is fictional (Northwind
Logistics, Kestrel Capital…), per `libs/fixtures/realDataGuard.ts`.

```
workspace.yaml
agents/proposal-writer.yaml       the lead: writes and verifies documents
skills/proposal-document/          the sheet framework, components, structure + language rules
skills/data-rooms/                 filing, decision logs, status, open items
objects/data_room/type.yaml        the room's shape and how material is matched to it
brand.yaml + brand/                the seller's brand guide: palette tokens, logos, voice rules (read by get_brand)
```

`surfaces: [proposals]` in `workspace.yaml` switches on the **Proposals** app
under GTM (`/gtm/proposals`): every room at Proposal stage with its latest
document and verify state, open items, and a Draft action that hands the room
to the Proposal Writer. The app is registered in core
(`features/navigation/surfaces.ts`, read model `services/proposals/board.ts`);
the workspace only names it.

Apply it to a project:

```bash
npm run workspace:apply -- templates/workspaces/client-documents --project <id|slug>
```

The E2E project `documents` (`e2e/documents/`) applies this workspace and
replays the chat use cases against it with a scripted model.

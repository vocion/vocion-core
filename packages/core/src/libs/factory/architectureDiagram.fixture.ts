import type { ArchitectureGraph } from './architectureDiagram';

/**
 * A fictional product's architecture for tests and the sample render:
 * Northwind's "Send" (the fixture cast in `libs/fixtures/realDataGuard.ts`) —
 * a web app and a phone app on one API, a worker, a database, a queue, a
 * bucket, and the mail provider.
 */
export const SEND: ArchitectureGraph = {
  title: 'Send',
  nodes: [
    { id: 'web', label: 'Send web app', kind: 'web', repo: 'northwind/send-web', note: 'Next.js, the upload and share screens' },
    { id: 'ios', label: 'Send for iPhone', kind: 'mobile', repo: 'northwind/send-ios' },
    { id: 'api', label: 'Send API', kind: 'api', repo: 'northwind/send-api', note: 'REST; auth, uploads, links' },
    { id: 'worker', label: 'Delivery worker', kind: 'worker', repo: 'northwind/send-api', note: 'Sends the "opened" notifications' },
    { id: 'pg', label: 'Postgres', kind: 'database' },
    { id: 'redis', label: 'Redis queue', kind: 'queue' },
    { id: 's3', label: 'Object storage', kind: 'storage' },
    { id: 'mail', label: 'Mail provider', kind: 'external', note: 'Transactional email, via its REST API' },
    { id: 'shared', label: '@northwind/send-shared', kind: 'package', repo: 'northwind/send-web' },
    { id: 'infra', label: 'Terraform', kind: 'infra', repo: 'northwind/send-infra' },
  ],
  edges: [
    { from: 'web', to: 'api', label: 'REST' },
    { from: 'ios', to: 'api', label: 'REST' },
    { from: 'api', to: 'pg', kind: 'reads', label: 'SQL' },
    { from: 'api', to: 'pg', kind: 'writes' },
    { from: 'api', to: 's3', kind: 'writes', label: 'uploads' },
    { from: 'api', to: 'redis', kind: 'publishes', label: 'opened events' },
    { from: 'redis', to: 'worker', kind: 'calls', label: 'consumes' },
    { from: 'worker', to: 'mail', kind: 'calls', label: 'send' },
    { from: 'worker', to: 'pg', kind: 'writes' },
    { from: 'web', to: 'shared', kind: 'depends' },
    { from: 'api', to: 'shared', kind: 'depends' },
    { from: 'infra', to: 'api', kind: 'deploys' },
    { from: 'infra', to: 'worker', kind: 'deploys' },
  ],
  groups: [
    { id: 'clients', label: 'Clients', nodes: ['web', 'ios'] },
    { id: 'backend', label: 'send-api', nodes: ['api', 'worker'] },
  ],
};

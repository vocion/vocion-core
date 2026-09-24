/**
 * The software factory's hand-offs — every write the factory needs a person
 * or an outside system to perform, registered so `propose_action` accepts
 * them and their trust rules bind to something.
 *
 * The plugin (`templates/plugins/software-factory/trust.yaml`) has carried
 * rules for these ids since 1.1.0; a plugin cannot register an action
 * (`docs/plugins.md`), so they live here under one `factory` group until the
 * registry takes plugin-owned actions. That is the follow-up, and the shape
 * is ready for it: each entry is a descriptor, nothing here is code.
 *
 * Ordered by what is on the other side of a mistake, like the trust file.
 * Only the push is reversible — a branch is deleted with one command and
 * nothing downstream runs because of it. Everything else reaches people who
 * did not ask for the change and cannot undo it from where they stand.
 */

import type { Action } from './types';
import { z } from 'zod';
import { manualAction } from './manual';

/**
 * A merge is not one decision. The class names what the diff touches, and
 * the trust rule, the risk tier and the ledger live under
 * `git.merge.<riskClass>` (`policyKeyFor`), so docs can earn its way to
 * running within bounds while schema never does.
 */
export const MERGE_RISK_CLASSES = ['docs', 'deps', 'marketing', 'ui', 'logic', 'auth', 'billing', 'schema', 'infra', 'promise'] as const;
export type MergeRiskClass = typeof MERGE_RISK_CLASSES[number];

export const gitPushBranchAction = manualAction({
  id: 'git.push_branch',
  name: 'Push a branch',
  description: 'Push a worker\'s branch to the shared remote so a person can read the diff. Creates nothing anyone has to live with; the branch is deleted with one command. Hand-off: performed by the worker after approval, marked done when pushed.',
  system: 'Git',
  grant: 'factory_write',
  reversible: true,
});

export const gitMergeAction = manualAction({
  id: 'git.merge',
  name: 'Merge a branch',
  description: 'Merge a reviewed branch into the mainline. Carries a riskClass (docs, deps, marketing, ui, logic, auth, billing, schema, infra, promise) — the trust rule and the ledger key on git.merge.<riskClass>, so each class earns on its own. Cannot be put back. Hand-off: a person merges, then marks it done.',
  system: 'Git',
  grant: 'factory_write',
  extend: {
    /** What the diff touches — picks the trust rule and the ledger. */
    riskClass: z.enum(MERGE_RISK_CLASSES),
  },
  extraFields: input => [{ label: 'Risk class', value: input.riskClass }],
  policyKeyFor: input => `git.merge.${input.riskClass}`,
  // One rule for git.merge governs every class until a class earns its own.
  parentRuleGoverns: true,
});

export const deployReleaseAction = manualAction({
  id: 'deploy.release',
  name: 'Release a deploy',
  description: 'Ship a built release to an environment people use. Reaches people who did not ask for the change and cannot undo it from where they stand. Hand-off: run by the deploy pipeline or a person after approval, marked done with the deployment URL.',
  system: 'Deploy',
  grant: 'factory_write',
});

export const deployProvisionAction = manualAction({
  id: 'deploy.provision',
  name: 'Provision infrastructure',
  description: 'Create or change the ground a product runs on — a database, a queue, a runtime, a role. Cannot be put back by clicking. Hand-off: a person or the provisioning pipeline applies the recipe, then marks it done.',
  system: 'Deploy',
  grant: 'factory_write',
});

export const awsMutateAction = manualAction({
  id: 'aws.mutate',
  name: 'Change an AWS resource',
  description: 'Any write to an AWS account — an IAM change, a parameter, a bucket policy, a service update. The recipe is the exact CLI or console steps. Cannot be put back. Hand-off: performed by a person holding the account, marked done with the change reference.',
  system: 'AWS',
  grant: 'factory_write',
});

export const credentialsWriteAction = manualAction({
  id: 'credentials.write',
  name: 'Write a credential',
  description: 'Create, rotate or place a secret where a worker can read it. The worker runs on a machine we do not host, so a credential it can read has left the building; the agent says what it needs and why, a person does it. Never auto-approved. Hand-off: a person writes it and marks it done — the value itself never travels through this card.',
  system: 'Credentials',
  grant: 'factory_write',
});

export const releaseAnnounceAction = manualAction({
  id: 'release.announce',
  name: 'Announce a release',
  description: 'Publish release notes or a changelog entry under the company\'s name — a blog post, a changelog page, a customer email. A wrong one cannot be unsent. Hand-off: a person publishes and marks it done with the URL.',
  system: 'Release',
  grant: 'factory_write',
});

export const notifyRequesterAction = manualAction({
  id: 'notify.requester',
  name: 'Answer the person who asked',
  description: 'The honest answer back to whoever filed the request — what shipped, what did not, and why — in the store, inbox or chat it came from, under the company\'s name. Cannot be unsent. Hand-off: a person sends it and marks it done.',
  system: 'Requests',
  grant: 'factory_write',
});

/** Every factory hand-off, in trust-file order. */
export const factoryActions: readonly Action[] = [
  gitPushBranchAction,
  gitMergeAction,
  deployReleaseAction,
  deployProvisionAction,
  awsMutateAction,
  credentialsWriteAction,
  releaseAnnounceAction,
  notifyRequesterAction,
];

# Deploying Vocion for a client: the parent-project pattern

How a client deployment repository ("parent project") relates to this one, and
which half owns what. Written after standing up the second such deployment by
hand; the first was `Meta-CTO/metacto-vocion-agents`, the second
`Veerio-Life/veerio-vocion`.

Read this before starting a third.

## The shape

A parent project is a repository that pins `vocion-core` as a git submodule and
holds everything specific to one client:

```
<client>-vocion/
  vocion-core/            ← this repo, pinned submodule. Never edited in place.
  infra/terraform/        ← the AWS stack for this client's account
  infra/aws/              ← what runs on the box: Caddyfile, compose overlay, bootstrap
  workspace/<slug>/       ← agents, sources, automations as reviewable YAML
  scripts/deploy.sh       ← the single entrypoint
  .github/workflows/      ← push to main redeploys
```

**The submodule pin is the version boundary.** The client runs exactly the core
commit their repository points at. Upgrading is a deliberate commit that moves
the pin, not a deploy-time surprise.

## Two phases, one entrypoint

A client deployment has two halves that live in different repositories, and the
parent project's `deploy.sh` drives both:

| Phase | Lives in | What it does |
|---|---|---|
| 1. The box | parent project | OpenTofu: VPC, EC2, EBS, Elastic IP, Route 53, IAM, snapshots. Then Caddy, Postgres, Langfuse, Temporal and the app via `bootstrap.sh`. |
| 2. The agent runtime | **this repo** | `infra/agentcore/`: ECR repository, execution role, Memory store, the arm64 container build, `create`/`update-agent-runtime`, smoke invoke. |

Phase 2 is the part people miss. An agent with `harness.provider: agentcore`
has no runtime to execute in until `infra/agentcore/deploy-runtime.sh` has run
against the client's account. The infrastructure comes up, the site serves, and
chat fails.

### Call these scripts, do not copy them

`infra/agentcore/*.sh` take their configuration from the environment and are
individually idempotent:

```bash
ENV=<env> AWS_PROFILE=<profile> REGION=<region> bash vocion-core/infra/agentcore/provision.sh
ENV=<env> AWS_PROFILE=<profile> REGION=<region> bash vocion-core/infra/agentcore/deploy-runtime.sh
ENV=<env> AWS_PROFILE=<profile> REGION=<region> bash vocion-core/infra/agentcore/smoke-invoke.sh
```

A parent project should invoke them from its own `deploy.sh` rather than copy
them, so they cannot drift from the pinned core version. `Veerio-Life/veerio-vocion`
does this in `scripts/deploy.sh` under the `agentcore` action, kept separate
from `apply` because the runtime build needs Docker and produces a linux/arm64
image — a plain infrastructure change should not require either.

## Sharp edges found while doing this twice

**`provision-ci-role.sh` is hardcoded to this repository.** Line 18 reads
`REPO_FILTER="repo:vocion/vocion-core:ref:refs/heads/main"`, so the OIDC trust
policy it writes only ever admits core's own CI. A parent project that wants
its pipeline to deploy the runtime needs that filter parameterised. Until it
is, run the runtime deploy from an operator machine or give the parent its own
role.

**`agentcore-harness-role.sh` defaults to `us-east-1`.** It takes the region as
a positional argument. A parent deploying elsewhere must pass it, or the
harness role is created in the wrong region and nothing says so.

**`VOCION_AGENTCORE_REGION` also defaults to `us-east-1`**
(`services/agents/providers/agentcore.ts`). Set it explicitly in the parent's
compose overlay for both the app and the worker, or agents run their model loop
in a region nobody chose.

**An agent with no `model` silently becomes `gpt-4o`.** The workspace applier
resolves `agent.model ?? defaults.model ?? 'gpt-4o'`. Agents on the `agentcore`
provider use `harness.model` instead, so this only bites the `local` provider
path — but it bites quietly.

**Secrets: reference, never manage.** Both parent projects create the Secrets
Manager entry out-of-band and reference it from Terraform as a data source, so
API keys never enter state or `tfvars`. This repo's own `infra/terraform`
creates the secret instead. The parent form is the one to copy.

## Known duplication, and where it should go

`infra/terraform` in this repository is not a library — it is a fourth
deployment that happens to live here, which is why every parent project copies
it. Measured at `v2.21.0` against `Veerio-Life/veerio-vocion`: `main.tf` is 295
lines, 92 differ, and 29 of those differences are resource-name prefixes and
tags.

The three real differences are the secret (managed here, referenced there), the
AgentCore IAM policy (present there, absent here), and naming.

**The fix, when someone has room for it:**

```
infra/terraform/
  modules/vocion-stack/       VPC, subnet, IGW, SG, IAM, EC2, EBS, EIP, snapshots
  environments/vocion-ai/     this repo's own deployment, reduced to a module call
```

Parent projects then hold an overlay:

```hcl
module "vocion" {
  source = "../../vocion-core/infra/terraform/modules/vocion-stack"

  project_name   = "<client>-vocion"
  apex_domain    = var.apex_domain
  instance_type  = var.instance_type
  data_volume_gb = var.data_volume_gb
  secret_name    = "<client>-vocion/production"
}
```

No Terraform registry is needed: the submodule pin already versions the module,
so a parent project's infrastructure and application move together on one SHA.

Sequence it as — extract the module here with `environments/vocion-ai` proving
it against a real deployment, cut a core release, then have parent projects bump
their pin and swap their `.tf` files for a module call. Extracting the module
means `terraform state mv` against a live box, so it wants its own change and
its own rollback plan.

## Pinning `vocion-core` safely

Three rules, each earned:

- **Take the SHA from `git ls-remote`, never from a local checkout.** This
  repository's history was rewritten on 2026-08-31 after the PolinRider
  supply-chain compromise, and a plain `git fetch` does not clobber stale local
  tags — a local clone will happily hand you a tag resolving to a different
  object.
- **Use the `v2.x` tags.** An orphan `vocion-v0.5.x` series exists with no
  common ancestor with `main`.
- **Run `node scripts/check-config-integrity.mjs` at the new pin before
  committing it**, and re-verify the pin after every merge — a GitHub merge can
  move a submodule pin backwards.

# Deploying Vocion for a client

How to stand up Vocion for one client, and which repo owns what.

Two deployments exist already: `Meta-CTO/metacto-vocion-agents` and a client
parent project. Read this before building a third.

> The client parent project is **anonymised throughout this page** as
> `Larkfield-Systems/larkfield-vocion`, on the fictional
> `larkfield.example` domain. Everything described about it is real and was
> measured against the live repo; only the name is a fixture. See
> `packages/core/src/libs/fixtures/realDataGuard.ts` for why this repo does not
> name clients.

---

## What you build

A **parent project** — one repo per client, holding everything client-specific,
with `vocion-core` pinned inside it as a submodule.

```
<client>-vocion/
├── vocion-core/          the framework, pinned. Never edited here.
├── infra/terraform/      the client's AWS stack: a call to core's modules/vocion-stack
├── infra/aws/            what runs on the box: Caddyfile, compose, bootstrap
├── workspace/<slug>/     agents and sources, as reviewable YAML
├── scripts/deploy.sh     one entrypoint
└── .github/workflows/    push to main redeploys
```

The client runs exactly the core commit their repo pins. Upgrading is a
deliberate commit, never a deploy-time surprise.

---

## Why `infra/terraform` and `infra/aws` are separate

This trips everyone up, because both folders say "infrastructure" and both
concern AWS. They are not two homes for the same thing. **They run in different
places, at different times, with different credentials.**

|  | `infra/terraform/` | `infra/aws/` |
|---|---|---|
| **Runs where** | your laptop, or CI | on the EC2 box, as root |
| **Talks to** | the AWS API | Docker, on that one machine |
| **Written in** | declarative HCL | bash, compose, Caddyfile |
| **Needs** | AWS credentials + the state file | no AWS credentials at all |
| **Runs how often** | rarely — resize, DNS, IAM | every single deploy |
| **When it fails** | apply errors out, nothing changed | box is up but serving badly |

Read it as a handoff:

```
tofu apply                          → creates the machine
  └─ user-data.sh (first boot only) → fetches the secret, clones the repo
       └─ infra/aws/bootstrap.sh    → builds the image, starts the stack
            └─ apply-workspace.sh   → migrations, workspace YAML into the DB

git push origin main                → re-runs bootstrap.sh only
```

`infra/terraform` creates the machine. `infra/aws` is what the machine *does*
once it exists. The first is cattle-shaped and runs from outside; the second
is the box's own runbook and runs from inside.

Merging them would put "needs AWS credentials and a state file" in the same
directory as "runs as root on a box that deliberately has neither", and would
mean editing a Caddy config triggered a Terraform plan.

**The name `infra/aws` is admittedly poor** — `infra/terraform` is also AWS.
`infra/box`, `infra/host` or `runtime/` would all be clearer. The name is kept
because this repo uses it too (`vocion-core/infra/aws/`), several absolute
paths depend on it (`/opt/vocion/infra/aws/Caddyfile` in the compose overlay,
`${CORE}/infra/aws/.env.production` in `bootstrap.sh`), and having the
framework and its parent projects disagree about the layout costs more than the
better name is worth. Rename it in both, or in neither.

---

## The part people miss

**A deployment has two phases, and the second one lives in this repo.**

| | Phase 1 — the box | Phase 2 — the agent runtime |
|---|---|---|
| Lives in | parent project | **here**, `infra/agentcore/` |
| Builds | VPC, EC2, EBS, Elastic IP, Route 53, IAM, snapshots. Then Caddy, Postgres, Langfuse, the app. | ECR repo, execution role, Memory store, arm64 image, the runtime itself |
| Tool | OpenTofu + `bootstrap.sh` | `provision.sh`, `deploy-runtime.sh`, `smoke-invoke.sh` |

Skip phase 2 and **the site comes up healthy while chat fails**. Any agent with
`harness.provider: agentcore` has nowhere to execute until the runtime exists.

Langfuse is the one part of phase 1 that needs a decision rather than a
script: managed Cloud, self-hosted on the box, or off. Make it before
the first deploy, since the self-hosted path sets the admin password and
the project API keys on first boot.
[`observability.md`](./observability.md) covers all three.

### Call these scripts. Don't copy them.

They read `ENV`, `AWS_PROFILE` and `REGION` from the environment, and each one
is idempotent:

```bash
ENV=production AWS_PROFILE=<profile> REGION=<region> \
  bash vocion-core/infra/agentcore/provision.sh

ENV=production AWS_PROFILE=<profile> REGION=<region> \
  bash vocion-core/infra/agentcore/deploy-runtime.sh

ENV=production AWS_PROFILE=<profile> REGION=<region> \
  bash vocion-core/infra/agentcore/smoke-invoke.sh
```

Copying them lets a parent project drift from the version it pins. Calling them
makes that impossible.

`Larkfield-Systems/larkfield-vocion` wires this into `scripts/deploy.sh`:

```bash
./scripts/deploy.sh apply       # phase 1
./scripts/deploy.sh agentcore   # phase 2
./scripts/deploy.sh all         # both
```

Phase 2 is a separate action because it needs Docker and builds a linux/arm64
image. A plain infrastructure change shouldn't require either.

### Migrations are the same rule, and this is where it has already bitten

Call `vocion-core/infra/aws/apply-migrations.sh`. Do not write your own loop
over `packages/core/migrations/*.sql`.

```bash
sudo MIGRATIONS_DIR=<checkout>/vocion-core/packages/core/migrations \
  POSTGRES_CONTAINER=<your-pg-container> POSTGRES_DB=<your-db> \
  bash <checkout>/vocion-core/infra/aws/apply-migrations.sh
```

A hand-rolled loop looks like four lines and works, right up until core adds
something the loop does not know about. Core keeps a second class of migration
in `packages/core/migrations/concurrent/` — index builds written as
`CREATE INDEX CONCURRENTLY`, because a plain `CREATE INDEX` on a populated
table blocks every write to it until the build finishes. A non-recursive glob
skips that directory in silence: the numbered migration lands, the index build
does not, and the deploy reports success.

That is not hypothetical. `Larkfield-Systems/larkfield-vocion` applies migrations from
its own `apply-workspace.sh` with exactly such a glob, so core's applier has
never run there — confirmed against both of its environments, whose migration
history lives in a `schema_migration` table core knows nothing about.

Calling core's script also gets you the parts nobody thinks to write twice: the
baselining path for a database whose schema predates the tracking table,
dropping `--single-transaction` only for the statements Postgres actually
refuses inside one, and stopping rather than skipping ahead when a migration
fails.

**If a parent project must keep its own applier**, end its deploy with:

```bash
sudo MIGRATIONS_DIR=... POSTGRES_CONTAINER=... POSTGRES_DB=... \
  bash <checkout>/vocion-core/infra/aws/apply-migrations.sh --verify-indexes
```

That reads the database and nothing else — no tracking table, no baselining, no
migrations — and exits non-zero naming any index declared in `concurrent/` that
is missing, or that a failed build left `INVALID` (present, never used, and
skipped forever by `IF NOT EXISTS`). It turns the silent case into a failed
deploy.

**Moving an existing project onto core's applier** needs one baseline, because
its history is in its own table and core's applier reads `__pgsql_migrations`:

```bash
# once, on the box, after confirming the schema is current
sudo ... bash .../apply-migrations.sh --baseline all
```

Then every later deploy is a normal run. Run `--check` first to see what it
would do.

### Build the app image in CI. The box only pulls it.

**TL;DR:** your CI builds one image per environment with core's
`push-app-image.sh` and pushes it to ECR, tagged with the commit. The deploy
hands that image name to the box, which pulls it and restarts. The box never
compiles anything.

**Why.** A first build of `packages/core/Dockerfile` peaks at about 7.9 GB of
memory (#670). The box that serves the app is also running Postgres, Langfuse
and the app itself. On a 16 GB box that leaves under 1 GB spare, and when
memory runs out Linux kills whichever process it picks, which can be Postgres
rather than the build. A CI runner has its own memory, so a build that fails
there never touches the running site.

**How a deploy goes:**

1. CI runs `push-app-image.sh`. It builds the image, tags it with the commit,
   stamps it with the app URL it was built for, and pushes it along with a
   build cache.
2. The deploy checks out that same commit on the box and hands it the image
   name. Your project's deploy script runs
   `bash vocion-core/infra/aws/pull-app-image.sh <image>` where it used to run
   `docker build`, with `EXPECTED_APP_URL` set to the box's
   `NEXT_PUBLIC_APP_URL`. A box on core's own `infra/aws` layout runs
   `sudo VOCION_APP_IMAGE=<image> bash /opt/vocion/infra/aws/update.sh <ref>`,
   which does all of this.
3. The box logs in to ECR with its own IAM role, pulls the image, checks the
   app URL, tags it `vocion-app:latest`, applies migrations and restarts
   `app` and `worker`. If the pull fails, nothing is restarted and the old
   containers keep serving.

**One image per environment.** Next bakes every `NEXT_PUBLIC_*` value into
the client bundle when it builds, so dev's image on the production box would
send every sign-in to dev. `pull-app-image.sh` refuses an image whose
`org.vocion.app-url` label doesn't match the box's `NEXT_PUBLIC_APP_URL`.
Build once for each environment, each with its own `--build-arg` values.
Build for the box's CPU too: `IMAGE_PLATFORM=linux/arm64` for a Graviton box.

**Build what the box used to build.** Pass every `--build-arg` your old
`docker build` passed (brand name, Clerk key, Langfuse URL and so on). If your
deploy copied files into core before building (brand assets, say), do that in
CI before `push-app-image.sh` too. The script prints a `note:` line for each
`NEXT_PUBLIC_*` value it leaves at the Dockerfile's placeholder, so check the
first run's log for any you meant to set.

#### One-time AWS setup, in your IaC

- **An ECR repository per environment.** Keep tags mutable: the `buildcache`
  tag is rewritten on every build. Add a lifecycle policy so old images don't
  pile up. Because `buildcache` is always among the newest, the count rule
  never drops it:

  ```json
  {
    "rules": [
      {
        "rulePriority": 1,
        "description": "Drop untagged images after a day",
        "selection": { "tagStatus": "untagged", "countType": "sinceImagePushed", "countUnit": "days", "countNumber": 1 },
        "action": { "type": "expire" }
      },
      {
        "rulePriority": 2,
        "description": "Keep the newest 30 images",
        "selection": { "tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 30 },
        "action": { "type": "expire" }
      }
    ]
  }
  ```

- **Pull rights for the box's instance role:** `ecr:GetAuthorizationToken` on
  `*`, plus `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` and
  `ecr:BatchCheckLayerAvailability` on the repository. The box then needs no
  stored registry password.
- **A push role for CI, assumed through GitHub OIDC**, so no AWS keys sit in
  GitHub secrets. Trust `token.actions.githubusercontent.com` with audience
  `sts.amazonaws.com` and a `sub` of
  `repo:<org>/<repo>:ref:refs/heads/<branch>`, one branch per environment.
  Grant `ecr:GetAuthorizationToken` on `*`, and on the repository
  `ecr:BatchCheckLayerAvailability`, `ecr:BatchGetImage`,
  `ecr:GetDownloadUrlForLayer`, `ecr:InitiateLayerUpload`,
  `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload` and `ecr:PutImage`. An
  account has only one GitHub OIDC provider, and it may exist already (the
  AgentCore setup below creates one), so look it up with a data source rather
  than creating a second. `infra/agentcore/provision-ci-role.sh` is the same
  trust shape for the runtime deploy.

#### The CI job

```yaml
jobs:
  app-image:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: read
      id-token: write # lets the job assume the push role
    outputs:
      image: ${{ steps.push.outputs.image }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.APP_IMAGE_PUSH_ROLE_ARN }}
          aws-region: us-west-2
          # A masked account ID would blank the image output below.
          mask-aws-account-id: false
      - id: push
        env:
          APP_IMAGE_REPOSITORY: ${{ vars.APP_IMAGE_REPOSITORY }}
        run: |
          bash vocion-core/infra/aws/push-app-image.sh \
            --build-arg NEXT_PUBLIC_APP_URL=https://${{ vars.APP_HOST }} \
            --build-arg NEXT_PUBLIC_BRAND_NAME="Client Name"

  deploy:
    needs: app-image
    runs-on: ubuntu-latest
    # The sign-off: give this GitHub environment required reviewers, and the
    # job waits for one of them to approve. One environment per box.
    environment: production
    steps:
      # However you reach the box today (SSH, SSM). Pass the commit the
      # image was built from, so the migrations and compose files the box
      # checks out match the image it pulls.
      - run: |
          ssh deploy@${{ vars.APP_HOST }} \
            "sudo VOCION_APP_IMAGE='${{ needs.app-image.outputs.image }}' bash /opt/<project>/scripts/deploy.sh '${{ github.sha }}'"
```

`scripts/deploy.sh` stands for your project's own deploy script. It checks
out the commit it's given, runs `pull-app-image.sh` in place of its
`docker build`, then migrates and restarts as it already does.

The image is tagged with `GITHUB_SHA`, your project's commit, which pins the
core commit through the submodule. So the tag names exactly what runs.

**Timing.** The build cache lives in the same repository under the
`buildcache` tag. When `package-lock.json` hasn't changed, the dependency
install comes from the cache. Turbopack's own compile cache doesn't travel
through a registry, so the compile runs from scratch on every CI run. See
[Measured on a GitHub runner](#measured-on-a-github-runner) for the numbers.

**Rolling back** is a deploy of an older commit: pass
`VOCION_APP_IMAGE=<repository>:<older commit>` and that same commit as the
ref. The tag and the checkout are one commit of your project, which pins core
through the submodule, so there's no separate core ref to look up. Images
older than the lifecycle policy keeps are gone; rebuild those in CI.
Migrations don't roll back, which is why they must stay backward-compatible
(see the migrations section below).

**Break glass.** Leave `VOCION_APP_IMAGE` unset and `update.sh` and
`bootstrap.sh` build on the box as before. That needs buildx (next section)
and brings back the memory risk, so keep it for when CI is down.

**sudo and the variable.** `sudo VOCION_APP_IMAGE=... bash` works with the
`ec2-user ALL=(ALL) NOPASSWD: ALL` rule Amazon Linux 2023 ships (checked
2026-09-28). A user with narrower sudo rights may have the variable stripped,
and then the script builds on the box and says so: `no VOCION_APP_IMAGE
given`. Use `sudo env VOCION_APP_IMAGE=... bash ...` there. The ECR login
belongs to root, so check a pull by hand with `sudo docker pull`.

#### Measured on a GitHub runner

One run of `.github/workflows/app-image.yml` on `ubuntu-latest` (4 CPUs,
16 GB), pushing to a registry on the runner, 2026-09-28. ECR adds network
time on top.

| | First push, empty cache | Next push, source changed |
|---|---|---|
| Whole script | 539 s | 261 s |
| Dependency install | 63 s | from cache |
| Compile | 170 s | 172 s |
| Writing the build cache | 210 s | 33 s |
| Pushing the image | 54 s | 9 s |

The image is about 1.26 GB. The same run pulled it the way a box does,
refused it for another environment's URL, applied all 158 migrations,
and booted it: `/api/demo-health` answered 200 and a signed-out visit
landed on sign-in.

### If you still build on the box: it needs buildx. Call core's installer.

Since #670, `packages/core/Dockerfile` keeps Turbopack's build cache between
image builds with a BuildKit cache mount, so a repeat deploy's compile needs
about half the memory. `docker build` runs BuildKit only when Docker's buildx
plugin is installed. Without it, Docker falls back to its legacy builder and
the build stops:

```
the --mount option requires BuildKit.
```

Amazon Linux 2023's own `docker` package ships the plugin (Docker 25.0.14
with buildx 0.12.1, checked 2026-09-28), so a box set up with `dnf install
docker` already has it. Other images and older boxes may not. Run core's
installer right before your own `docker build` either way:

```bash
sudo bash <checkout>/vocion-core/infra/aws/install-buildx.sh
```

It does nothing when `docker buildx version` already works. Otherwise it
downloads a pinned release for the box's architecture, checks its SHA-256,
installs it, and exits non-zero if any of that fails, so the deploy stops
before it builds. Core's own `bootstrap.sh` and `update.sh` call it the same
way.

### Wire the app to the runtime

Provisioning creates the runtime. It does not tell the app to use it — that is
five environment variables, and getting one wrong fails in a way that looks
like a model problem rather than a config problem.

`provision.sh` and `deploy-runtime.sh` write what they created to SSM under
`/vocion/agentcore/<env>/`: `runtime-arn`, `memory-id`, `runtime-image`,
`runtime-role-arn`, `ecr-repo-uri`. **Read those at deploy time. Do not paste
an ARN into a compose file or a tfvars** — the runtime is redeployed far more
often than the parent project's infrastructure, and a pasted ARN is how an
environment ends up invoking last month's image.

| Var | Value | What breaks without it |
|---|---|---|
| `VOCION_AGENT_RUNTIME_ARN` | SSM `runtime-arn` | Core falls back to `VOCION_AGENT_RUNTIME_URL` (default `http://localhost:8080`) and every agent turn fails to connect. Chat is broken, the site is fine. |
| `VOCION_TOOL_ENDPOINT_URL` | `https://<the client's core>/api/internal/agent-tools` | The runtime executes the loop but **every tool call fails**, because the default is localhost and AWS cannot reach it. The agent answers, badly, from the model alone. |
| `VOCION_AGENTCORE_REGION` | the region the runtime was provisioned in | Core signs `InvokeAgentRuntime` against `us-west-2` and cannot find a runtime provisioned elsewhere. |
| `VOCION_AGENTCORE_MEMORY_ID` | SSM `memory-id` | Conversations still work — history rides the payload — but nothing is remembered across conversations. |
| `VOCION_BEDROCK_SESSION_SECONDS` | optional, default 3600 | Nothing. Only shorten or lengthen the STS session if you have a reason. |

The identity core signs with (a box's instance role, a task role) needs **both**
`bedrock-agentcore:InvokeAgentRuntime` **and**
`bedrock-agentcore:InvokeAgentRuntimeForUser` on the runtime. Core sends the
person as `runtimeUserId`, which AWS turns into the
`X-Amzn-Bedrock-AgentCore-Runtime-User-Id` header, and with that header present
AWS refuses a caller that holds only the first action. It fails at the first
turn, not at deploy: Metacto's instance role had held `InvokeAgentRuntime` since
July, and the first real turn on 2026-09-28 came back AccessDenied.

`VOCION_TOOL_ENDPOINT_URL` is the one that surprises people. Every domain tool
an agent has — knowledge search, CRM lookups, learnings, briefings, all of them
— is executed by core, not by the runtime; the runtime calls back over HTTP
with a signed tenant claim. So the client's core has to be reachable from AWS,
over TLS, before a deployed agent can do anything but talk. The endpoint
verifies the claim on every request and is safe to expose, but it is a tenant
boundary: terminate TLS properly and don't put it behind a wildcard that also
serves something else.

Model spend follows the org's stored AWS key. Core mints a short-lived STS
session from the key the client saved at `/dashboard/developers` and sends it
in the invocation, so Bedrock is billed to their account. If they have stored
no key, the runtime signs with its own execution role and the bill is ours —
which is the right fallback for a trial and the wrong one for a paying client,
so check it during handover rather than assuming.

### Who runs the deploy

The parent project, never core. Core holds no AWS account and no credentials,
so it cannot deploy a runtime anywhere. The scripts under `infra/agentcore/`
are the shared implementation; the parent project calls them with its own
profile and environment. Larkfield's wrapper is
`./scripts/deploy.sh agentcore <env>`.

Core used to carry a workflow that deployed a runtime into MetaCTO's own
account. It was never activated, and it was the wrong shape — it made core
look like the thing that owns a deployment. Removed. What every client project
does need is its own path to the same deploy, which is the next section.

### One-time: let the client project's CI deploy the runtime

Two steps per client account, then that project's pipeline can deploy
unattended.

**1. Create the deploy role in the client's account.** This is deliberately
manual and deliberately human: it creates federated trust between GitHub and
an AWS account.

```bash
TRUSTED_REPO=Larkfield-Systems/larkfield-vocion \
AWS_PROFILE=larkfield REGION=us-west-2 \
  bash vocion-core/infra/agentcore/provision-ci-role.sh
```

The role it creates admits exactly one repo at one ref (`refs/heads/main` by
default, `TRUSTED_REF` to change it) and carries only what `deploy-runtime.sh`
and `smoke-invoke.sh` need: ECR push, AgentCore create/update/get/invoke,
`iam:PassRole` for the runtime role, and read/write on
`/vocion/agentcore/*` parameters. Pass `ROLE_NAME` when one account serves
more than one project.

The script prints the `gh secret set` line to run next.

**2. Call the scripts from the client project's workflow.** They need the
submodule checked out, QEMU for the arm64 build, and the role above:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: actions/checkout@v4
    with:
      submodules: recursive

  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
      aws-region: us-west-2

  - uses: docker/setup-qemu-action@v3
    with:
      platforms: arm64

  - run: ENV=production bash vocion-core/infra/agentcore/deploy-runtime.sh
  - run: ENV=production bash vocion-core/infra/agentcore/smoke-invoke.sh
```

Do this once per environment. SSM is namespaced per environment
(`/vocion/agentcore/<env>/`, see
[`multiple-environments.md`](./multiple-environments.md)), so two environments
never share a runtime by accident.

The runtime artifact is generic — agent definitions travel in the invocation
payload — so this pipeline only needs to run when `packages/agent-runtime`
changes, not when an agent is edited.

---

## If you run evals: the workspace's AWS key needs its own policy

AgentCore Evaluations calls are signed with the AWS key a workspace stores
under Dashboard > API credentials, never with the box's instance role. So
granting the instance role more does nothing for evals: the key's own IAM user
or role needs the permissions.

A key missing some of them does not fail the run. It degrades it quietly, and
each gap shows up as a warning on a later run: "Could not copy these cases to
AgentCore" (no `CreateDataset`), then "Some evaluators this dataset declares
could not be set up" (no `CreateEvaluator`), with scores missing those checks.
A key made only for model calls will hit these one at a time.

Find them all at once instead, before the first eval run and after every core
pin bump. It asks IAM's policy simulator, so it is free:

```bash
# From the vocion-core submodule, with an operator profile — not the eval key.
PRINCIPAL_ARN=arn:aws:iam::<account>:user/<key-user> \
ENV=<env> AWS_PROFILE=<operator-profile> REGION=<region> \
  bash infra/agentcore/check-evals-key.sh

# The policy that makes it pass, ready to put in your IaC.
ENV=<env> AWS_PROFILE=<operator-profile> REGION=<region> \
  bash infra/agentcore/check-evals-key.sh --print-policy
```

Manage that policy in the parent project's OpenTofu, as an inline policy on
the key's user, even if the user itself was made by hand. If two OpenTofu
workspaces share one AWS account and one key, only one of them may manage the
policy: two state files owning the same inline policy overwrite each other.
Gate it on a variable set in exactly one workspace's tfvars.

The action list lives in the script, and a unit test fails when the eval code
starts sending an AgentCore command the list does not name, so a pin bump that
adds an eval call also shows up in the script's diff.

---

## Only if you use the AWS-managed harness: its execution role

Most deployments run agents in **our own container** (`harness.runsOn:
agentcore-container`), and need none of this. Nothing in that path touches a
harness, an execution role, or IAM.

An agent set to `aws-managed-harness` is different: AWS runs the agent loop,
and the harness needs an IAM role to assume. `syncAgentCoreHarness` derives it
as `arn:aws:iam::<account>:role/VocionAgentCoreHarnessRole` from whatever
account the app is running in — and **nothing creates that role**. The parent
project used to make it on every `deploy.sh agentcore` run, which was removed
on purpose: choosing our own container should not provision harness
scaffolding as a side effect.

So one of these, before the first `workspace:apply` that has such an agent:

- Create `VocionAgentCoreHarnessRole` in the client's account, trusting
  `bedrock-agentcore.amazonaws.com`, with whatever Bedrock model access that
  agent needs. Make it Terraform, not a console click — see the box role in
  `infra/terraform/main.tf` for the shape.
- Or set `VOCION_AGENTCORE_ROLE_ARN` in the app's environment to a role that
  already exists. It skips the derivation entirely, name and all.

The box role also needs `bedrock-agentcore:DeleteHarness` **and**
`bedrock-agentcore:DeleteAgentRuntime`. AWS authorizes `DeleteHarness` as both,
because the harness owns a runtime underneath it and deleting the harness
deletes that runtime too. Without the second, an agent moving off
`aws-managed-harness` fails to tear its harness down and the whole
`workspace:apply` exits non-zero.

---

## Branding the deployment

Out of the box the app wears the Vocion identity from vocion.ai: the gradient
"governed path" V mark (`packages/core/public/brand/vocion-primary-mark.svg`)
beside the wordmark "Vocion" in the sidebar and on sign-in, and the same mark
as the favicon and Apple touch icon (`app/icon.tsx`, `app/apple-icon.tsx`).
Two more files ship alongside it: `vocion-mono-mark.svg` (ink, for monochrome
contexts, light surfaces only) and `vocion-logo-lockup.svg` (mark + VOCION
wordmark + descriptor; ink text, so light surfaces only).

A client deployment overrides any of it at image build time — `NEXT_PUBLIC_*`
is inlined by Next, so these are `--build-arg`s to `packages/core/Dockerfile`,
not runtime env. Whatever you pass wins over the defaults; leave one unset and
the Vocion default fills in.

| Build-arg | What it does |
| --- | --- |
| `NEXT_PUBLIC_BRAND_NAME` | Wordmark text (default `Vocion`). Title case — all-caps is styling, not the value. |
| `NEXT_PUBLIC_BRAND_TAGLINE` | Subhead under the wordmark, e.g. `agents by Vocion`. |
| `NEXT_PUBLIC_BRAND_MARK` | Glyph image — a path under `public/` or a `data:` URI. Replaces the Vocion mark. |
| `NEXT_PUBLIC_BRAND_LOCKUP` | Mark + wordmark as one image; replaces both glyph and text. |
| `NEXT_PUBLIC_BRAND_LOCKUP_DARK` | Dark-mode lockup variant (only used with `BRAND_LOCKUP`). |
| `NEXT_PUBLIC_BRAND_ATTRIBUTION` | Sidebar footer line (default `Vocion · MPL-2.0`). |

Keep client artwork in the client repo and inline it as a base64 `data:` URI
(`infra/aws/bootstrap.sh` in the Metacto project does this) — OSS `vocion-core`
carries only Vocion's own art. The favicon and touch icon are not part of the
override slot today; they always render the Vocion mark.

---

## Gotchas

Three defaults that are wrong for any client outside `us-east-1`, and one that is wrong behind a load balancer:

| What | Where | Effect |
|---|---|---|
| Region defaults to `us-east-1`, passed positionally | `agentcore-harness-role.sh` | Harness role lands in the wrong region, silently. |
| `VOCION_AGENTCORE_REGION` defaults to `us-east-1` | `services/agents/providers/agentcore.ts` | Agents run their model loop in a region nobody chose. Set it in the parent's compose overlay, for the app *and* the worker. |
| Agent with no `model` resolves to `gpt-4o` | workspace applier | Only bites the `local` provider — `agentcore` agents use `harness.model` — but it bites quietly. Pin every model explicitly. |
| `VOCION_TRUSTED_PROXY_COUNT` defaults to `1` (Caddy alone in front) | `libs/http/clientIp.ts` | Behind a load balancer or CDN every person is counted as the proxy's address, so one office's sign-in attempts lock out another's. Set it to the number of proxies in front of the app, and Caddy's `trusted_proxies` with it — table in `infra/aws/README.md` ("Client addresses and rate limits"). |

**One more, on secrets.** Both parent projects create the Secrets Manager entry
out-of-band and reference it from Terraform as a data source, so API keys never
enter state or `tfvars`. This repo's legacy root `infra/terraform` *creates* the
secret with its value instead; don't copy that. `modules/vocion-stack` keeps the
parents' guarantee another way: it manages each secret's name and never its
value (no `aws_secretsmanager_secret_version` anywhere), and the box reads the
value on every deploy.

---

## Pinning `vocion-core`

Three rules, each earned the hard way:

1. **Take the SHA from `git ls-remote`, never a local checkout.** This repo's
   history was rewritten on 2026-08-31 after the PolinRider compromise, and a
   plain `git fetch` doesn't clobber stale local tags. A local clone will hand
   you a tag pointing at a different object.
2. **Pin a commit on a release line, never the `vocion-v0.5.x` tags.** That
   orphan series shares no ancestor with `main`. Which line to follow (`main`,
   `next`, or a maintenance `N.x` branch) is in [release lines](./release-lines.md).
3. **Run `node scripts/check-config-integrity.mjs` at the new pin before you
   commit it**, and re-check the pin after every merge — a GitHub merge can move
   a submodule pin backwards.
4. **A pin bump is two deploys.** Bumping the pin and deploying the app box
   leaves the agent runtime container on its old image, so the app runs new
   code while the agent loop runs old code and nothing says so. The deployed
   image's tag carries the core commit it was built from, so whether the
   container moved is checkable rather than a judgement call:

   ```bash
   aws ssm get-parameter --name "/vocion/agentcore/<env>/runtime-image" \
     --query 'Parameter.Value' --output text
   git -C vocion-core diff --stat <that-commit>..HEAD -- packages/agent-runtime
   ```

   Empty diff, the container is current. Any output, every environment needs
   `deploy-runtime.sh` as well — and every environment separately, since each
   has its own ECR repository and runtime.

---

## Paste this into a new client project's `CLAUDE.md`

A parent project needs its own `CLAUDE.md`, because the two-deploys rule is the
one thing a session working in that repo cannot infer from the code in front of
it. Adjust the wrapper command names to whatever that project calls them:

```markdown
## A deploy is two deploys

The deploy workflow and `./scripts/deploy.sh apply <env>` update the **app box**
only — sync the checkout, re-run bootstrap, health-gate the URL. They never
touch the agent runtime container.

`./scripts/deploy.sh agentcore <env>` is the second deploy: it builds the arm64
image from `vocion-core/packages/agent-runtime`, pushes it to ECR and updates
the AgentCore Runtime.

After bumping the core pin, deploy both, for every environment, unless
`packages/agent-runtime` is unchanged between what is deployed and the new pin.
The deployed image's tag carries the core commit it was built from:

    aws ssm get-parameter --name "/vocion/agentcore/<env>/runtime-image" \
      --query 'Parameter.Value' --output text
    git -C vocion-core diff --stat <that-commit>..HEAD -- packages/agent-runtime

Empty diff means the container is current. Any output means every environment
needs the agentcore deploy, and a deploy reported as done without it is half a
deploy.

Editing an agent's YAML never needs a container deploy — the artifact is
generic, so agent definitions travel in the invocation payload.

## Migrations: call core's applier

Apply migrations by calling core's script, never by looping over
`packages/core/migrations/*.sql` here:

    sudo MIGRATIONS_DIR=/opt/<project>/vocion-core/packages/core/migrations \
      POSTGRES_CONTAINER=<pg-container> POSTGRES_DB=<database> \
      bash /opt/<project>/vocion-core/infra/aws/apply-migrations.sh

Core keeps index builds that must not lock the table in
`packages/core/migrations/concurrent/`. A glob over the migrations directory
skips that subdirectory silently — the schema change lands, the index does
not, and the deploy still reports success.

If this project keeps its own applier, end every deploy with the same script
under `--verify-indexes`. It reads the database and nothing else, and fails
naming any of those index builds that is missing or `INVALID`:

    sudo MIGRATIONS_DIR=... POSTGRES_CONTAINER=... POSTGRES_DB=... \
      bash .../vocion-core/infra/aws/apply-migrations.sh --verify-indexes
```

---

## The shared stack: `modules/vocion-stack`

Every parent project used to copy `infra/terraform` and edit it. Measured at
`v2.21.0` against the Larkfield copy, `main.tf` was **295 lines, 92 differing,
and 29 of those differences were just resource names and tags**: three copies
of one stack, drifting.

The stack is now a module in this repo:
[`infra/terraform/modules/vocion-stack`](../../infra/terraform/modules/vocion-stack/README.md).
A parent project's `infra/terraform` shrinks to a provider, a backend, a
hosted zone and one call:

```hcl
module "vocion" {
  source = "../../vocion-core/infra/terraform/modules/vocion-stack"

  name_prefix     = "<client>-vocion-${var.environment}"
  azs             = ["us-east-1a", "us-east-1b"]
  hostname        = var.hostname
  route53_zone_id = aws_route53_zone.app.zone_id
  core_ref        = "v5.0.0"
  instance_type   = var.instance_type
}
```

No Terraform registry needed: **the submodule pin already versions it**, so a
client's infrastructure and application move together on one SHA.

What the module brings that the copies did not:

- **Every name from `name_prefix`.** The day-one rule in
  [multiple environments](./multiple-environments.md) is built in.
- **The Cloud profile by default**: an ALB with an ACM certificate and a WAF in
  front of the box, SSM Session Manager instead of SSH, RDS with pgvector and
  a CMK, a KMS credential vault, AWS Backup into a locked vault. Each piece is a
  variable (`alb_enabled`, `waf_enabled`, `ssh_enabled`, `kms_vault_enabled`,
  `backup_enabled`, `runners_enabled`); `alb_enabled = false` is the classic
  single box with Caddy terminating TLS.
- **A box that deploys itself to a pinned release.** `core_ref` is a tag or a
  full sha, never a branch. User-data installs `vocion-deploy`, which reads the
  env from Secrets Manager plus the module's SSM parameter on every run,
  migrates RDS with core's `apply-migrations.sh` before the swap, and checks
  that the new container serves the commit it built. Moving to a new release is
  `sudo vocion-deploy <tag>` from an SSM session. The contract is in the
  module's README.

Moving an existing parent onto the module is a state migration against a live
box, so give it its own change and its own rollback plan:

1. Add the module call beside the existing resources with the same
   `name_prefix`-derived names the live resources already carry, or accept a
   rename where nothing serves traffic.
2. `tofu state mv` each live resource to its address inside the module
   (`aws_vpc.main` → `module.vocion.aws_vpc.main`, and so on), or use `moved`
   blocks in the parent.
3. `tofu plan` until it shows no replacement of the instance, the database or
   the bucket. Anything the module manages differently (an unencrypted root
   volume, a hand-made Elastic IP) stays in the parent until it is retired
   deliberately.

The legacy root at `infra/terraform/*.tf` stays as it is until a deployment
that uses it moves; new installations start from the module.

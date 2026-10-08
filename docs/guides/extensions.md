# Extensions

Core is complete on its own. A deployment can also build in one package from
outside this repository, `@vocion/enterprise`, which adds to core through a
fixed set of seams. Without that package, every seam is empty, and core builds,
runs and tests the same as it would if the seams did not exist.

## Providing the package

The package is a directory with an `index.ts` at its root that exports
`extensions: VocionExtension[]`. It may also have a `client.ts` that exports
`clientExtensions: VocionClientExtension[]`. When core's build or test config
loads, `src/libs/enterpriseCheckout.ts` looks in these places, in order, and
uses the first match:

1. `VOCION_ENTERPRISE_DIR`: an absolute path, or a path relative to
   `packages/core`.
2. `packages/enterprise`: a checkout beside `packages/core`. `packages/*` is
   not an npm workspace glob, so the checkout touches no lockfile.
3. `node_modules/@vocion/enterprise`, in `packages/core` or at the repository
   root. This covers a git dependency or an npm alias installed by the deploy,
   for example `npm i @vocion/enterprise@git+ssh://…`.

Set `VOCION_ENTERPRISE=off` to build without a package that is present.

Core copies the package into `packages/core/src/enterprise-ext/`, which is
gitignored. Core imports exactly two specifiers, `@vocion/enterprise/index`
and `@vocion/enterprise/client`. `next.config.ts` aliases both to the copy, or
to the empty stubs in `src/libs/enterprise-none/` when no package is found.
`tsconfig.json` maps `@vocion/enterprise/*` to the copy first and the stubs
second, which is what `tsc` and the `tsx` scripts (the worker among them)
resolve.

Core copies the package, rather than linking to it, because Turbopack compiles
only files under the project root. The copy also means the package resolves
core's `@/` alias and core's `node_modules`, which is how it imports core. As
with workspace components (`@wsx/registry`), restart `next dev` after you edit
the package.

A deploy that builds with the package does this:

```bash
git clone --depth 1 git@github.com:<org>/<enterprise-repo>.git packages/enterprise
npm ci
npm run build
```

### Tests

Core's own `unit` and `ui` projects always resolve the two specifiers to the
stubs, so they test core whether or not a package is present.

The package's `package.json` can list globs of its own tests under
`vocion.coreTests`, relative to the package root. Those tests run inside
core's vitest setup, which provides PGlite, `vi.mock('@/libs/DB')` and the `@/`
alias, with the specifiers resolved to the package:

- `.ts` files run in the `enterprise` project, which uses the unit project's
  settings.
- `.tsx` files run in the `enterprise-ui` project, which uses the browser
  project's settings.

No other file in the copy is picked up by core's test globs.

## Seams

The types and accessors are in `src/libs/extensions.ts`. Each seam is neutral:
core knows that an extension exists, but not what it does.

| Seam | Where core reads it |
|---|---|
| `budgetGuards` | `BudgetService.preflightCheck`, after every core cap has passed, so a workspace's own cap is the one named when both refuse. A refusal has `scope: 'extension'` and carries the extension's `message`. If a guard throws, it is logged and skipped. |
| `chargeObservers` | `BudgetService.chargeUsage`, after the charge commits. Errors are logged and never thrown. |
| `router` | Served on `/rpc` at `ext.<name>` (`servedRouter()` in `routers/index.ts`). The extension types its own client. |
| `pages` | `/dashboard/ext/<page>/<...path>`. A name that no extension serves returns 404. |
| `slots['system.actions']` | The System page's title-bar actions. |
| `slots['spend.stats']` | The spend page's row of figures. The columns auto-fit, so an empty slot leaves no gap. |
| `orgs.multiOrg()` | `services/OrgPolicy.ts`. `true` lifts the single-Org rule. Without an extension, core is always single-Org. |
| `orgs.scopeWorkspaceSwitcher` | `projects.list` returns `switcherScope: 'org'`, and the workspace switcher then lists only the current Org's workspaces. |
| `signInProviders` | `libs/identity/signInProviders.ts`: more "Continue with …" buttons after Google and Microsoft, registered with Auth.js and shown on the profile page. Each descriptor says when it is `configured`, how to `build` its Auth.js provider, and which address it vouches for (`trustedEmail`); core's invite-only rules apply unchanged. An id already taken is ignored. See [sign-in-with-google-or-microsoft.md](sign-in-with-google-or-microsoft.md). |
| `navSlots['nav.aboveWorkspaceSwitcher']` (client) | Directly above the workspace switcher. Each component receives the sidebar's workspace directory, the same landing-page function as the switcher, and whether the sidebar is collapsed. |

Core also exports these so that an extension's interface matches core's:

- `SwitcherRow` and `keepKeyboardDownOnTouch` (`features/dashboard/nav/WorkspaceSwitcher.tsx`)
- `projectsInOrg` and `workspaceSwitchHref` (`workspaceSwitch.ts`)
- `inviteUrl` and `CopyLink` (`features/members/InviteDialog.tsx`)

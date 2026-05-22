# Phase 3 + 4 — Demo UX prep

**You wanted:** new project → admin signup → drop into dashboard. Demos with simple credentials shown as a hint on the sign-in page. This doc is the executable spec.

**Blocked on:** Phase 2 (auth.js replacing Clerk). Phase 3's `/setup` flow + Phase 4's seed script both call into the auth.js API. Until that's in, Clerk's `<SignIn />` component owns the sign-in page and the only way to "create an admin" is the Clerk dashboard.

**Branch state when picking this up:** `phase-1-auth-tenancy` has the schema + AuthGuards prep. Phase 2 needs to land first (rip out Clerk, install auth.js, swap the providers).

---

## Phase 3 — First-run setup + invite flow

### 1. Boot-time check

In `src/proxy.ts` (after auth.js replaces Clerk middleware), add a check **before** any other routing:

```ts
import { db } from '@/libs/DB';
import { tenantAccountSchema } from '@/models/Schema';

const hasAnyAccount = await db.select({ id: tenantAccountSchema.id })
  .from(tenantAccountSchema).limit(1);

if (hasAnyAccount.length === 0 && !request.nextUrl.pathname.startsWith('/setup')) {
  return NextResponse.redirect(new URL('/setup', request.url));
}
```

Cache the result in module scope after first DB hit to avoid running on every request.

### 2. `/setup` route

New file: `src/app/[locale]/(setup)/setup/page.tsx`. Plain form:

```tsx
'use client';
// fields: name, email, password (confirm)
// onSubmit: POST /api/setup → { ok: true } → router.push('/dashboard')
```

### 3. `/api/setup` route handler

`src/app/api/setup/route.ts`:

```ts
export async function POST(req: Request) {
  // 1. Refuse if any tenant_account already exists (one-shot)
  // 2. Create tenant_account (id 'default-account', name from form, slug 'default')
  // 3. Create project (id 'default-project', accountId 'default-account', slug 'default', name 'Default project')
  // 4. Create user (auth.js's createUser with email + bcrypt(password))
  // 5. Create account_membership (accountId, userId, role: 'admin')
  // 6. Sign the user in (auth.js's signIn() helper) — returns a session cookie
  // 7. Return { redirect: '/dashboard' }
}
```

Critical: this route must be safe-once. Wrap in a transaction; check tenant_account count again *inside* the transaction.

### 4. Team invite flow (skeleton, no email delivery)

New page: `src/app/[locale]/(auth)/dashboard/team/page.tsx`
- Lists `account_membership` rows joined with `user` (email + role)
- "Invite by email" button → opens dialog → POSTs to `/api/team/invite`
- `/api/team/invite` creates an `invite` row, returns the invite URL — render the URL in the dialog (copy button)

New page: `src/app/[locale]/(auth)/invite/[token]/page.tsx`
- Reads `invite` row by token
- Form: set name + password
- On submit: create user, create account_membership, mark invite acceptedAt, sign in, redirect to /dashboard

**Email delivery is out of scope** — for v1, the admin shares the copy-link URL by hand. Wire SMTP (Resend / Postmark) in a follow-up.

---

## Phase 4 — Demo seeding

### 1. The seed CLI (in vocion-core)

New file: `src/scripts/seed-demo.ts`:

```ts
// CLI args: --email, --password, --account-name, --project-name, --project-slug
// Runs the same operations as /api/setup, idempotent on conflict.
// Skip if tenant_account already exists with the given slug.
// Exit 0 on success; 0 (no-op) if already seeded; 1 on error.
```

Add to `package.json` scripts:
```json
"seed:demo": "dotenv -c -- tsx src/scripts/seed-demo.ts"
```

### 2. Wire seed into vocion-demos

Update `vocion-demos/demos/support-reply/scripts/dev.sh` to call seed before starting core:

```bash
# After loading .env.local, before `cd $CORE_DIR && npm run dev`:
if [ -z "${VOCION_SKIP_SEED:-}" ]; then
  (cd "$CORE_DIR" && npm run seed:demo -- \
    --email "${VOCION_DEMO_HINT_EMAIL}" \
    --password "${VOCION_DEMO_HINT_PASSWORD}" \
    --account-name "Support Demo" \
    --project-name "Support reply demo" \
    --project-slug support-demo)
fi
```

Seed is idempotent — running every boot is fine.

### 3. Demo .env.local additions

`vocion-demos/demos/support-reply/.env.local` adds:
```
VOCION_DEMO_HINT_EMAIL=demo@example.com
VOCION_DEMO_HINT_PASSWORD=demo123
```

### 4. Sign-in hint banner

Modify `src/app/[locale]/(auth)/(center)/sign-in/page.tsx` (the auth.js custom form from Phase 2):

```tsx
const hintEmail = process.env.VOCION_DEMO_HINT_EMAIL;
const hintPassword = process.env.VOCION_DEMO_HINT_PASSWORD;

{hintEmail && hintPassword && (
  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
    <strong>Demo credentials:</strong> {hintEmail} / {hintPassword}{' '}
    <button onClick={() => autofill(hintEmail, hintPassword)}>autofill</button>
  </div>
)}
```

Only renders when both env vars are set — production builds without them never show the banner.

### 5. Demo README block

Update `vocion-demos/demos/support-reply/README.md` with:
```md
## Demo credentials
- Email: `demo@example.com`
- Password: `demo123`

Shown as a hint on the sign-in page. Seeded automatically on first dev.sh run.
```

---

## Verification

1. **Fresh DB → /setup flow**
   - Drop the local PGlite (`rm -rf packages/core/local.db`)
   - Run `npm run dev` → http://localhost:3000 redirects to `/setup`
   - Submit the form → land in `/dashboard`
   - Confirm `tenant_account` and `project` rows exist; logged in as admin
2. **Demo boots with hint**
   - `cd vocion-demos/demos/support-reply && ./scripts/dev.sh`
   - http://localhost:3001/sign-in shows the amber hint banner
   - Autofill button populates email + password
   - Sign-in lands in dashboard with the demo's support-demo project loaded
3. **Invite flow**
   - As admin, /dashboard/team → invite → copy URL → open in incognito → set password → land in /dashboard as member
4. **Re-seed is no-op**
   - Run `dev.sh` twice; second run doesn't error, doesn't duplicate

---

## Order to execute (when ready)

1. Finish Phase 2 (auth.js replaces Clerk) — prerequisite
2. Phase 1.5 — drop `org_id` columns, rewrite ~65 service-layer queries to use `project_id`. This is the mechanical slog. Maybe do it during Phase 2 since you're already touching everything.
3. Phase 3.1 — proxy bootstrap check + /setup route + /api/setup handler
4. Phase 3.2 — /dashboard/team + /invite/[token]
5. Phase 4 — seed CLI + dev.sh wiring + .env.local + sign-in hint
6. Update vocion-demos to use the new bootstrap. Test from a clean PGlite.
7. Tag `vocion-v0.4.0` after Phase 4 ships.

Estimated effort once Phase 2 is in: **1-2 days for Phases 3+4 together**. Most of the work is forms + a CLI; the auth.js wiring did the hard part.

---

## Open decisions to make when you get there

- **Password policy**: zxcvbn check? Min length? For now, just min-8 + non-empty.
- **Email verification at setup**: skip for self-hosted (admin is by definition trusted); cloud should require.
- **Multiple demo accounts**: today's seed assumes one tenant_account. Cloud will need a different seed shape (skip account creation, just create user + add to existing account). Don't conflate yet — keep seed for self-hosted demos only.
- **Locale of the /setup form**: bypass i18n on the bootstrap path, or honor the browser locale? Easier to bypass — `/setup` is once per install.
- **Demo password strength**: `demo123` is intentionally weak (it's a public demo). Don't run zxcvbn on these. Add a `VOCION_ALLOW_WEAK_PASSWORDS=1` escape hatch for demos.

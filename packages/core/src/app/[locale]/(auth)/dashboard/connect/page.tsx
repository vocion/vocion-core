import { auth } from '@/libs/Auth';
import { pendingRequest } from '@/services/OAuthService';

/**
 * CONNECT AN ASSISTANT (backlog 027). An assistant — Claude, ChatGPT, Claude
 * Code — asked to sign in; this is where the person says yes, for the
 * workspace they are in. One page, one question, two buttons; the sign-in
 * that may precede it is the app's own.
 * @param props - Route props.
 * @param props.searchParams - `request`: the sign-in request id from /oauth/authorize.
 */
export default async function ConnectPage(props: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await props.searchParams;
  const session = await auth();
  const pending = request ? await pendingRequest(request) : null;
  if (!pending) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight">That sign-in request has expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">Start again from the assistant: it will bring you back here with a fresh request. Requests last ten minutes.</p>
      </main>
    );
  }
  const workspace = session?.user?.projectId ?? null;
  return (
    <main className="mx-auto max-w-md px-6 py-16" data-testid="connect-assistant">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Connect an assistant</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">{`Let ${pending.clientName} use this workspace?`}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        It will be able to ask the workspace questions, look records up, file asks and put up cards as you — for thirty days, or until you revoke it under Settings → API. It cannot approve anything: decisions stay in the app.
      </p>
      {workspace === null
        ? <p className="mt-4 text-sm text-brand-amber-deep">Pick a workspace first (the switcher in the sidebar), then come back to this page.</p>
        : (
            <form method="post" action="/oauth/consent" className="mt-6 flex gap-2">
              <input type="hidden" name="request" value={pending.id} />
              <button type="submit" name="decision" value="approve" className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">Allow</button>
              <button type="submit" name="decision" value="deny" className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground">Not now</button>
            </form>
          )}
    </main>
  );
}

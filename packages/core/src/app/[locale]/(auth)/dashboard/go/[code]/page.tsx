import { notFound, redirect } from 'next/navigation';
import { clerkAuth as auth } from '@/libs/Auth';
import { hrefForCode } from '@/services/codeLinks';
import { resolveCode } from '@/services/codes';

/**
 * `/dashboard/go/<code>` — a code as a link. `FE-294` opens the feature,
 * `RUN-439` the run, `ASK-267` the ask; any case, and an old `294` still
 * resolves. One resolver (`services/codes.ts`), so a code typed in chat, in
 * ⌘K or pasted into the address bar lands on the same page.
 * @param props - Next's route props.
 * @param props.params - `{ code }`.
 */
export default async function GoToCodePage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const { orgId } = await auth();
  if (!orgId) {
    redirect('/api/auth/signout?callbackUrl=/sign-in');
  }
  const resolved = await resolveCode(orgId, decodeURIComponent(code)).catch(() => null);
  if (!resolved || resolved.kind === 'none') {
    return notFound();
  }
  redirect(await hrefForCode(orgId, resolved));
}

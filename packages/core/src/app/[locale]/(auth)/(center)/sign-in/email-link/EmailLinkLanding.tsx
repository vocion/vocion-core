'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuthBrandLogo } from '@/features/branding/AuthBrand';
import { Link } from '@/libs/I18nNavigation';
import { callbackPathFromFragment } from '@/services/auth/emailLinkFragment';

type Target = { path: string; email: string };

/**
 * The button a mailed sign-in link leads to. The token travels in the
 * fragment, which no server sees; once read, it is cleared from the address
 * bar so it is not left in history or shared by a copied URL.
 */
export function EmailLinkLanding() {
  // undefined while the fragment has not been read yet; null when it holds no link.
  const [target, setTarget] = useState<Target | null | undefined>(undefined);
  const [going, setGoing] = useState(false);
  // Read once: the fragment is cleared right after, and an effect can run
  // twice (React's development double-invoke) on the same component.
  const read = useRef<Target | null | undefined>(undefined);

  useEffect(() => {
    if (read.current === undefined) {
      read.current = callbackPathFromFragment(window.location.hash);
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    // The fragment exists only in the browser, so it is read after mount.
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setTarget(read.current);
  }, []);

  return (
    <div className="w-full max-w-sm px-4">
      <div className="rounded-2xl border border-border/60 bg-card/80 p-8 text-center shadow-xl shadow-black/5 backdrop-blur-sm">
        <div className="mb-6 flex flex-col items-center gap-4">
          <AuthBrandLogo />
        </div>
        {target === undefined && <p className="text-sm text-muted-foreground">Reading your link…</p>}
        {target === null && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">This link is incomplete</h1>
            <p className="text-sm text-muted-foreground">Open the link from the email again, or ask for a new one.</p>
            <Link className="text-sm underline" href="/sign-in">Back to sign-in</Link>
          </div>
        )}
        {target && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-muted-foreground">{`Continue as ${target.email}.`}</p>
            <Button
              type="button"
              className="w-full"
              disabled={going}
              onClick={() => {
                setGoing(true);
                window.location.assign(target.path);
              }}
            >
              {going ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { SessionProvider } from 'next-auth/react';

export default function AuthLayout(props: {
  children: React.ReactNode;
}) {
  // auth.js's SessionProvider exposes `useSession()` to client components.
  // No-op cookie handling — auth.js reads its session cookie automatically.
  return <SessionProvider>{props.children}</SessionProvider>;
}

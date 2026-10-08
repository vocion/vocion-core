import { ConnectDone } from '@/features/dashboard/connect-systems/ConnectDone';

/**
 * Where a login started from "Connect your systems" lands
 * (`/dashboard/connect/done?connect=ok|error`). It runs in the small window
 * the walk-through opened, so it carries none of the dashboard's shell (its
 * own route group): it hands the outcome back to the window that opened it
 * and closes. Opened any other way, it says what happened and links home.
 */
export default function ConnectDonePage() {
  return <ConnectDone />;
}

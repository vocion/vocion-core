import { NextResponse } from 'next/server';
import { DEMO_CHROME_SCRIPT } from '@/libs/media/demoChrome';

/**
 * GET /api/demo-chrome
 *
 * The script a recorded demo injects so a viewer knows where to look: the gliding cursor, the
 * click ripple, the spotlight outline and the keycap (`libs/media/demoChrome.ts`). The runner's
 * preview demo fetches it from the deployment it reports to, so the demo recorded from a branch
 * and the live demo wear the same chrome. Plain JavaScript, no data of anyone's, cacheable.
 * @returns 200 with the script as `text/javascript`.
 */
export async function GET() {
  return new NextResponse(DEMO_CHROME_SCRIPT, {
    status: 200,
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

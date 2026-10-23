/**
 * The open tab's count in words: "24 decisions and 11 failed runs to retry or
 * dismiss". The badge is the first number. Pure.
 * @param open - Open rows.
 * @param failed - Of them, failed runs.
 */
export function openCountLine(open: number, failed: number): string {
  const decisions = Math.max(0, open - failed);
  const runs = `${failed} failed ${failed === 1 ? 'run' : 'runs'} to retry or dismiss`;
  if (failed === 0) {
    return `${decisions} ${decisions === 1 ? 'decision' : 'decisions'}`;
  }
  return decisions === 0 ? runs : `${decisions} ${decisions === 1 ? 'decision' : 'decisions'} and ${runs}`;
}

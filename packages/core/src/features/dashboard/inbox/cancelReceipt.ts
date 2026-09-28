/**
 * What to tell a person after they pressed Cancel on a run, read from the
 * run as the server returned it.
 *
 * Cancelling a run that already finished is now a no-op that returns the run
 * unchanged (vocion-core#123), rather than relabelling a completed run
 * `cancelled`. A page loaded before the run finished still offers Cancel, so
 * "Stopped; nothing more runs." would claim a stop that never happened.
 */
export type CancelReceipt = {
  tone: 'success' | 'info';
  title: string;
  description: string;
};

/**
 * The toast for a cancel that did not throw.
 * @param runTitle - The run's title, as the toast names it.
 * @param statusAfter - The run's status in the cancel call's response.
 * @returns The toast's tone, title and description.
 */
export function cancelReceipt(runTitle: string, statusAfter: string | undefined): CancelReceipt {
  if (statusAfter === undefined || statusAfter === 'cancelled') {
    return { tone: 'success', title: `Cancelled · ${runTitle}`, description: 'Stopped; nothing more runs.' };
  }
  return {
    tone: 'info',
    title: `Already ${statusAfter.replace('_', ' ')} · ${runTitle}`,
    description: 'It finished before the cancel reached it, so there was nothing to stop.',
  };
}

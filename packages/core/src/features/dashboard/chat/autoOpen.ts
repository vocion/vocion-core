/**
 * WHEN A PREVIEW OPENS BY ITSELF.
 *
 * A record or artifact a turn makes opens beside the conversation without a
 * tap (Chris, 2026-09-17/18) — except on a turn that carried an upload. The
 * file the person just attached is not news to them, and on a phone the
 * preview it opened took the screen (a phone walk, 2026-10-10: an uploaded
 * .xlsx opened by itself). Such a turn shows its chip in the chat; a tap on
 * the chip opens it.
 * @param turn - The turn the event came from.
 * @param turn.fromUpload - The person's message carried files.
 */
export function opensPreviewOnItsOwn(turn: { fromUpload: boolean }): boolean {
  return !turn.fromUpload;
}

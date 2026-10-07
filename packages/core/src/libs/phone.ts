/**
 * A phone number as one string everywhere: E.164 (`+19705550100`). What a person types (with
 * spaces, dashes, brackets, a leading 1, or a 10-digit US number) is read into it; anything that
 * cannot be a phone number is null, never a guess.
 * @param raw - What was typed.
 */
export function toE164(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) {
    return null;
  }
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return null;
}

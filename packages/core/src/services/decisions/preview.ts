/**
 * AN APPROVAL SHOWS EXACTLY WHAT IT WILL DO.
 *
 * The docked approval is a permission prompt: above "Allow once" sits the
 * payload the person is held to — the email as it will go out, the fields a
 * record update will set, the command. Read from the action's typed input,
 * never from the agent's description of it, and drawn as plain text.
 */

const MAX = 4_000;

/**
 * One value as a line reads it.
 * @param v - The value.
 */
function plain(v: unknown): string {
  if (v === null || v === undefined) {
    return '—';
  }
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * The payload an action will run with, as the preview shows it.
 * @param input - The action's input.
 */
export function payloadPreview(input: Record<string, unknown> | null | undefined): string | null {
  const i = input ?? {};
  if (Object.keys(i).length === 0) {
    return null;
  }
  // A message: its envelope, then its words.
  const body = typeof i.body === 'string' ? i.body : typeof i.text === 'string' ? i.text : null;
  if (body !== null && (i.to !== undefined || i.subject !== undefined || i.channel !== undefined)) {
    const head = [
      i.to !== undefined ? `To: ${plain(i.to)}` : null,
      i.cc !== undefined ? `Cc: ${plain(i.cc)}` : null,
      i.channel !== undefined ? `Channel: ${plain(i.channel)}` : null,
      i.subject !== undefined ? `Subject: ${plain(i.subject)}` : null,
    ].filter(Boolean).join('\n');
    return `${head}\n\n${body}`.slice(0, MAX);
  }
  // A record update: what it changes, field by field.
  const fields = (i.properties ?? i.fields ?? i.patch) as Record<string, unknown> | undefined;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const target = [i.objectType, i.id ?? i.objectId ?? i.recordId].filter(x => x !== undefined).map(plain).join(' #');
    const lines = Object.entries(fields).map(([k, v]) => `${k} → ${plain(v)}`);
    return `${target ? `${target}\n` : ''}${lines.join('\n')}`.slice(0, MAX);
  }
  // A command, as it will run.
  if (typeof i.command === 'string') {
    return `$ ${i.command}`.slice(0, MAX);
  }
  return JSON.stringify(i, null, 2).slice(0, MAX);
}

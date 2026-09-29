import { slugifyOption } from '@/libs/asks/optionId';

/**
 * The choices a ruling card offers in place of Approve: the options of an
 * `ask.file` filing, recommended first. Null for any other card.
 * @param rec - The recommendation.
 * @param rec.actionId
 * @param rec.input
 */
export function rulingChoices(rec: { actionId?: string | null; input: Record<string, unknown> }): Array<{ id: string; label: string; recommended: boolean }> | null {
  if (rec.actionId !== 'ask.file' || !Array.isArray(rec.input.options) || rec.input.options.length === 0) {
    return null;
  }
  const out = (rec.input.options as unknown[]).map((o) => {
    if (typeof o === 'string') {
      return { id: slugifyOption(o), label: o, recommended: false };
    }
    const r = (o ?? {}) as { id?: string; label?: string; recommended?: boolean };
    const label = typeof r.label === 'string' ? r.label : '';
    return { id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : slugifyOption(label), label, recommended: r.recommended === true };
  }).filter(o => o.label);
  return out.length > 0 ? [...out].sort((a, b) => Number(b.recommended) - Number(a.recommended)) : null;
}

/**
 * The filing's input with a person's choice on it — what deciding a ruling
 * sends as `editedInput`, from the card and the review page alike, so the two
 * decide it exactly the same way (`ask.file` reads `answer`).
 * @param input - The filing's input.
 * @param optionId - The chosen option.
 */
export function answerInput(input: Record<string, unknown>, optionId: string): Record<string, unknown> {
  return { ...input, answer: optionId };
}

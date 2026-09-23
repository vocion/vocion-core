/**
 * The arguments `propose_action` takes, as a module of its own.
 *
 * It lived inline in the tool factory, which was fine for the agent and left
 * nothing else able to read it. The workspace loader now checks every eval
 * rule that names a `propose_action` argument against this shape before a
 * dataset is applied, so a check pointing at `suggested_decison` or
 * `action_input.feilds.startDate` is refused at push instead of failing every
 * run for a reason nobody can see. Keeping the schema here, with no tool or
 * database import, is what lets the loader use it offline.
 */

import { z } from 'zod';
import { SUGGESTED_DECISIONS } from './suggestedDecision';

export const proposeActionArgsSchema = z.object({
  action_id: z.string().describe('Registered action id, e.g. "hubspot.update" or "gmail.send"'),
  action_input: z.record(z.string(), z.unknown()).describe('The action\'s input payload (e.g. for hubspot.update: { objectType: "deals", objectId: "123", properties: { dealstage: "..." } })'),
  confidence: z.number().min(0).max(1).describe('Your confidence this change is correct, 0–1 (e.g. 0.85)'),
  rationale: z.string().describe('One or two sentences: WHY this change, citing the evidence'),
  evidence: z.array(z.string()).optional().describe('Source doc uris/ids backing the proposal (e.g. gmail message ids, hubspot record uris)'),
  suggested_decision: z.enum(SUGGESTED_DECISIONS).describe('Required on every proposal. What you think the reviewer should DO, which is a different question from how confident you are: "approve" to go ahead, "reject" if you believe this should be turned down, "snooze" if it is worth another look later. Always pick the one that best fits the criteria you were given — an unsure read is still a read, and "I would lean to approving this" is worth more to a reviewer than silence. Say "reject" when that is genuinely your call: filing a record you think should be declined is how a person sees your judgement. Advisory: a person always decides, and this never makes anything run on its own.'),
  suggested_decision_reason: z.string().describe('Required on every proposal. ONE short sentence for why you recommended that, in plain words a reviewer can check: "third listing of this same show this week", "date has already passed", "venue is outside the coverage area". Keep it to roughly that length — it is read beside a badge on a card, so one clause beats two, and a paragraph is wrong however true it is. This is not the same as `rationale` — that one argues your payload is right, this one argues what should happen to it, which is the whole content of a "reject". Name the one thing that tipped it, do not restate the payload, and do not say how confident you feel.'),
  suggested_snooze_until: z.string().optional().describe('ISO timestamp for when this is worth revisiting. Only meaningful with suggested_decision "snooze".'),
});

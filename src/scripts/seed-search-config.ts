import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/corecontext' });

  const searchConfig = {
    // Recency decay: score * (decayFactor ^ days_old)
    // 0.98 = 2% penalty per day. A 7-day-old doc scores 0.98^7 = 0.87x. A 30-day-old scores 0.55x.
    recencyDecay: 0.98,
    // Source weights: multiplier applied to each source type's score
    sourceWeights: {
      zoom: 1.5, // Zoom calls are highest signal for sales ops
      hubspot: 1.3, // CRM data is core
      gmail: 1.2, // Email threads are important
      google_drive: 0.8, // Drive has lots of noise (old docs, shared folders)
      google_calendar: 1.0,
      slack: 0.9,
    },
    maxResults: 10,
    minRelevance: 0.0, // No threshold for now — let the agent decide
  };

  const fewShotExamples = [
    {
      input: 'What discovery calls did I have this week?',
      output: 'Here are the discovery calls from this week:\n\n1. **Dr. K — Unmuted** — 25 min, today [1]\n   - Building an AI-powered adaptive learning platform for trauma healing\n   - Budget: $70-90K for Phase 1 PWA\n   - Timeline: Alpha by April, not rushing\n   - Next steps: NDA sent, Dr. K sending tech specs, follow-up call to review\n\n2. **Kevin / Kristen — MetaCTO Discovery Call** — 32 min, Tuesday [2]\n   - Topics: project scope, timeline, budget, goals\n   - Next steps: send capabilities deck, schedule follow-up\n\nWant me to summarize either call in detail or draft a follow-up email?',
      label: 'Good: cites sources by number, includes key details (duration, budget, timeline, next steps), offers next actions',
    },
    {
      input: 'Show me recent Zoom meetings',
      output: 'Here are your most recent Zoom meetings:\n\n1. **Dr. K — Unmuted discovery call** — today, 25 min [1]\n2. **Joel: MetaCTO <> Intro Call** — yesterday, 22 min [2]\n3. **Jeana Hicks: MetaCTO <> Intro Call** — yesterday, 32 min [3]\n4. **Jack Kelly: MetaCTO <> Intro Call** — Mon, 37 min [4]\n5. **1:1 Akram <> Chris** — Mon, 24 min (recurring sync) [5]\n\nCalls [1]-[4] appear to be prospect conversations. [5] is an internal sync.',
      label: 'Good: recent first, brief format, distinguishes prospect vs internal calls',
    },
  ];

  await pool.query(
    'UPDATE agent SET search_config = $1, few_shot_examples = $2 WHERE slug = $3',
    [JSON.stringify(searchConfig), JSON.stringify(fewShotExamples), 'ziggy'],
  );

  console.log('Updated Ziggy with search config and few-shot examples');
  console.log('  Recency decay:', searchConfig.recencyDecay);
  console.log('  Source weights:', searchConfig.sourceWeights);
  console.log('  Few-shot examples:', fewShotExamples.length);

  await pool.end();
}

main().catch(console.error);

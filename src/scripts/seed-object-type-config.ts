import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/corecontext' });

  // Discovery Call — source relevance + classification config
  await pool.query(`
    UPDATE business_object_type SET
      source_relevance = $1,
      few_shot_examples = $2,
      classification_prompt = $3
    WHERE slug = 'discovery_call'
  `, [
    JSON.stringify({
      zoom: 2.0, // Primary source — the call itself
      google_calendar: 1.5, // Calendar event with scheduling context
      hubspot: 1.3, // CRM contact/deal record
      gmail: 1.0, // Email thread context
      google_drive: 0.3, // Rarely relevant for individual calls
    }),
    JSON.stringify([
      {
        input: 'Title: "📱 MetaCTO <> 30 min intro"\nTranscript start: "Hello, Dr. K, how are you? ... So I\'m looking to build out this PWA..."\nTranscript end: "...I\'ll send you the NDA... schedule a follow-up call..."',
        output: '{"call_type":"discovery","prospect_name":"Dr. K","prospect_company":"Unmuted","budget_signals":"$70-90K for Phase 1","timeline":"Alpha by April"}',
        label: 'Discovery: titled "intro" but discusses product needs, budget, timeline',
      },
      {
        input: 'Title: "Leif Cefalo — MetaCTO <> 30 min intro"\nTranscript start: "Hi, Chris... not too bad, how about yourself..."\nTranscript end: "...great, I\'ll send that over... schedule follow-up..."',
        output: '{"call_type":"discovery","prospect_name":"Leif Cefalo","prospect_company":null}',
        label: 'Discovery: first meeting with prospect, Chris hosts',
      },
      {
        input: 'Title: "SHC Mobile + Web - Daily Scrum"\nTranscript start: "Good morning team, let\'s go around... what did you work on yesterday..."\nTranscript end: "...any blockers? Alright see you tomorrow..."',
        output: '{"call_type":"check-in"}',
        label: 'NOT discovery: recurring team standup with existing client',
      },
    ]),
    `A discovery call at MetaCTO is ANY first meeting with a prospect. Signs:
- Chris Fitkin (chris@metacto.com) is the host
- The other person is someone new (not a MetaCTO team member)
- They discuss: their product/project, budget, timeline, goals, or needs
- Chris describes MetaCTO's services, team, process, or pricing
- Next steps involve NDA, proposal, capabilities deck, or follow-up call
- Often titled "MetaCTO <> 30 min intro" or similar via Calendly

NOT a discovery call:
- Daily standups, scrums, syncs with existing clients
- Internal MetaCTO team meetings
- Calls hosted by other MetaCTO team members (Jamie, Valerie) unless with a new prospect`,
  ]);

  console.log('Updated discovery_call with source_relevance, few_shot_examples, classification_prompt');

  // Deal — source relevance
  await pool.query(`
    UPDATE business_object_type SET source_relevance = $1 WHERE slug = 'deal'
  `, [JSON.stringify({
    hubspot: 2.0,
    gmail: 1.5,
    zoom: 1.3,
    google_drive: 1.2,
    google_calendar: 0.8,
  })]);
  console.log('Updated deal source_relevance');

  // Account
  await pool.query(`
    UPDATE business_object_type SET source_relevance = $1 WHERE slug = 'account'
  `, [JSON.stringify({
    hubspot: 2.0,
    gmail: 1.3,
    google_drive: 1.2,
    zoom: 1.0,
    slack: 1.0,
  })]);
  console.log('Updated account source_relevance');

  await pool.end();
}

main().catch(console.error);

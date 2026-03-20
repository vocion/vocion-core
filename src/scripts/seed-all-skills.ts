import { Pool } from 'pg';

const ORG_ID = 'org_3B7f6cPKTKnJOExO55asDaUVAay';

const skills = [
  // Active skills (already exist, will update)
  {
    slug: 'discovery_summary',
    name: 'Discovery Summary',
    description: 'Analyze a Zoom discovery call transcript and produce a structured summary with prospect info, pain points, product goals, features, tech stack, budget, timeline, and next steps.',
    category: 'query',
    requiresApproval: 'false',
    status: 'active',
    model: 'gpt-5.4-mini',
    temperature: '0.2',
  },
  {
    slug: 'draft_followup_email',
    name: 'Draft Follow-up Email',
    description: 'Draft a capabilities follow-up email after a discovery call, incorporating relevant MetaCTO services, case studies, and a clear next step.',
    category: 'mutation',
    requiresApproval: 'true',
    status: 'active',
    model: 'gpt-5.4-mini',
    temperature: '0.4',
  },
  // Planned skills (disabled)
  {
    slug: 'summarize_deal',
    name: 'Summarize Deal',
    description: 'Pull context from HubSpot, Gmail, Zoom, and Drive to create a comprehensive deal brief — status, contacts, timeline, risks, and next steps.',
    category: 'query',
    requiresApproval: 'false',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.2',
  },
  {
    slug: 'draft_proposal_brief',
    name: 'Draft Proposal Brief',
    description: 'Generate a proposal brief from discovery summary + deal context. Outputs structured inputs for proposal deck generation.',
    category: 'mutation',
    requiresApproval: 'true',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.3',
  },
  {
    slug: 'inbox_triage',
    name: 'Inbox Triage',
    description: 'Scan recent Gmail threads and classify them: needs response, FYI, escalation, or follow-up. Prioritize by urgency and deal stage.',
    category: 'query',
    requiresApproval: 'false',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.2',
  },
  {
    slug: 'aging_pipeline',
    name: 'Aging Pipeline Report',
    description: 'Identify stalled deals, cold leads, unresponded threads, and aging proposals. Generate follow-up recommendations.',
    category: 'query',
    requiresApproval: 'false',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.2',
  },
  {
    slug: 'draft_lead_response',
    name: 'Draft Lead Response',
    description: 'Draft an initial response to an inbound lead based on their message, company info, and MetaCTO capabilities.',
    category: 'mutation',
    requiresApproval: 'true',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.4',
  },
  {
    slug: 'capability_asset_selection',
    name: 'Select Capability Assets',
    description: 'Given a discovery summary, find the most relevant MetaCTO case studies, sample work, and capabilities PDFs from Google Drive.',
    category: 'query',
    requiresApproval: 'false',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.2',
  },
  {
    slug: 'account_timeline',
    name: 'Account Timeline',
    description: 'Build a chronological timeline of all interactions with a company: meetings, emails, deals, proposals, and notes.',
    category: 'query',
    requiresApproval: 'false',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.2',
  },
  {
    slug: 'objection_analysis',
    name: 'Objection Analysis',
    description: 'Analyze email threads and call transcripts to identify objections, concerns, and pushback. Suggest responses.',
    category: 'query',
    requiresApproval: 'false',
    status: 'disabled',
    model: 'gpt-5.4-mini',
    temperature: '0.3',
  },
];

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/corecontext' });

  for (const skill of skills) {
    const existing = await pool.query('SELECT id FROM skill WHERE slug = $1 AND org_id = $2', [skill.slug, ORG_ID]);
    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE skill SET name = $1, description = $2, category = $3, requires_approval = $4, status = $5, model = $6, temperature = $7 WHERE slug = $8 AND org_id = $9',
        [skill.name, skill.description, skill.category, skill.requiresApproval, skill.status, skill.model, skill.temperature, skill.slug, ORG_ID],
      );
      console.log(`Updated: ${skill.slug} (${skill.status})`);
    } else {
      await pool.query(
        `INSERT INTO skill (org_id, slug, name, description, prompt_template, category, requires_approval, status, model, temperature)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [ORG_ID, skill.slug, skill.name, skill.description, `[Placeholder prompt for ${skill.name}]`, skill.category, skill.requiresApproval, skill.status, skill.model, skill.temperature],
      );
      console.log(`Created: ${skill.slug} (${skill.status})`);
    }
  }

  // Update Ziggy agent to include all skill slugs
  const allSlugs = skills.map(s => s.slug);
  await pool.query('UPDATE agent SET skill_slugs = $1 WHERE slug = $2', [JSON.stringify(allSlugs), 'ziggy']);
  console.log(`\nUpdated Ziggy agent with ${allSlugs.length} skills`);

  await pool.end();
}

main().catch(console.error);

/**
 * Seed the initial Ziggy skills: Discovery Summary + Follow-up Email Draft
 *
 * Usage: npx tsx src/scripts/seed-skills.ts
 */

import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../models/Schema';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const ORG_ID = 'org_3B7f6cPKTKnJOExO55asDaUVAay';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle({ client: pool, schema });

  // Ensure org exists
  await db.insert(schema.organizationSchema).values({ id: ORG_ID }).onConflictDoNothing();

  const skills = [
    {
      slug: 'discovery_summary',
      name: 'Discovery Summary',
      description: 'Analyze a Zoom discovery call transcript and produce a structured summary with key topics, pains, budget signals, timeline, and next steps.',
      category: 'query',
      requiresApproval: 'false',
      model: 'gpt-4o',
      temperature: '0.2',
      inputSchema: {
        type: 'object',
        properties: {
          transcript: { type: 'string', description: 'The full call transcript text' },
          meeting_title: { type: 'string', description: 'Meeting title from Zoom' },
          host: { type: 'string', description: 'Host email' },
        },
        required: ['transcript'],
      },
      promptTemplate: `You are a sales operations analyst for MetaCTO, an AI consultancy. Analyze this discovery call transcript and produce a structured summary.

## Meeting
Title: {{meeting_title}}
Host: {{host}}

## Transcript
{{transcript}}

## Output Format
Respond with the following sections:

### Summary
2-3 sentence overview of the call.

### Prospect
- **Name:** (prospect name and title)
- **Company:** (company name)
- **Role:** (their role/department)

### Key Discussion Points
Bullet list of the main topics discussed.

### Pain Points & Needs
What problems are they trying to solve?

### Budget Signals
Any mentions of budget, pricing expectations, or financial constraints.

### Timeline
When do they want to start? Any deadlines?

### Next Steps
Concrete action items from the call.

### Fit Assessment
Quick assessment: is this a good fit for MetaCTO? Why or why not?`,
    },
    {
      slug: 'draft_followup_email',
      name: 'Draft Follow-up Email',
      description: 'Draft a capabilities follow-up email after a discovery call, incorporating relevant MetaCTO services and case studies.',
      category: 'mutation',
      requiresApproval: 'true',
      model: 'gpt-4o',
      temperature: '0.4',
      inputSchema: {
        type: 'object',
        properties: {
          discovery_summary: { type: 'string', description: 'The structured discovery summary' },
          prospect_name: { type: 'string', description: 'Prospect first name' },
          prospect_company: { type: 'string', description: 'Prospect company name' },
          sender_name: { type: 'string', description: 'Sender name (default: Chris)' },
        },
        required: ['discovery_summary', 'prospect_name'],
      },
      promptTemplate: `You are drafting a follow-up email for Chris Fitkin, CEO of MetaCTO, after a discovery call with a prospect. The tone should be professional but warm, concise, and action-oriented.

## Discovery Summary
{{discovery_summary}}

## Instructions
Write a follow-up email that:
1. Thanks {{prospect_name}} for their time
2. Briefly recaps the 2-3 key things discussed (show you listened)
3. Connects their needs to MetaCTO's capabilities — be specific, not generic
4. Mentions 1-2 relevant case studies or past work (reference real MetaCTO projects if the context mentions them)
5. Proposes a clear next step (e.g., send a proposal, schedule a deeper technical call, share relevant samples)
6. Keeps it under 250 words — busy executives don't read essays

## MetaCTO Capabilities (reference as relevant)
- AI strategy & implementation consulting
- Custom AI agent development (LLM-powered tools, RAG systems, chatbots)
- Claude/GPT integration and prompt engineering
- Enterprise context platforms (connecting business systems with AI)
- Mobile & web application development
- Technical team augmentation

## Format
Subject: [subject line]

[email body]

Best,
{{sender_name}}`,
    },
  ];

  for (const skill of skills) {
    const existing = await db.query.skillSchema.findFirst({
      where: eq(schema.skillSchema.slug, skill.slug),
    });

    if (existing) {
      console.log(`Skill "${skill.slug}" already exists (id: ${existing.id}), updating...`);
      await pool.query(
        'UPDATE skill SET prompt_template = $1, input_schema = $2, description = $3, model = $4, temperature = $5 WHERE id = $6',
        [skill.promptTemplate, JSON.stringify(skill.inputSchema), skill.description, skill.model, skill.temperature, existing.id],
      );
    } else {
      const [row] = await db.insert(schema.skillSchema).values({
        orgId: ORG_ID,
        ...skill,
      }).returning();
      console.log(`Created skill "${skill.slug}" (id: ${row!.id})`);
    }
  }

  console.log('\nDone! Skills are ready for execution.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

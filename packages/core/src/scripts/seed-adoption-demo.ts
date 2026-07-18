#!/usr/bin/env tsx
/**
 * Seed a demo org with members + 90 days of synthetic adoption activity so
 * the /dashboard/adoption surface can be exercised end-to-end.
 *
 * Personas (all password `demo123`):
 *   admin@acme.test    — admin, power user (daily, all agents)
 *   pat@acme.test      — member, power user
 *   alex@acme.test     — member, active (few times a week)
 *   casey@acme.test    — member, casual (weekly)
 *   drew@acme.test     — member, dormant (active early, quiet for 45+ days)
 *   nova@acme.test     — member, never adopted (zero events)
 *
 * Idempotent: users are get-or-created and every event is resource-anchored
 * with a deterministic seed id, so the partial unique index turns re-runs
 * into no-ops. Deterministic RNG (fixed seed) keeps the shape stable.
 *
 * Usage: npm run adoption:seed-demo
 */
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import {
  accountMembershipSchema,
  projectSchema,
  tenantAccountSchema,
  userActivityEventSchema,
  userSchema,
} from '@/models/Schema';

const ACCOUNT_SLUG = 'acme-demo';
const ACCOUNT_NAME = 'Acme Demo';
const PROJECT_SLUG = 'acme-revops';
const PROJECT_NAME = 'Acme RevOps';
const AGENTS = ['revenue-lead', 'pipeline-analyst', 'outreach-drafter'];
const DAYS = 90;

/** Deterministic RNG (mulberry32) so re-runs describe the same org. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Persona = {
  email: string;
  name: string;
  role: 'admin' | 'member';
  /** Probability this persona is active on a given day. */
  dailyChance: number;
  /** Only active before this many days ago (dormancy cut). */
  quietAfterDay?: number;
  intensity: number; // messages per session, roughly
  decides: boolean;
  learns: boolean;
};

const PERSONAS: Persona[] = [
  { email: 'admin@acme.test', name: 'Avery Admin', role: 'admin', dailyChance: 0.85, intensity: 6, decides: true, learns: true },
  { email: 'pat@acme.test', name: 'Pat Power', role: 'member', dailyChance: 0.75, intensity: 8, decides: true, learns: true },
  { email: 'alex@acme.test', name: 'Alex Active', role: 'member', dailyChance: 0.4, intensity: 4, decides: true, learns: false },
  { email: 'casey@acme.test', name: 'Casey Casual', role: 'member', dailyChance: 0.15, intensity: 2, decides: false, learns: false },
  { email: 'drew@acme.test', name: 'Drew Dormant', role: 'member', dailyChance: 0.5, quietAfterDay: 45, intensity: 3, decides: true, learns: false },
  { email: 'nova@acme.test', name: 'Nova Never', role: 'member', dailyChance: 0, intensity: 0, decides: false, learns: false },
];

type EventRow = typeof userActivityEventSchema.$inferInsert;

async function ensureOrg(): Promise<{ accountId: string; projectId: string }> {
  const [acct] = await db.select().from(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT_SLUG)).limit(1);
  const accountId = acct?.id ?? `acct-${randomUUID()}`;
  if (!acct) {
    await db.insert(tenantAccountSchema).values({ id: accountId, name: ACCOUNT_NAME, slug: ACCOUNT_SLUG });
  }
  const [proj] = await db.select().from(projectSchema).where(eq(projectSchema.slug, PROJECT_SLUG)).limit(1);
  const projectId = proj?.id ?? `proj-${randomUUID()}`;
  if (!proj) {
    await db.insert(projectSchema).values({ id: projectId, accountId, slug: PROJECT_SLUG, name: PROJECT_NAME });
  }
  return { accountId, projectId };
}

async function ensureUser(p: Persona, accountId: string, passwordHash: string): Promise<string> {
  const [existing] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, p.email)).limit(1);
  const userId = existing?.id ?? `usr-${randomUUID()}`;
  if (!existing) {
    await db.insert(userSchema).values({ id: userId, name: p.name, email: p.email, passwordHash });
  }
  const [membership] = await db
    .select({ userId: accountMembershipSchema.userId })
    .from(accountMembershipSchema)
    .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.userId, userId)))
    .limit(1);
  if (!membership) {
    await db.insert(accountMembershipSchema).values({ accountId, userId, role: p.role });
  }
  return userId;
}

async function main() {
  const { accountId, projectId } = await ensureOrg();
  const orgId = projectId; // org_id == projectId (auth.js back-compat convention)
  const passwordHash = await hashPassword('demo123');

  const events: EventRow[] = [];
  const lastSeen = new Map<string, { login: Date | null; active: Date | null }>();

  for (const [pi, persona] of PERSONAS.entries()) {
    const userId = await ensureUser(persona, accountId, passwordHash);
    const rand = rng(1000 + pi);
    let seq = 0;
    const seedResource = (kind: string): [string, string] => ['seed', `${persona.email}-${kind}-${seq++}`];

    for (let day = DAYS - 1; day >= 1; day--) {
      if (persona.quietAfterDay && day < persona.quietAfterDay) {
        continue;
      }
      if (rand() >= persona.dailyChance) {
        continue;
      }

      // 1-2 sessions this day, business-hours-ish start.
      const sessions = rand() < 0.3 ? 2 : 1;
      for (let s = 0; s < sessions; s++) {
        const start = new Date(Date.now() - day * 86_400_000);
        start.setHours(8 + Math.floor(rand() * 9), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
        let t = start.getTime();
        const push = (row: Omit<EventRow, 'orgId' | 'projectId' | 'userId' | 'createdAt'>, advanceMin: number) => {
          events.push({ orgId, projectId, userId, createdAt: new Date(t), ...row });
          t += Math.floor(advanceMin * 60_000 * (0.5 + rand()));
        };

        if (s === 0) {
          const loginAt = new Date(t);
          const prev = lastSeen.get(userId) ?? { login: null, active: null };
          lastSeen.set(userId, { login: maxDate(prev.login, loginAt), active: prev.active });
          push({ eventType: 'auth.login', resourceType: 'seed', resourceId: seedResource('login')[1] }, 1);
        }
        push({ eventType: 'activity.heartbeat', resourceType: 'seed', resourceId: seedResource('hb')[1] }, 5);

        const agent = AGENTS[Math.floor(rand() * AGENTS.length)]!;
        if (persona.intensity > 0 && rand() < 0.8) {
          push({ eventType: 'chat.conversation_created', agentSlug: agent, resourceType: 'seed', resourceId: seedResource('conv')[1] }, 2);
          const msgs = 1 + Math.floor(rand() * persona.intensity);
          for (let m = 0; m < msgs; m++) {
            push({ eventType: 'chat.message_sent', agentSlug: agent, resourceType: 'seed', resourceId: seedResource('msg')[1] }, 4);
          }
        }

        if (persona.decides && rand() < 0.5) {
          const kinds = ['skill', 'workflow', 'mission', 'action'] as const;
          const kind = kinds[Math.floor(rand() * kinds.length)]!;
          const decision = rand() < 0.8 ? 'approved' : 'rejected';
          push({
            eventType: 'review.decided',
            agentSlug: rand() < 0.6 ? agent : null,
            resourceType: 'seed',
            resourceId: seedResource('decide')[1],
            metadata: { kind, decision, latencyMs: Math.floor(rand() * 6 * 3_600_000) + 60_000 },
          }, 3);
        }
        if (persona.decides && rand() < 0.25) {
          push({
            eventType: 'review.feedback',
            agentSlug: rand() < 0.7 ? agent : null,
            resourceType: 'seed',
            resourceId: seedResource('fb')[1],
            metadata: { kind: 'skill', rating: rand() < 0.75 ? 'up' : 'down', hasNote: rand() < 0.3 },
          }, 2);
        }
        if (persona.learns && rand() < 0.2) {
          push({
            eventType: 'learning.added',
            agentSlug: agent,
            resourceType: 'seed',
            resourceId: seedResource('learn')[1],
          }, 2);
        }

        const prev = lastSeen.get(userId) ?? { login: null, active: null };
        lastSeen.set(userId, { login: prev.login, active: maxDate(prev.active, new Date(t)) });
      }
    }

    const seen = lastSeen.get(userId);
    if (seen && (seen.login || seen.active)) {
      await db
        .update(accountMembershipSchema)
        .set({
          ...(seen.login ? { lastLoginAt: seen.login } : {}),
          ...(seen.active ? { lastActiveAt: seen.active } : {}),
        })
        .where(and(eq(accountMembershipSchema.accountId, accountId), eq(accountMembershipSchema.userId, userId)));
    }
  }

  let inserted = 0;
  for (let i = 0; i < events.length; i += 500) {
    const chunk = events.slice(i, i + 500);
    const res = await db.insert(userActivityEventSchema).values(chunk).onConflictDoNothing().returning({ id: userActivityEventSchema.id });
    inserted += res.length;
  }

  console.log(`✓ Seeded adoption demo:`);
  console.log(`  account: ${accountId} (${ACCOUNT_NAME})`);
  console.log(`  project: ${projectId} (${PROJECT_SLUG})  ← org scope`);
  console.log(`  users:   ${PERSONAS.map(p => p.email).join(', ')} (password: demo123)`);
  console.log(`  events:  ${inserted} inserted (${events.length - inserted} already present)`);
  process.exit(0);
}

function maxDate(a: Date | null, b: Date): Date {
  return a && a > b ? a : b;
}

main().catch((err) => {
  console.error('Adoption demo seed failed:', err);
  process.exit(1);
});

/**
 * THE PRACTICE ROUTINE: an automation already taught and approved on the practice
 * console (`services/browser/practiceConsole.ts`) — add a person as a user if
 * they are not one, then enroll them in a campaign — with the console's
 * roster to run it for. So a batch, its escalations, its reconciliation and
 * its report can be shown and tested on any installation without a recording
 * or anyone's real system. It is the spec the Routine analyst writes from a
 * recording of that task.
 */

import type { RoutineSpec } from '@/libs/routines/types';
import { PRACTICE_CONSOLE_ORIGIN, PRACTICE_CONSOLE_ROSTER, PRACTICE_CONSOLE_ROSTER_CAMPAIGN, PRACTICE_CONSOLE_SIGN_IN } from '@/services/browser/practiceConsole';

export const PRACTICE_ROUTINE_NAME = 'Add a user and enroll them (practice)';

export const PRACTICE_ROUTINE_SPEC: RoutineSpec = {
  summary: 'For one person on the roster, find them in Larkfield Logistics\' training console by email, add them as a user if they are not one, and enroll them in the campaign. Possible duplicates and people already enrolled go to the expert.',
  startUrl: `${PRACTICE_CONSOLE_ORIGIN}/users`,
  systems: [new URL(PRACTICE_CONSOLE_ORIGIN).host],
  inputs: [
    { name: 'sign_in_email', description: 'The console admin account to sign in with', example: PRACTICE_CONSOLE_SIGN_IN.email, shared: true },
    { name: 'password', description: 'Its password', secret: true, shared: true },
    { name: 'campaign', description: 'The campaign to enroll everyone in', example: PRACTICE_CONSOLE_ROSTER_CAMPAIGN.name, shared: true },
    { name: 'first_name', description: 'The person\'s first name', example: 'Aisha' },
    { name: 'last_name', description: 'The person\'s last name', example: 'Karim' },
    { name: 'email', description: 'Their work email: who they are in the console', example: 'aisha.karim@larkfield.example', key: true },
    { name: 'department', description: 'Their department', example: 'Finance' },
    { name: 'role', description: 'Their role in the console', example: 'Learner' },
  ],
  outputs: [
    { name: 'user_id', description: 'Their User ID as their user page shows it (e.g. USR-1045)', checks: null },
    { name: 'saved_email', description: 'The Email on their user page', checks: 'email' },
    { name: 'enrolled_campaign', description: 'The campaign their user page lists them in, by name', checks: 'campaign' },
  ],
  preconditions: ['The campaign exists and is Active or Scheduled.'],
  steps: [
    { n: 1, text: 'Sign in with the account given if the console asks, and close the What\'s new dialog with Got it.', why: 'The console opens on sign-in; the dialog is in the way.', at: 4 },
    { n: 2, text: 'On Users, search for the person\'s email.', why: 'Email is who someone is in the console.', at: 14 },
    { n: 3, text: 'If nobody has that email, search their full name too.', why: 'A person may already be here under another email.', at: 24 },
    { n: 4, text: 'If nobody has that email or that name: Add user, fill First name, Last name, Email, Department and Role, leave Send welcome email unchecked, and press Add user.', why: 'The welcome email goes out when the campaign starts, not now.', at: 33 },
    { n: 5, text: 'On their user page, check Enrollments. If they are not in the campaign: Enroll in campaign, give their email, choose the campaign, and press Enroll.', why: 'Enrolling from their page keeps it to one person at a time.', at: 58 },
    { n: 6, text: 'Back on their user page, read the User ID, the Email and the Enrollments.', why: 'The page is the proof the change was saved.', at: 80 },
  ],
  rules: [
    { text: 'Look a person up by email before adding them; never create a second user for the same person.', at: 16 },
    { text: 'Never tick Send welcome email.', at: 40 },
    { text: 'Never enroll someone again who is already in the campaign: it resets their progress.', at: 64 },
    { text: 'Only add and enroll. Never deactivate, delete or edit anyone.', at: 88 },
  ],
  escalations: [
    { when: 'A user has the same name but a different email', ask: 'Is this the same person (enroll the existing user) or someone else (add a new user)?', at: 26 },
    { when: 'The person is already enrolled in the campaign', ask: 'Leave them as they are, or re-enroll them and reset their progress?', at: 66 },
    { when: 'Their user is Deactivated', ask: 'Reactivate them and enroll, or skip them?', at: 70 },
  ],
  prohibited: ['Deactivate or delete a user', 'Send a welcome email', 'Edit an existing user\'s details', 'Enroll anyone not in the inputs'],
  postconditions: ['Exactly one user has the person\'s email', 'Their user page lists the campaign'],
  writes: [{ button: 'Add user', host: null }, { button: 'Enroll', host: null }],
  reconcile: { listUrl: `${PRACTICE_CONSOLE_ORIGIN}/users`, how: 'Open Users with the search empty and read the whole table: Name, Email and Status of every user.', matchOn: 'email' },
  questions: [
    { id: 'q1', question: 'When someone on the list matches a user by name but not by email, what should it do?', why: 'One example cannot show whether that is the same person.', at: 26, answer: 'Ask me. It is often the same person under an old email.', answeredBy: null },
    { id: 'q2', question: 'Should it ever re-enroll someone who is already enrolled?', why: 'Re-enrolling resets progress.', at: 66, answer: 'No. Ask me; usually leave them as they are.', answeredBy: null },
  ],
  manualMinutes: 3,
};

/** The roster to run it for, and what every row shares. */
export function practiceRoutineBatch(): { rows: Array<Record<string, string>>; shared: Record<string, string> } {
  return {
    rows: PRACTICE_CONSOLE_ROSTER.map(r => ({ ...r })),
    shared: { sign_in_email: PRACTICE_CONSOLE_SIGN_IN.email, password: PRACTICE_CONSOLE_SIGN_IN.password, campaign: PRACTICE_CONSOLE_ROSTER_CAMPAIGN.name },
  };
}

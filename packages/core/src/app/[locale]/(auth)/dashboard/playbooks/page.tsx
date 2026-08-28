import { redirect } from 'next/navigation';

/**
 * Playbooks folded into Skills — one catalog for both kinds of SKILL.md
 * folder, with provenance (base | override | workspace) per row.
 */
export default function PlaybooksPage() {
  redirect('/dashboard/skills');
}

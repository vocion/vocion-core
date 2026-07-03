import { redirect } from 'next/navigation';

/**
 * Teams merged into Agents — one roster, presented as teams where the
 * workspace defines them. Kept as a redirect so old links + muscle
 * memory keep working.
 */
export default function TeamsRedirect() {
  redirect('/dashboard/agents');
}

import { redirect } from 'next/navigation';
import { workspaceHome } from '@/libs/workspace/home';

export default function DashboardPage() {
  // The workspace's own front door when it names one (`defaults.home`), Chat otherwise.
  redirect(workspaceHome() ?? '/dashboard/chat');
}

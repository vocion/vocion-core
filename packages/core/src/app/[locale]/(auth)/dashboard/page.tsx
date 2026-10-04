import { redirect } from 'next/navigation';
import { DASHBOARD_HOME } from '@/libs/links';

export default function DashboardPage() {
  redirect(DASHBOARD_HOME);
}

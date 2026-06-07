import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import WorkflowsClient from './WorkflowsClient';
import type { Workflow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase.from('workflows').select('*').eq('user_id', user.id).order('last_used_at', { ascending: false });
  return <WorkflowsClient workflows={(data ?? []) as Workflow[]} />;
}

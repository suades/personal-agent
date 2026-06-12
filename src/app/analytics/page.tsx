import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import AnalyticsClient from './AnalyticsClient';
import type { LLMCall } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('llm_calls')
    .select('*')
    .gte('created_at', since)
    .order('created_at');

  return <AnalyticsClient calls={(data ?? []) as LLMCall[]} />;
}

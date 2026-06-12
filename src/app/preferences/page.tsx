import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import PreferencesClient from './PreferencesClient';
import type { Preference } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PreferencesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return <PreferencesClient initial={(data ?? []) as Preference[]} userId={user.id} />;
}

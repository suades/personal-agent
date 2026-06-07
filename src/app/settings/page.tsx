import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: connectors } = await supabase.from('connectors').select('*').eq('user_id', user.id);
  return <SettingsClient connectors={connectors ?? []} />;
}

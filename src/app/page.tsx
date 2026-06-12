import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { ALLOWED_EMAIL } from '@/lib/constants';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // ── Server-side auth guard: even if someone bypasses the login page,
  //    they can't see the dashboard unless they're the allowed user. ──
  if ((user.email ?? '').toLowerCase() !== ALLOWED_EMAIL) {
    await supabase.auth.signOut();
    redirect('/login');
  }

  return <Dashboard userId={user.id} userEmail={user.email ?? ''} />;
}

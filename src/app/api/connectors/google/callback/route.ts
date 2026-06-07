import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const [userId, scope] = state.split(':');
  if (!code || !userId) return NextResponse.redirect(new URL('/settings?error=oauth', request.url));

  const redirectUri = new URL('/api/connectors/google/callback', request.url).toString();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(text)}`, request.url));
  }
  const tokens = await res.json();

  const supabase = supabaseAdmin();
  const connectorName = scope === 'calendar' ? 'calendar' : 'gmail';
  await supabase.from('connectors').upsert(
    {
      user_id: userId,
      name: connectorName,
      status: 'connected',
      config: { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expiry: Date.now() + (tokens.expires_in ?? 3600) * 1000 },
    },
    { onConflict: 'user_id,name' }
  );

  return NextResponse.redirect(new URL('/settings?ok=1', request.url));
}

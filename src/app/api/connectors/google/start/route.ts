import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

const SCOPES: Record<string, string[]> = {
  gmail:    ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
};

export async function GET(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') ?? 'gmail';
  const scopes = SCOPES[scope] ?? SCOPES.gmail;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: 'GOOGLE_CLIENT_ID not configured. See SETUP.md.' }, { status: 500 });

  const redirectUri = new URL('/api/connectors/google/callback', request.url).toString();
  const state = `${user.id}:${scope}`;

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('prompt', 'consent');
  auth.searchParams.set('scope', scopes.join(' '));
  auth.searchParams.set('state', state);

  return NextResponse.redirect(auth.toString());
}

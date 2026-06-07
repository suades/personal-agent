import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from('tasks').delete()
    .lt('expires_at', new Date().toISOString())
    .eq('status', 'done')
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: data?.length ?? 0 });
}

export const POST = GET;

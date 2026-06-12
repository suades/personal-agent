import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { parseNaturalTask } from '@/lib/agent/nlu';
import { setLLMUser } from '@/lib/agent/llm';
import { ALLOWED_EMAIL } from '@/lib/constants';

export const runtime = 'nodejs';

/**
 * POST /api/tasks/parse  { text: string }
 * → { title, description, priority }
 *
 * Parses freeform task input ("cheap flight to Miami next month — urgent")
 * into structured fields. The client inserts the task itself, so RLS applies.
 */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== ALLOWED_EMAIL) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let text: string;
  try {
    const body = await request.json();
    text = String(body.text ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  try {
    setLLMUser(user.id);
    const parsed = await parseNaturalTask(text.slice(0, 2000));
    return NextResponse.json(parsed);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    setLLMUser(null);
  }
}

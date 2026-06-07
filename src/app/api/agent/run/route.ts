import { NextResponse } from 'next/server';
import { runAgentForUser } from '@/lib/agent/orchestrator';
import { supabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes — Vercel Pro allows more

/**
 * POST /api/agent/run
 *
 * Triggered by:
 *   - Vercel Cron (vercel.json), authenticated via `Authorization: Bearer ${CRON_SECRET}`
 *   - Manual "Run now" button (dev only)
 *
 * Runs the agent for every user with queued tasks.
 */
export async function GET(request: Request) {
  // Vercel cron sends a special header; in dev/manual we accept CRON_SECRET
  const auth = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  const vercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!vercelCron && (!process.env.CRON_SECRET || auth !== expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data: users } = await supabase
    .from('tasks')
    .select('user_id')
    .eq('status', 'queued');

  const userIds = Array.from(new Set((users ?? []).map(u => u.user_id).filter(Boolean))) as string[];

  const results = [];
  for (const userId of userIds) {
    try {
      const r = await runAgentForUser(userId);
      results.push({ userId, ...r });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}

export const POST = GET;

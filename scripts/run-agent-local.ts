/**
 * Run the night agent locally for testing.
 * Usage: npm run agent:run
 *
 * This loads .env.local, finds all users with queued tasks, and runs the agent for each.
 */
// Load .env.local BEFORE importing anything that reads env vars
import * as fs from 'node:fs';
if (fs.existsSync('.env.local')) {
  const content = fs.readFileSync('.env.local', 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

import { runAgentForUser } from '../src/lib/agent/orchestrator';
import { supabaseAdmin } from '../src/lib/supabase/server';

async function main() {

  const supabase = supabaseAdmin();
  const { data } = await supabase.from('tasks').select('user_id').eq('status', 'queued');
  const userIds = Array.from(new Set((data ?? []).map((u) => u.user_id).filter(Boolean))) as string[];

  if (userIds.length === 0) { console.log('No queued tasks.'); return; }
  for (const uid of userIds) {
    console.log(`\nRunning agent for user ${uid}...`);
    const r = await runAgentForUser(uid);
    console.log(`  → completed=${r.completed} paused=${r.paused} failed=${r.failed}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

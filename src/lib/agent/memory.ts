/**
 * Agent memory & preferences (Feature 13).
 * After each completed task, the LLM extracts durable user preferences
 * ("prefers Amazon over eBay", "ML notes live in ~/Desktop/ML") into the
 * preferences table. Before planning, the top preferences are injected into
 * the system prompt so the agent personalizes over time.
 */
import { supabaseAdmin } from '@/lib/supabase/server';
import { llmJson, type LLMMessage } from './llm';
import type { Task, AgentStep } from '@/lib/types';

const MAX_PROMPT_PREFS = 20;

/** Formatted block for the planner / recovery prompts. Empty string if none. */
export async function getPreferencesBlock(userId: string): Promise<string> {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('preferences')
    .select('key, value')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(MAX_PROMPT_PREFS);

  if (!data || data.length === 0) return '';
  return '\n\nKNOWN USER PREFERENCES (apply these when relevant):\n' +
    data.map(p => `- ${p.key}: ${p.value}`).join('\n');
}

/**
 * Extract any preferences this task revealed (explicit or implicit) and upsert.
 * Failures are swallowed — memory must never break task completion.
 */
export async function extractPreferences(userId: string, task: Task, agentSteps: AgentStep[]) {
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You extract durable user preferences from a completed task — facts worth remembering for ALL ' +
        'future tasks, like preferred websites/vendors, folder locations, formats, tone, recurring contacts. ' +
        'Output strict JSON: {"preferences": [{"key": "short_snake_case", "value": "the preference"}]}.\n' +
        'Output {"preferences": []} unless something is clearly reusable. NEVER store one-off details ' +
        '(a specific flight date, a single search query) or secrets/passwords.' },
    { role: 'user', content: JSON.stringify({
        task: { title: task.title, description: task.description },
        steps: agentSteps.map(s => ({ action: s.action, args: s.args, ok: s.ok })),
      }) },
  ];
  try {
    const out = await llmJson<{ preferences: { key: string; value: string }[] }>(msgs, { purpose: 'memory' });
    const prefs = (out.preferences ?? []).filter(p => p.key && p.value).slice(0, 5);
    if (prefs.length === 0) return;

    const supabase = supabaseAdmin();
    for (const p of prefs) {
      await supabase.from('preferences').upsert({
        user_id: userId,
        key: p.key.slice(0, 100),
        value: p.value.slice(0, 500),
        source_task_id: task.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,key' });
    }
  } catch (e) {
    console.warn('[memory] preference extraction skipped:', (e as Error).message.slice(0, 120));
  }
}

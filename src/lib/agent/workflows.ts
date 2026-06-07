import { supabaseAdmin } from '@/lib/supabase/server';
import { llmJson, type LLMMessage } from './llm';
import type { Workflow, WorkflowStep, Task } from '@/lib/types';

/**
 * Find the best matching saved workflow for a task, if any.
 * Strategy:
 *   1. Pull all the user's workflows (small list — single-user app).
 *   2. Score by trigger_keyword matches against the task title + description.
 *   3. If top score > threshold, ask the LLM to confirm relevance and extract params.
 */
export async function findMatchingWorkflow(userId: string, task: Task): Promise<{
  workflow: Workflow;
  parameters: Record<string, string>;
} | null> {
  const supabase = supabaseAdmin();
  const { data } = await supabase.from('workflows').select('*').eq('user_id', userId);
  const workflows = (data ?? []) as Workflow[];
  if (workflows.length === 0) return null;

  const text = (task.title + ' ' + (task.description ?? '')).toLowerCase();

  let best: { wf: Workflow; score: number } | null = null;
  for (const wf of workflows) {
    const score = wf.trigger_keywords.reduce((acc, kw) => acc + (text.includes(kw.toLowerCase()) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { wf, score };
  }
  if (!best) return null;

  // LLM confirmation + parameter extraction
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You decide whether a saved workflow applies to a new task and extract parameters. ' +
        'Respond ONLY with JSON: {"applies": boolean, "parameters": {...} or {} }.' },
    { role: 'user', content: JSON.stringify({
        task: { title: task.title, description: task.description },
        workflow: { name: best.wf.name, description: best.wf.description, parameters: best.wf.parameters, steps: best.wf.steps },
      }) },
  ];
  try {
    const out = await llmJson<{ applies: boolean; parameters: Record<string, string> }>(msgs);
    if (!out.applies) return null;
    return { workflow: best.wf, parameters: out.parameters ?? {} };
  } catch { return null; }
}

/**
 * After a task succeeds, ask the LLM whether the strategy is reusable
 * (i.e. a workflow worth saving). If yes, save it.
 */
export async function maybeSaveWorkflow(userId: string, task: Task, executedSteps: WorkflowStep[]) {
  if (executedSteps.length === 0) return;

  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You decide whether a sequence of steps just executed is generalizable into a reusable workflow ' +
        'this user will want again. If so, output JSON: ' +
        '{"save": true, "name": "snake_case_name", "description": "...", ' +
        '"trigger_keywords": ["..."], "parameters": {"param": "string"}, "steps": [...]}. ' +
        'If not, output {"save": false}. Strip user-specific values from steps and replace them with {{parameter}} placeholders.' },
    { role: 'user', content: JSON.stringify({
        task: { title: task.title, description: task.description },
        executedSteps,
      }) },
  ];
  try {
    const out = await llmJson<{
      save: boolean; name?: string; description?: string;
      trigger_keywords?: string[]; parameters?: Record<string, string>; steps?: WorkflowStep[];
    }>(msgs);
    if (!out.save || !out.name || !out.steps) return;

    const supabase = supabaseAdmin();

    // upsert by name — if user has one with same name, version it
    const { data: existing } = await supabase.from('workflows').select('id').eq('user_id', userId).eq('name', out.name).maybeSingle();
    if (existing) {
      await supabase.from('workflows').update({
        description: out.description ?? null,
        trigger_keywords: out.trigger_keywords ?? [],
        parameters: out.parameters ?? {},
        steps: out.steps,
        last_used_at: new Date().toISOString(),
        use_count: 1,
      }).eq('id', existing.id);
    } else {
      await supabase.from('workflows').insert({
        user_id: userId,
        name: out.name,
        description: out.description ?? null,
        trigger_keywords: out.trigger_keywords ?? [],
        parameters: out.parameters ?? {},
        steps: out.steps,
      });
    }
  } catch (e) {
    console.warn('[workflow-save] skipped:', (e as Error).message);
  }
}

export async function bumpWorkflowUsage(workflowId: string) {
  const supabase = supabaseAdmin();
  const { data } = await supabase.from('workflows').select('use_count').eq('id', workflowId).single();
  await supabase.from('workflows').update({
    use_count: ((data?.use_count as number) ?? 0) + 1,
    last_used_at: new Date().toISOString(),
  }).eq('id', workflowId);
}

import { supabaseAdmin } from '@/lib/supabase/server';
import { llmJson, type LLMMessage } from './llm';
import { embedText, embeddingsAvailable, cosineSim } from './embeddings';
import type { Workflow, WorkflowStep, Task } from '@/lib/types';

/** Minimum cosine similarity for a semantic workflow match. */
const SEMANTIC_THRESHOLD = 0.75;

/** Text representation of a workflow used for embedding. */
function workflowText(wf: Workflow): string {
  return `${wf.name.replace(/_/g, ' ')}. ${wf.description ?? ''} Keywords: ${wf.trigger_keywords.join(', ')}`;
}

/**
 * Find the best matching saved workflow for a task, if any.
 * Strategy:
 *   1. SEMANTIC (if GEMINI_API_KEY / JINA_API_KEY set): embed the task text and
 *      compare against stored workflow embeddings (computed lazily and persisted).
 *      "Make study cards" matches "create flashcards" this way.
 *   2. KEYWORD fallback: score by trigger_keyword overlap with title + description.
 *   3. Either way, the LLM confirms relevance + extracts parameters, and rejects
 *      workflows that violate past negative feedback.
 */
export async function findMatchingWorkflow(userId: string, task: Task, feedbackStr: string): Promise<{
  workflow: Workflow;
  parameters: Record<string, string>;
} | null> {
  const supabase = supabaseAdmin();
  const { data } = await supabase.from('workflows').select('*').eq('user_id', userId);
  const workflows = (data ?? []) as Workflow[];
  if (workflows.length === 0) return null;

  const text = task.title + ' ' + (task.description ?? '');
  let best: Workflow | null = null;

  if (embeddingsAvailable()) {
    best = await bestSemanticMatch(text, workflows);
  }
  if (!best) {
    best = bestKeywordMatch(text.toLowerCase(), workflows);
  }
  if (!best) return null;

  // LLM confirmation + parameter extraction
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You decide whether a saved workflow applies to a new task and extract parameters. ' +
        'Respond ONLY with JSON: {"applies": boolean, "parameters": {...} or {} }. ' +
        'If the workflow violates any of the user\'s past negative feedback, output {"applies": false}.\n' +
        feedbackStr },
    { role: 'user', content: JSON.stringify({
        task: { title: task.title, description: task.description },
        workflow: { name: best.name, description: best.description, parameters: best.parameters, steps: best.steps },
      }) },
  ];
  try {
    const out = await llmJson<{ applies: boolean; parameters: Record<string, string> }>(msgs, { purpose: 'workflow' });
    if (!out.applies) return null;
    return { workflow: best, parameters: out.parameters ?? {} };
  } catch { return null; }
}

function bestKeywordMatch(textLc: string, workflows: Workflow[]): Workflow | null {
  let best: { wf: Workflow; score: number } | null = null;
  for (const wf of workflows) {
    const score = wf.trigger_keywords.reduce((acc, kw) => acc + (textLc.includes(kw.toLowerCase()) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { wf, score };
  }
  return best?.wf ?? null;
}

async function bestSemanticMatch(taskText: string, workflows: Workflow[]): Promise<Workflow | null> {
  const taskVec = await embedText(taskText);
  if (!taskVec) return null;

  const supabase = supabaseAdmin();
  let best: { wf: Workflow; sim: number } | null = null;

  for (const wf of workflows) {
    let vec = wf.embedding ?? null;
    if (!vec) {
      // Lazily embed workflows saved before this feature existed (or by a
      // session without an embedding key) and persist for next time.
      vec = await embedText(workflowText(wf));
      if (vec) await supabase.from('workflows').update({ embedding: vec }).eq('id', wf.id);
    }
    if (!vec) continue;
    const sim = cosineSim(taskVec, vec);
    if (sim >= SEMANTIC_THRESHOLD && (!best || sim > best.sim)) best = { wf, sim };
  }
  return best?.wf ?? null;
}

/**
 * After a task succeeds, ask the LLM whether the strategy is reusable
 * (i.e. a workflow worth saving). If yes, save it (with its embedding).
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
    }>(msgs, { purpose: 'workflow' });
    if (!out.save || !out.name || !out.steps) return;

    const supabase = supabaseAdmin();

    const embedding = await embedText(
      `${out.name.replace(/_/g, ' ')}. ${out.description ?? ''} Keywords: ${(out.trigger_keywords ?? []).join(', ')}`
    );

    // upsert by name — if user has one with same name, version it
    const { data: existing } = await supabase.from('workflows').select('id').eq('user_id', userId).eq('name', out.name).maybeSingle();
    if (existing) {
      await supabase.from('workflows').update({
        description: out.description ?? null,
        trigger_keywords: out.trigger_keywords ?? [],
        parameters: out.parameters ?? {},
        steps: out.steps,
        embedding,
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
        embedding,
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

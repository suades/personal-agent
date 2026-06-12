/**
 * Natural-language task input (Feature 12).
 * Turns freeform text like "Find me a cheap flight to Miami next month — high priority"
 * into structured task fields.
 */
import { llmJson, type LLMMessage } from './llm';
import type { Priority } from '@/lib/types';

export interface ParsedTask {
  title: string;
  description: string | null;
  priority: Priority;
}

export async function parseNaturalTask(text: string): Promise<ParsedTask> {
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You convert a freeform task request into structured fields for a task agent. ' +
        'Output strict JSON: {"title": "...", "description": "..." or null, "priority": "high"|"medium"|"low"}.\n' +
        'Rules:\n' +
        '- title: short imperative phrase (max ~10 words) capturing the core action.\n' +
        '- description: every remaining detail, constraint, deadline, or context the agent will need. ' +
        'null if the title already says everything.\n' +
        '- priority: explicit if the user states one ("urgent", "high priority", "whenever"); ' +
        'otherwise infer from urgency words and deadlines; default "medium".' },
    { role: 'user', content: text },
  ];
  const out = await llmJson<ParsedTask>(msgs, { purpose: 'nlu' });

  const priority: Priority = (['high', 'medium', 'low'] as const).includes(out.priority as Priority)
    ? out.priority : 'medium';
  return {
    title: (out.title || text).slice(0, 200).trim(),
    description: out.description?.trim() || null,
    priority,
  };
}

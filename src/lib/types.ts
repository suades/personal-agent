export type Priority = 'high' | 'medium' | 'low';
export type Status = 'queued' | 'needs_confirmation' | 'done' | 'skipped';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  status: Status;
  agent_note: string | null;
  confirmation_prompt: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  sort_index: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  trigger_keywords: string[];
  parameters: Record<string, string>;
  steps: WorkflowStep[];
  use_count: number;
  last_used_at: string | null;
}

export interface WorkflowStep {
  tool: string; // 'browser' | 'gmail' | 'search' | 'files' | 'format'
  action: string;
  args: Record<string, unknown>;
  notes?: string;
}

export interface Connector {
  id: string;
  name: string;
  status: 'connected' | 'needs_setup';
  config: Record<string, unknown> | null;
}

export interface AgentRun {
  id: string;
  started_at: string;
  ended_at: string | null;
  tasks_completed: number;
  tasks_paused: number;
  log: string | null;
  success?: boolean;
  tasks_failed?: number;
}

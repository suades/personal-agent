export type Priority = 'high' | 'medium' | 'low';
export type Status = 'queued' | 'in_progress' | 'needs_confirmation' | 'done' | 'skipped';

/** One step the agent executed, stored in tasks.agent_steps JSON array. */
export interface AgentStep {
  action: string;           // e.g. "browser.goto", "search.query", "agent.replan"
  args: Record<string, unknown>;
  ok: boolean;
  output_snippet?: string;  // first ~400 chars of output (for display)
  url?: string;             // page URL captured after this step (browser steps only)
  screenshot_url?: string;  // public Supabase Storage URL (browser steps only)
  error?: string;
  recovered?: boolean;      // true on agent.replan markers — the self-healing loop kicked in
  note?: string;            // human-readable annotation (e.g. recovery reasoning)
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  status: Status;
  agent_note: string | null;
  agent_steps: AgentStep[] | null;   // structured step-by-step log
  confirmation_prompt: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  sort_index: number;
  rating: number | null;             // 1 = 👍, -1 = 👎
  user_feedback: string | null;      // written feedback on thumbs-down
  parent_task_id: string | null;     // set on subtasks created by decomposition
  agent_confidence: number | null;   // 0-100, set at planning time
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
  embedding?: number[] | null;       // semantic matching vector (JSONB in DB)
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

/** One entry in agent_runs.live_log — streamed to the dashboard in real time. */
export interface LiveLogEntry {
  ts: string;                        // ISO timestamp
  type: 'planning' | 'tool_call' | 'result' | 'error' | 'info';
  message: string;
  task_id?: string;
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
  status?: 'running' | 'completed' | 'failed';
  live_log?: LiveLogEntry[];
}

/** One row per LLM API call — powers the /analytics page. */
export interface LLMCall {
  id: string;
  provider: string;
  model: string;
  purpose: string | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_usd: number;
  ok: boolean;
  created_at: string;
}

/** A learned user preference ("prefers Amazon over eBay"). */
export interface Preference {
  id: string;
  key: string;
  value: string;
  source_task_id: string | null;
  created_at: string;
  updated_at: string;
}

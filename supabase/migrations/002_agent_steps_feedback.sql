-- ============================================================
--  002: Add agent_steps (structured execution log) and user_feedback
-- ============================================================

-- Structured JSON array of each step the agent executed, including URLs visited.
-- Format: [{ action, args, ok, output_snippet?, url?, error? }]
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_steps JSONB;

-- Free-text feedback the user writes when they thumbs-down a completed task.
-- Used by the planner to avoid repeating mistakes on similar tasks.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_feedback TEXT;

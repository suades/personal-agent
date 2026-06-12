-- ============================================================
--  003: Batch 2 — agent intelligence features
--  F1 streaming · F4 decomposition · F7 LLM tracking ·
--  F9 confidence · F10 semantic workflows · F13 memory · F15 screenshots
-- ============================================================

-- ---------- F1: real-time agent streaming ----------
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('running', 'completed', 'failed'));
-- Array of { ts, type: 'planning'|'tool_call'|'result'|'error'|'info', message, task_id? }
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS live_log JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------- F4: task decomposition ----------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks (parent_task_id);

-- Parents sit in 'in_progress' while their subtasks execute.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('queued', 'in_progress', 'needs_confirmation', 'done', 'skipped'));

-- ---------- F9: confidence scoring ----------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_confidence INT;

-- ---------- F7: LLM observability ----------
CREATE TABLE IF NOT EXISTS llm_calls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  purpose     TEXT,                       -- plan | summarize | recovery | nlu | memory | workflow | decompose
  tokens_in   INT NOT NULL DEFAULT 0,
  tokens_out  INT NOT NULL DEFAULT 0,
  latency_ms  INT NOT NULL DEFAULT 0,
  cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,
  ok          BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_calls_created_idx ON llm_calls (created_at);
CREATE INDEX IF NOT EXISTS llm_calls_user_idx ON llm_calls (user_id);

ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_calls_own ON llm_calls FOR SELECT USING (user_id = auth.uid());
-- inserts happen via service role only (bypasses RLS)

-- ---------- F13: agent memory & preferences ----------
CREATE TABLE IF NOT EXISTS preferences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  value          TEXT NOT NULL,
  source_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY preferences_own ON preferences FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------- F10: semantic workflow matching ----------
-- Embedding stored as a JSON number[] — no pgvector needed; cosine similarity is
-- computed in JS over the user's (small) workflow list.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS embedding JSONB;

-- ---------- F15: browser screenshots ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

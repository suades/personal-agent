-- ============================================================
--  ToDo Agent — complete database schema
--  Paste this whole file into the Supabase SQL editor and Run.
--  It is idempotent: safe to run more than once.
--
--  Creates: tasks, agent_runs, connectors, workflows, llm_calls,
--  preferences + row-level security, the done-task expiry trigger,
--  and the public screenshots storage bucket.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- tasks ----------
CREATE TABLE IF NOT EXISTS tasks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  priority             TEXT NOT NULL DEFAULT 'medium'
                         CHECK (priority IN ('high', 'medium', 'low')),
  status               TEXT NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'in_progress', 'needs_confirmation', 'done', 'skipped')),
  agent_note           TEXT,            -- plain-English report of what the agent did
  agent_steps          JSONB,           -- [{ action, args, ok, output_snippet?, url?, screenshot_url?, error?, recovered? }]
  confirmation_prompt  TEXT,            -- shown in the Needs You tab (why the agent paused)
  user_feedback        TEXT,            -- written feedback when the user thumbs-down
  parent_task_id       UUID REFERENCES tasks(id) ON DELETE CASCADE,  -- set on subtasks from decomposition
  agent_confidence     INT,             -- 0-100, recorded at planning time
  sort_index           INT  NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  rating               SMALLINT,        -- 1 = up, -1 = down
  approval_needed_flag BOOLEAN          -- user flagged that confirmation was unnecessary
);

CREATE INDEX IF NOT EXISTS tasks_status_idx  ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_expires_idx ON tasks (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_user_idx    ON tasks (user_id);
CREATE INDEX IF NOT EXISTS tasks_parent_idx  ON tasks (parent_task_id);

-- ---------- agent_runs ----------
CREATE TABLE IF NOT EXISTS agent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  tasks_completed INT NOT NULL DEFAULT 0,
  tasks_paused    INT NOT NULL DEFAULT 0,
  tasks_failed    INT NOT NULL DEFAULT 0,
  log             TEXT,
  success         BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('running', 'completed', 'failed')),
  live_log        JSONB NOT NULL DEFAULT '[]'::jsonb  -- [{ ts, type, message, task_id? }]
);

-- ---------- connectors ----------
CREATE TABLE IF NOT EXISTS connectors (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,                  -- 'gmail', 'calendar', ...
  status    TEXT NOT NULL CHECK (status IN ('connected', 'needs_setup')),
  config    JSONB,                          -- { access_token, refresh_token, expiry }
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- ---------- workflows (learned procedures) ----------
CREATE TABLE IF NOT EXISTS workflows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  trigger_keywords TEXT[] NOT NULL DEFAULT '{}',
  parameters       JSONB NOT NULL DEFAULT '{}',
  steps            JSONB NOT NULL,
  embedding        JSONB,                   -- number[] for semantic matching (cosine in JS)
  use_count        INT NOT NULL DEFAULT 0,
  last_used_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflows_keywords_idx ON workflows USING GIN (trigger_keywords);

-- ---------- llm_calls (observability / analytics) ----------
CREATE TABLE IF NOT EXISTS llm_calls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  purpose     TEXT,                         -- plan | summarize | recovery | nlu | memory | workflow | decompose
  tokens_in   INT NOT NULL DEFAULT 0,
  tokens_out  INT NOT NULL DEFAULT 0,
  latency_ms  INT NOT NULL DEFAULT 0,
  cost_usd    NUMERIC(10, 6) NOT NULL DEFAULT 0,
  ok          BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_calls_created_idx ON llm_calls (created_at);
CREATE INDEX IF NOT EXISTS llm_calls_user_idx    ON llm_calls (user_id);

-- ---------- preferences (agent memory) ----------
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

-- ============================================================
--  Row-Level Security — each user sees only their own rows.
--  The agent uses the service-role key, which bypasses RLS.
-- ============================================================

ALTER TABLE tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows   ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_calls   ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_own       ON tasks;
DROP POLICY IF EXISTS runs_own        ON agent_runs;
DROP POLICY IF EXISTS connectors_own  ON connectors;
DROP POLICY IF EXISTS workflows_own   ON workflows;
DROP POLICY IF EXISTS llm_calls_own   ON llm_calls;
DROP POLICY IF EXISTS preferences_own ON preferences;

CREATE POLICY tasks_own       ON tasks       FOR ALL    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY runs_own        ON agent_runs  FOR ALL    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY connectors_own  ON connectors  FOR ALL    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY workflows_own   ON workflows   FOR ALL    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY preferences_own ON preferences FOR ALL    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- llm_calls are written by the agent (service role) and only read in the UI.
CREATE POLICY llm_calls_own   ON llm_calls   FOR SELECT USING (user_id = auth.uid());

-- ============================================================
--  Auto-expire trigger: when a task is marked done, keep it for 10 days.
-- ============================================================
CREATE OR REPLACE FUNCTION set_task_expiry() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
    NEW.expires_at   := now() + INTERVAL '10 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_expiry_trigger ON tasks;
CREATE TRIGGER task_expiry_trigger
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_task_expiry();

-- ============================================================
--  Storage: public bucket for agent browser screenshots.
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

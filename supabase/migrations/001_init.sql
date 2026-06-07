-- ============================================================
--  Personal Agent — initial schema
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
                         CHECK (status IN ('queued', 'needs_confirmation', 'done', 'skipped')),
  agent_note           TEXT,
  confirmation_prompt  TEXT,
  sort_index           INT  NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  rating               SMALLINT,                 -- 1 = 👍, -1 = 👎
  approval_needed_flag BOOLEAN                   -- user flagged whether confirmation was unnecessary
);

CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_expires_idx ON tasks (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id);

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
  success         BOOLEAN NOT NULL DEFAULT true
);

-- ---------- connectors ----------
CREATE TABLE IF NOT EXISTS connectors (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('connected', 'needs_setup')),
  config    JSONB,
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
  use_count        INT NOT NULL DEFAULT 0,
  last_used_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflows_keywords_idx ON workflows USING GIN (trigger_keywords);

-- ============================================================
--  Row-Level Security
-- ============================================================

ALTER TABLE tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows   ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_own ON tasks FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY runs_own ON agent_runs FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY connectors_own ON connectors FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY workflows_own ON workflows FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
--  Auto-expire trigger: when a task is marked done, set expires_at = now + 10 min
-- ============================================================
CREATE OR REPLACE FUNCTION set_task_expiry() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
    NEW.expires_at   := now() + INTERVAL '10 minutes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_expiry_trigger ON tasks;
CREATE TRIGGER task_expiry_trigger
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_task_expiry();

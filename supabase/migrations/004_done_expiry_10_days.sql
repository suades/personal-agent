-- ============================================================
--  004: Keep completed tasks for 10 days (was 10 minutes)
--  Long enough to review history; short enough to free up storage.
--  The /api/cleanup cron already deletes done tasks past expires_at,
--  so only the expiry interval in the trigger needs to change.
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

-- Push out any tasks already marked done under the old 10-minute rule so they
-- aren't deleted on the next cleanup pass.
UPDATE tasks
  SET expires_at = completed_at + INTERVAL '10 days'
  WHERE status = 'done' AND completed_at IS NOT NULL;

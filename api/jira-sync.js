-- Daybreak roadmap: schema changes for auto-discovery + floor scoring
-- Run this ONCE in the Supabase SQL editor BEFORE deploying the new index.html.
-- Safe: it changes defaults for future rows and normalizes the is_new flag on
-- existing rows. It does not alter any existing scores.

-- 1. New initiatives start at the floor (1) on every dimension, not 3.
ALTER TABLE initiatives ALTER COLUMN effort     SET DEFAULT 1;
ALTER TABLE initiatives ALTER COLUMN value      SET DEFAULT 1;
ALTER TABLE initiatives ALTER COLUMN importance SET DEFAULT 1;
ALTER TABLE initiatives ALTER COLUMN urgency    SET DEFAULT 1;

-- 2. Reuse is_new as the "Requested / awaiting promotion" flag.
--    Everything already on the board should NOT be treated as requested,
--    so set is_new = false on all current rows. From here on, is_new = true
--    means "auto-discovered from Jira, not yet promoted."
UPDATE initiatives SET is_new = false WHERE is_new IS DISTINCT FROM false;

-- Verify:
SELECT
  count(*) FILTER (WHERE is_new)        AS requested_rows,
  count(*) FILTER (WHERE NOT is_new)    AS board_rows
FROM initiatives;

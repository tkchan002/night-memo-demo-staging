-- Apply ONCE via Supabase SQL editor before deploying the updated app.
-- Existing wards are opted out. Submitted report JSON needs no table migration.
ALTER TABLE public.wards
  ADD COLUMN IF NOT EXISTS single_double_reporting_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.wards.single_double_reporting_enabled IS
  'Whether the Ward memo shows S/D manual room reporting. Independent of capacity and gender mode.';

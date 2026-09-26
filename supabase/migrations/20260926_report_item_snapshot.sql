-- Safe additive migration used by services/report-service.js.
-- It makes historical reports independent of later report-item renames/deactivation.
-- Review and apply through your normal Supabase migration process.

alter table if exists public.ward_reports
  add column if not exists report_item_snapshot jsonb;

comment on column public.ward_reports.report_item_snapshot is
  'Snapshot of report-item definitions used when the ward report was saved.';

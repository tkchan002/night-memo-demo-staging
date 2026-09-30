-- Remove obsolete Manager ward grouping.
-- Manager Night Memo now uses one ordered list of all operational wards.
-- Empty-bed gender remains a separate clinical configuration on wards.empty_bed_gender_mode.

begin;

alter table public.wards
  drop column if exists manager_section;

commit;

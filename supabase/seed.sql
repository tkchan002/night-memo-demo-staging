-- Demo data for Night Memo.
-- Phone and fax numbers below are intentionally random four-digit demo values.
-- Run after schema.sql.

insert into public.form_versions(version,effective_from,status,schema_snapshot)
values (1,'2026-01-01','published','{}'::jsonb)
on conflict (version) do nothing;

insert into public.wards(name,phone,fax,empty_bed_gender_mode,display_order,active)
values
 ('C10','6397','3129','male',1,true),
 ('E10','9358','2921','male',2,true),
 ('G2','8072','4846','male',3,true),
 ('F10','8973','7432','male',4,true),
 ('E6','2372','9476','male',5,true),
 ('C6','5333','1137','male',6,true),
 ('G10','5834','1153','male',7,true),
 ('G11','6624','4882','mixed',8,true),
 ('B10','4662','8510','male',9,true),
 ('H6','1075','2810','mixed',10,true)
on conflict ((lower(name))) do update set
 phone=excluded.phone,
 fax=excluded.fax,
 empty_bed_gender_mode=excluded.empty_bed_gender_mode,
 display_order=excluded.display_order,
 active=true;

-- Initial operating periods.
insert into public.ward_operating_periods(ward_id,start_date,end_date,note)
select w.id,'2026-01-01',null,'Initial demo operating period'
from public.wards w
where w.name in ('C10','E10','G2','F10','E6','C6','G10','G11','B10','H6')
and not exists (select 1 from public.ward_operating_periods p where p.ward_id=w.id);

-- Initial capacity. These are demo values and can be changed later from maintenance.html.
insert into public.ward_capacity_history(ward_id,effective_from,effective_to,bed_capacity,note)
select w.id,'2026-01-01',null,
  case w.name when 'G2' then 36 when 'E6' then 36 when 'H6' then 36 else 40 end,
  'Initial demo capacity'
from public.wards w
where w.name in ('C10','E10','G2','F10','E6','C6','G10','G11','B10','H6')
and not exists (select 1 from public.ward_capacity_history c where c.ward_id=w.id);

-- Built-in report items. Storage names preserve the existing JSON shape where practical.
insert into public.report_items(key,section,label,input_type,options,sort_order,active,effective_from,builtin,config)
values
 ('admissionEC','admission','Admission E/C','dropdown','["0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30"]',1,true,'2026-01-01',true,'{"storage":"direct"}'),
 ('admissionCC','admission','Admission C/C','dropdown','["0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30"]',2,true,'2026-01-01',true,'{"storage":"direct"}'),
 ('discharge','admission','Discharge','dropdown','["0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30"]',3,true,'2026-01-01',true,'{"storage":"direct"}'),
 ('death','admission','Death','dropdown','["0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"]',4,true,'2026-01-01',true,'{"storage":"direct"}'),
 ('transferIn','admission','T/I (Transfer In) Gen','dropdown','["0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"]',5,true,'2026-01-01',true,'{"storage":"direct"}'),
 ('transferOut','admission','T/O (Transfer Out) Gen','dropdown','["0","1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20"]',6,true,'2026-01-01',true,'{"storage":"direct"}'),
 ('totalPatientM','bedcount','Total Patient','number','[]',7,true,'2026-01-01',true,'{"storage":"direct"}'),
 ('iCRE','infection','CRE','bed_chooser','[]',8,true,'2026-01-01',true,'{"storage":"infBeds"}'),
 ('iVRE','infection','VRE','bed_chooser','[]',9,true,'2026-01-01',true,'{"storage":"infBeds"}'),
 ('iCOV','infection','COVID','bed_chooser','[]',10,true,'2026-01-01',true,'{"storage":"infBeds"}'),
 ('iMDR','infection','MDRA','bed_chooser','[]',11,true,'2026-01-01',true,'{"storage":"infBeds"}'),
 ('iCD','infection','CD+ve','bed_chooser','[]',12,true,'2026-01-01',true,'{"storage":"infBeds"}'),
 ('iInf','infection','Inf +ve','bed_chooser','[]',13,true,'2026-01-01',true,'{"storage":"infBeds"}'),
 ('iCA','infection','Candida Auris Other Contact','bed_chooser','[]',14,true,'2026-01-01',true,'{"storage":"infBeds"}'),
 ('dMV','devices','MV','bed_or_count','[]',15,true,'2026-01-01',true,'{"storage":"devBeds"}'),
 ('dNIV','devices','NIV / BiPAP','bed_or_count','[]',16,true,'2026-01-01',true,'{"storage":"devBeds"}'),
 ('dHF','devices','HFNC','bed_or_count','[]',17,true,'2026-01-01',true,'{"storage":"devBeds"}'),
 ('dHD','devices','HD','bed_or_count','[]',18,true,'2026-01-01',true,'{"storage":"devBeds"}'),
 ('dCA','devices','CAPD','bed_or_count','[]',19,true,'2026-01-01',true,'{"storage":"devBeds"}')
on conflict (key) do update set
 section=excluded.section,label=excluded.label,input_type=excluded.input_type,options=excluded.options,sort_order=excluded.sort_order,active=excluded.active,builtin=excluded.builtin,config=excluded.config;

-- Demo staff. Real names should be maintained from ward.html or maintenance.html.
insert into public.ward_staff(ward_id,role,name,appointment_date,active,display_order)
select w.id,s.role,w.name || s.suffix,s.appt,true,s.ord
from public.wards w
cross join (values
 ('APN',' Demo APN','2022-03-01'::date,10),
 ('RN',' Demo RN A','2024-08-05'::date,20),
 ('RN',' Demo RN B','2025-07-28'::date,30)
) as s(role,suffix,appt,ord)
where w.name in ('C10','E10','G2','F10','E6','C6','G10','G11','B10','H6')
and not exists (select 1 from public.ward_staff ws where ws.ward_id=w.id);

-- One fictional report for current_date for each ward so manager.html has data immediately.
with ranked as (
  select w.id,w.name,w.empty_bed_gender_mode,w.display_order,
         row_number() over(order by w.display_order) as rn,
         c.bed_capacity
  from public.wards w
  join lateral (
    select ch.bed_capacity from public.ward_capacity_history ch
    where ch.ward_id=w.id and ch.effective_from<=current_date and (ch.effective_to is null or ch.effective_to>=current_date)
    order by ch.effective_from desc limit 1
  ) c on true
  where w.name in ('C10','E10','G2','F10','E6','C6','G10','G11','B10','H6')
), payloads as (
  select *,
    greatest(0, bed_capacity - ((bed_capacity - (rn::int % 5)))) as empty_count,
    (bed_capacity - (rn::int % 5)) as total_patient
  from ranked
)
insert into public.ward_reports(ward_id,report_date,payload,bed_capacity_snapshot,form_version)
select id,current_date,
  jsonb_build_object(
    'admissionEC', ((rn*3+2)%11)::text,
    'admissionCC', (rn%3)::text,
    'discharge', ((rn*2+3)%10)::text,
    'death', (rn%2)::text,
    'transferIn', (rn%4)::text,
    'transferOut', ((rn+1)%4)::text,
    'totalPatientM', total_patient::text,
    'emptyBeds', jsonb_build_object(
       'count', empty_count,
       'details', case when empty_bed_gender_mode='mixed' and empty_count>0 then
         jsonb_build_array(jsonb_build_object('location',bed_capacity::text,'gender','M','remark',case when rn%3=0 then 'HZ' else '' end))
       else '[]'::jsonb end
    ),
    'earlyBirds', case when rn%3=0 then jsonb_build_array(jsonb_build_object('bed',(10+rn)::text,'dest','Rehab')) else '[]'::jsonb end,
    'infBeds', jsonb_build_object('iCRE',case when rn%4=0 then jsonb_build_array(32) else '[]'::jsonb end,'iVRE','[]'::jsonb,'iCOV','[]'::jsonb,'iMDR','[]'::jsonb,'iCD','[]'::jsonb,'iInf',case when rn%5=0 then jsonb_build_array(12) else '[]'::jsonb end,'iCA','[]'::jsonb),
    'devBeds', jsonb_build_object(
       'dMV',jsonb_build_object('mode','beds','count',0,'beds',case when rn%2=0 then jsonb_build_array(11) else '[]'::jsonb end),
       'dNIV',jsonb_build_object('mode','beds','count',0,'beds',case when rn%3=0 then jsonb_build_array(21) else '[]'::jsonb end),
       'dHF',jsonb_build_object('mode','beds','count',0,'beds','[]'::jsonb),
       'dHD',jsonb_build_object('mode','count','count',(rn%2)::int,'beds','[]'::jsonb),
       'dCA',jsonb_build_object('mode','beds','count',0,'beds','[]'::jsonb)
    ),
    'dynamicItems','{}'::jsonb,
    'nilSpecial',true,'patients','[]'::jsonb,'nilConsultation',true,'consultations','[]'::jsonb,'nilIntubation',true,'intubations','[]'::jsonb,
    'nurses',jsonb_build_array(jsonb_build_object('role','RN','name',name || ' Demo RN A','appt','05/08/2024','runner',(rn%4=0),'source','ward_staff')),
    'staffAM',(4 + (rn%3)*0.5)::text,
    'staffPM',(4 + (rn%2)*0.5)::text,
    'sigRank','RN','sigName',name || ' Demo RN A','sigAppt','05/08/2024','savedAt',now()::text
  ),
  bed_capacity,1
from payloads
on conflict (ward_id,report_date) do nothing;

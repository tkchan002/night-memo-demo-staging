import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoDataBundle } from '../domain/demo-generator.js';
import { formatManagerEmptyBeds } from '../domain/manager-memo.js';
import { validateReportPayload } from '../domain/report-validation.js';
const ward = (name, enabled) => ({ id:name, name, active:true, display_order:name==='SD'?1:2,
  empty_bed_gender_mode:'mixed', single_double_reporting_enabled:enabled });
const wards = [ward('SD',true), ward('MF',false)];
const base = { wards, periods:wards.map(w=>({ward_id:w.id,start_date:'2026-01-01',end_date:null})),
  capacities:{SD:40, MF:40}, items:[], scenario:'typical', reportDate:'2026-10-09',
  now:new Date('2026-10-09T13:00:00Z'), seed:90410 };

test('Test Data produces repeatable entries with remarks and ward-scoped S/D', () => {
 const data=generateDemoDataBundle(base);
 assert.equal(data.generator_version,4);
 assert.equal(data.coverage.manual_empty_bed_sd,true);
 for(const report of data.reports){
  const entries=report.payload.emptyBeds.entries;
  assert.ok(entries.some(e=>e.remark==='TB'));
  assert.ok(entries.some(e=>e.remark==='HZV'));
  assert.equal(report.payload.emptyBeds.count,40-Number(report.payload.totalPatientM));
  if(report.ward_name==='SD'){
   assert.ok(entries.some(e=>e.designation==='S'));
   assert.ok(entries.some(e=>e.designation==='D'));
  }else assert.ok(entries.every(e=>e.designation!=='S'&&e.designation!=='D'));
  assert.equal(validateReportPayload(report.payload,{capacity:40}).valid,true);
 }
});
test('Test Data entries do not determine or reconcile with total',()=>{
 const report=generateDemoDataBundle(base).reports.find(x=>x.ward_name==='SD');
 const before=report.payload.emptyBeds.count;
 report.payload.emptyBeds.entries.push({quantity:99,designation:'M',remark:'TB'});
 assert.equal(validateReportPayload(report.payload,{capacity:40}).valid,true);
 assert.equal(report.payload.emptyBeds.count,before);
 assert.match(formatManagerEmptyBeds(wards[0],report,40),/99M \(TB\)/);
});
test('when no ward enables S/D no generated S/D entries appear',()=>{
 const off=wards.map(w=>({...w,single_double_reporting_enabled:false}));
 const bundle=generateDemoDataBundle({...base,wards:off});
 assert.equal(bundle.coverage.manual_empty_bed_sd,null);
 assert.ok(bundle.reports.every(x=>x.payload.emptyBeds.entries.every(e=>!['S','D'].includes(e.designation))));
});
test('bundled browser demo uses same unified entry structure',async()=>{
 const {DEMO_WARDS,DEMO_REPORTS}=await import('../demo-data.js');
 const enabled=DEMO_WARDS.filter(w=>w.single_double_reporting_enabled===true);
 assert.equal(enabled.length,1);
 const sample=DEMO_REPORTS.find(r=>r.ward_name===enabled[0].name);
 assert.ok(sample.payload.emptyBeds.entries.some(x=>x.designation==='S'));
 assert.ok(sample.payload.emptyBeds.entries.some(x=>x.designation==='D'));
 assert.equal(sample.payload.emptyBeds.count,enabled[0].capacity-Number(sample.payload.totalPatientM));
 assert.ok(DEMO_REPORTS.filter(r=>r.ward_name!==enabled[0].name)
  .every(r=>r.payload.emptyBeds.entries.every(x=>!['S','D'].includes(x.designation))));
});

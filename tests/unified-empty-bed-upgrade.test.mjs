import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatEmptyBedEntries, legacyEmptyBedEntries, parseEmptyBedLabel, validateEmptyBedEntries } from '../domain/empty-bed-reporting.js';
import { formatManagerEmptyBeds } from '../domain/manager-memo.js';
import { normalizeReportPayload } from '../domain/report-model.js';
import { validateReportPayload } from '../domain/report-validation.js';
import { buildManagerWardInformation } from '../domain/manager-ward-information.js';

const entries = [
  { quantity: 1, designation: 'M', remark: 'TB' },
  { quantity: 1, designation: 'M', remark: 'HZV' },
  { quantity: 1, designation: 'D', remark: '' },
  { quantity: 1, designation: 'S', remark: '' },
];

test('duplicates remain separate in the original entry order; blank remarks add no parentheses', () => {
  assert.equal(formatEmptyBedEntries(entries), '1M (TB), 1M (HZV), 1D, 1S');
  assert.deepEqual(parseEmptyBedLabel(' 1m '), {quantity:1, designation:'M'});
  assert.deepEqual(parseEmptyBedLabel('2D'), {quantity:2, designation:'D'});
  assert.equal(parseEmptyBedLabel('3X'), null);
  assert.equal(parseEmptyBedLabel('0M'), null);
  assert.deepEqual(validateEmptyBedEntries(entries), []);
});

test('invalid entries are not silently converted to valid ones', () => {
  assert.ok(validateEmptyBedEntries([{quantity:'oops',designation:'',remark:'TB'}]).length);
  assert.ok(validateEmptyBedEntries([{quantity:0,designation:'M',remark:''}]).length);
  assert.ok(validateEmptyBedEntries([{quantity:1,designation:'X',remark:''}]).length);
});

test('Manager formats unified entries without aggregating or calculating', () => {
  const payload = normalizeReportPayload({ totalPatientM:'35', emptyBeds:{count:5,version:2,entries} });
  assert.equal(payload.emptyBeds.version, 2);
  assert.equal(payload.emptyBeds.count,5);
  assert.equal(payload.emptyBeds.reported,null);
  assert.equal(formatManagerEmptyBeds({empty_bed_gender_mode:'male'}, {payload},40), '5 (1M (TB), 1M (HZV), 1D, 1S)');
  assert.equal(validateReportPayload(payload,{capacity:40}).valid,true);
  const copy = structuredClone(payload);
  copy.emptyBeds.entries[2].quantity=88;
  assert.equal(validateReportPayload(copy,{capacity:40}).valid,true);
  assert.equal(copy.emptyBeds.count,5);
});

test('empty modern entries do not infer an M/F classification from the calculated total', () => {
  assert.equal(formatManagerEmptyBeds({empty_bed_gender_mode:'male'}, {payload:{emptyBeds:{count:5, entries:[]}}},40), '5');
});

test('reading reports from previous ZIP preserves both independent category totals and annotations', () => {
  const old = {count:5,reported:{male:2,female:0,single:1,double:1,singleDoubleEnabled:true},
    details:[{location:'12',gender:'M',remark:'TB'}]};
  assert.deepEqual(legacyEmptyBedEntries(old,{empty_bed_gender_mode:'mixed'}),[
    {quantity:2,designation:'M',remark:''},
    {quantity:1,designation:'S',remark:''},
    {quantity:1,designation:'D',remark:''},
    {quantity:1,designation:'M',remark:'12 - TB'},
  ]);
  assert.equal(formatManagerEmptyBeds({empty_bed_gender_mode:'male'},{payload:{emptyBeds:old}},40), '5 (2M, 1S, 1D, 1M (12 - TB))');
});

test('Manager additional items include only genuine additional-category definitions', () => {
  const ward={id:'w1',name:'C5'};
  const report={payload:{dynamicItems:{custom_inf:'Covid',custom_add:'Remarks'}},report_item_snapshot:[
    {key:'custom_inf',label:'Infection item',section:'infection',sort_order:1,builtin:false},
    {key:'custom_add',label:'Other item',section:'additional',sort_order:2,builtin:false},
  ]};
  const rows=buildManagerWardInformation({wards:[ward],bundle:[{ward,report}]});
  assert.deepEqual(rows[0].additionalItems.map(x=>x.label), ['Other item']);
  const onlyInfection=buildManagerWardInformation({wards:[ward],bundle:[{ward,report:{...report,report_item_snapshot:[report.report_item_snapshot[0]]}}]});
  assert.equal(onlyInfection[0].additionalItems.length,0);
});

test('Ward reuses original row controls and Manager hides unconfigured additional section',async()=>{
  const html=await readFile(new URL('../ward.html',import.meta.url),'utf8');
  const ward=await readFile(new URL('../pages/ward-page.js',import.meta.url),'utf8');
  const manager=await readFile(new URL('../pages/manager-page.js',import.meta.url),'utf8');
  assert.match(html,/Optional Bed \/ Location Remarks/);
  assert.doesNotMatch(html,/id="emptyManualBlock"|id="ebReportM"/);
  assert.match(html,/class="btn-s" type="button" onclick="addEmptyDetail\(\)"/);
  assert.match(ward,/class="btn-x" type="button" aria-label="Remove empty bed entry"/);
  assert.match(ward,/single_double_reporting_enabled/);
  assert.match(manager,/\$\{additional \? renderWardInfoSection\('Additional Report Items'/);
  assert.doesNotMatch(manager,/No configured Additional Report Items/);
});

test('Ward print contains the same consecutive entries with HTML escaping',async()=>{
  const {renderWardMemoHtml}=await import('../ward-print.js');
  const html=renderWardMemoHtml({ward:{name:'C5',empty_bed_gender_mode:'mixed',single_double_reporting_enabled:true},
    capacity:40, report:{report_date:'2026-10-09',payload:{totalPatientM:'35',emptyBeds:{count:5,entries:[...entries,{quantity:1,designation:'F',remark:'<script>'}]}}}});
  assert.match(html,/1M \(TB\), 1M \(HZV\), 1D, 1S/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});

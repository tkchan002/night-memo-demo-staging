import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
const domain=process.env.INTERNAL_LOGIN_DOMAIN||'nightmemo.local';
const wardPassword=process.env.DEMO_WARD_PASSWORD;
const managerPassword=process.env.DEMO_MANAGER_PASSWORD;
const maintenancePassword=process.env.DEMO_MAINTENANCE_PASSWORD;
if(!wardPassword||!managerPassword||!maintenancePassword) throw new Error('Set the three DEMO_*_PASSWORD values in .env');
const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const wardNames=['C10','E10','G2','F10','E6','C6','G10','G11','B10','H6'];
const emailFor=id=>`${id.toLowerCase().replace(/[^a-z0-9._-]+/g,'.')}@${domain}`;

async function ensureUser(loginId,password,role,wardId=null){
  const email=emailFor(loginId);
  const {data:list,error:listErr}=await admin.auth.admin.listUsers({page:1,perPage:1000});
  if(listErr)throw listErr;
  let user=list.users.find(u=>u.email?.toLowerCase()===email.toLowerCase());
  if(!user){
    const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{login_id:loginId,display_name:loginId}});
    if(error)throw error;user=data.user;console.log('Created auth user',loginId);
  }else console.log('Auth user exists',loginId);
  const {error:upsertErr}=await admin.from('user_access').upsert({auth_user_id:user.id,login_id:loginId,display_name:loginId,role,ward_id:wardId,active:true},{onConflict:'auth_user_id'});
  if(upsertErr)throw upsertErr;
}

for(const wardName of wardNames){
  const {data:ward,error}=await admin.from('wards').select('id').eq('name',wardName).single();
  if(error)throw error;
  await ensureUser(wardName,wardPassword,'ward',ward.id);
}
await ensureUser('PatrolNight',managerPassword,'manager',null);
await ensureUser('NightMaintenance',maintenancePassword,'maintenance',null);
console.log('Demo account mappings complete.');

import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createHash, createHmac } from 'node:crypto'

type Env = { Bindings: { DB: D1Database; ADMIN_PASSWORD_HASH: string; SESSION_SECRET: string; WEB_ORIGIN: string } }
const app = new Hono<Env>()

type User = { id:number; username:string; display_name:string; mobile:string; user_type:'DOCTOR'|'REP'|'SALESMAN'; active:number; permissions_json:string }
type LoginUser = User & { password_hash:string }
type Auth = { kind:'ADMIN'|'USER'; user?:User }
type AppContext = Context<Env>
const BOOKING_STATUS_ORDER:Record<string,number>={PENDING:0,ASSIGNED:1,ACCEPTED:2,CONFIRMED:3,DONE:4}
function isValidBookingStatus(status:string){return Object.prototype.hasOwnProperty.call(BOOKING_STATUS_ORDER,status)}
function isFinalizedBooking(booking:any){return booking.status==='DONE'||!!booking.done_at}
function validText(value:unknown,max:number){return typeof value==='string'&&value.trim().length>0&&value.trim().length<=max}
function validName(value:unknown){return validText(value,200)&&/^[\p{L}\p{M}\p{N} .'-]+$/u.test(String(value).trim())}
function validPhone(value:unknown){return validText(value,32)&&/^[\p{L}\p{N} ()+./-]+$/u.test(String(value).trim())}
function validAge(value:unknown){return Number.isInteger(Number(value))&&Number(value)>=0&&Number(value)<=120}
function validGender(value:unknown){return value==='Male'||value==='Female'||value==='Other'}
function validPreferredAt(value:unknown){return value==null||value===''||(typeof value==='string'&&value.length<=64&&!Number.isNaN(new Date(value).getTime()))}
function validTests(value:unknown){return Array.isArray(value)&&value.length>0&&value.length<=100&&value.every((test:any)=>test&&validText(test.code,128))}
function validBookingFields(body:any){return validName(body.patient_name)&&validPhone(body.phone)&&validAge(body.age)&&validGender(body.gender)&&validPreferredAt(body.preferred_at)&&validTests(body.tests)}
function validPermissions(value:unknown){return Array.isArray(value)&&value.every(permission=>typeof permission==='string'&&ALL_PERMISSIONS.includes(permission))}
function validDateKey(value:unknown){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())}
function reportRange(c:any){const from=String(c.req.query('from')||''),to=String(c.req.query('to')||'');if(!validDateKey(from)||!validDateKey(to))return null;const start=Date.parse(`${from}T00:00:00Z`),end=Date.parse(`${to}T23:59:59.999Z`);return end>=start&&end-start<=366*24*60*60*1000?{from,to}:null}
function bookingTestCount(booking:any){try{return JSON.parse(booking.tests_json||'[]').length||0}catch{return 0}}
function validTargetValue(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0&&n<=1000000000}
function validUserId(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null}
async function targetActual(db:D1Database,userId:number,from:string,to:string){const row=await db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE DATE(created_at) BETWEEN ? AND ? AND (created_by_user_id=? OR assigned_to_user_id=?)`).bind(from,to,userId,userId).first<any>();return Number(row?.n||0)}
async function targetWithProgress(db:D1Database,target:any){const actual=await targetActual(db,Number(target.user_id),target.period_start,target.period_end);const value=Number(target.target_value);return {...target,actual,percentage:value?actual/value:0,remaining:Math.max(0,value-actual)}}
const PASSWORD_SCHEME='pbkdf2-sha256'
const PASSWORD_ITERATIONS=100000
const loginAttempts=new Map<string,{failures:number;blockedUntil:number;lastAttempt:number}>()

const ALL_PERMISSIONS = [
  'create_reservations','view_own_reservations','edit_own_pending_reservations',
  'accept_assigned_reservations','confirm_visits','mark_visits_done','assign_reservations',
  'view_all_reservations','edit_all_reservations','edit_confirmed_assigned_reservations',
  'add_extra_tests','view_own_commission','manage_users','manage_commission_rules',
  'manage_targets','manage_commission_payments','manage_catalog'
]

app.use('*', async (c,next)=>{
  const origin=c.req.header('Origin')||''
  if(origin && (origin===c.env.WEB_ORIGIN || origin==='http://localhost:3000' || origin==='http://127.0.0.1:3000'))c.header('Access-Control-Allow-Origin',origin)
  c.header('Access-Control-Allow-Credentials','true')
  c.header('Access-Control-Allow-Headers','Content-Type, Authorization')
  c.header('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS')
  if(c.req.method==='OPTIONS')return c.body(null,204)
  if(['POST','PUT','PATCH','DELETE'].includes(c.req.method)&&!c.req.header('Authorization')&&(getCookie(c,'admin_session')||getCookie(c,'user_session'))){
    const requestOrigin=origin||(()=>{try{return new URL(c.req.header('Referer')||'').origin}catch{return ''}})()
    const allowed=requestOrigin===c.env.WEB_ORIGIN||requestOrigin==='http://localhost:3000'||requestOrigin==='http://127.0.0.1:3000'
    if(!allowed)return c.json({error:'CSRF validation failed'},403)
  }
  await next()
})

function digest(value:string){return createHash('sha256').update(value).digest('hex')}
function bytesToBase64(bytes:Uint8Array){let value='';for(const byte of bytes)value+=String.fromCharCode(byte);return btoa(value)}
function base64ToBytes(value:string){const binary=atob(value);return Uint8Array.from(binary,character=>character.charCodeAt(0))}
function constantTimeEqual(left:Uint8Array,right:Uint8Array){if(left.length!==right.length)return false;let difference=0;for(let i=0;i<left.length;i++)difference|=left[i]^right[i];return difference===0}
async function hashPassword(password:string){const salt=crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PASSWORD_ITERATIONS,hash:'SHA-256'},key,256);return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`}
async function verifyPassword(stored:string,password:string){
  if(stored.startsWith(`${PASSWORD_SCHEME}$`)){
    const parts=stored.split('$');if(parts.length!==4)return {valid:false,legacy:false}
    const iterations=Number(parts[1]);if(!Number.isInteger(iterations)||iterations<100000||iterations>1000000)return {valid:false,legacy:false}
    try{const salt=base64ToBytes(parts[2]);const expected=base64ToBytes(parts[3]);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,expected.length*8);return {valid:constantTimeEqual(new Uint8Array(bits),expected),legacy:false}}catch{return {valid:false,legacy:false}}
  }
  if(!/^[0-9a-f]{64}$/i.test(stored))return {valid:false,legacy:false}
  const actual=Uint8Array.from(stored.match(/../g)!.map(pair=>parseInt(pair,16)))
  return {valid:constantTimeEqual(Uint8Array.from(digest(password).match(/../g)!.map(pair=>parseInt(pair,16))),actual),legacy:true}
}
function loginKey(scope:string,identifier:string,ip:string){return `${scope}:${ip}:${identifier.toLowerCase().trim()}`}
function loginAllowed(key:string){const now=Date.now();for(const [entry,value] of loginAttempts)if(now-value.lastAttempt>30*60*1000)loginAttempts.delete(entry);const value=loginAttempts.get(key);return !value||value.blockedUntil<=now}
function loginFailure(key:string){const now=Date.now();const value=loginAttempts.get(key)||{failures:0,blockedUntil:0,lastAttempt:now};value.failures++;value.lastAttempt=now;if(value.failures>=5)value.blockedUntil=now+15*60*1000;loginAttempts.set(key,value);if(loginAttempts.size>10000)loginAttempts.delete(loginAttempts.keys().next().value!)}
function loginSuccess(key:string){loginAttempts.delete(key)}
function clientIp(c:any){return c.req.header('CF-Connecting-IP')||c.req.header('X-Forwarded-For')?.split(',')[0].trim()||'unknown'}
function sign(payload:string,secret:string){return createHmac('sha256',secret).update(payload).digest('hex')}
function makeToken(secret:string,prefix:string,id?:number){
  const exp=Math.floor(Date.now()/1000)+60*60*8
  const payload=id?`${prefix}:${id}:${exp}`:`${prefix}:${exp}`
  return `${payload}.${sign(payload,secret)}`
}
function verifyToken(token:string|undefined,secret:string){
  if(!token)return null
  const parts=token.split('.')
  if(parts.length!==2)return null
  const [payload,sig]=parts
  if(sig!==sign(payload,secret))return null
  const p=payload.split(':')
  const exp=Number(p[p.length-1])
  if(!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000))return null
  if(p[0]==='a')return {kind:'ADMIN'} as Auth
  if(p[0]==='u' && Number(p[1]))return {kind:'USER',id:Number(p[1])} as any
  return null
}
async function auth(c:AppContext):Promise<Auth|null>{
  const h=c.req.header('Authorization')||''
  const bearer=h.startsWith('Bearer ')?h.slice(7):undefined
  const token=bearer||getCookie(c,'admin_session')||getCookie(c,'user_session')
  const x=verifyToken(token,c.env.SESSION_SECRET) as any
  if(!x)return null
  if(x.kind==='ADMIN')return x
  const user=await c.env.DB.prepare('SELECT id,username,display_name,mobile,user_type,active,permissions_json FROM users WHERE id=?').bind(x.id).first<User>()
  if(!user||!user.active)return null
  return {kind:'USER',user}
}
// Scoped check that only reads the cookie matching `expected`, so an admin_session in the same
// browser can't shadow a staff user_session (or vice versa) for session-identity checks.
async function authAs(c:AppContext,expected:'ADMIN'|'USER'):Promise<Auth|null>{
  const h=c.req.header('Authorization')||''
  const bearer=h.startsWith('Bearer ')?h.slice(7):undefined
  const bearerAuth=verifyToken(bearer,c.env.SESSION_SECRET) as any
  const token=bearerAuth?.kind===expected?bearer:getCookie(c,expected==='ADMIN'?'admin_session':'user_session')
  const x=verifyToken(token,c.env.SESSION_SECRET) as any
  if(!x||x.kind!==expected)return null
  if(x.kind==='ADMIN')return x
  const user=await c.env.DB.prepare('SELECT id,username,display_name,mobile,user_type,active,permissions_json FROM users WHERE id=?').bind(x.id).first<User>()
  if(!user||!user.active)return null
  return {kind:'USER',user}
}
function hasPerm(a:Auth|null,p:string){if(!a)return false;if(a.kind==='ADMIN')return true;try{return JSON.parse(a.user?.permissions_json||'[]').includes(p)}catch{return false}}
function jsonErr(c:any,msg:string,status=400){return c.json({error:msg},status)}
function randomHex(){return Array.from(crypto.getRandomValues(new Uint8Array(3))).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase()}
function nowIso(){return new Date().toISOString()}
function dateKey(value:string|Date){const d=value instanceof Date?value:new Date(value);return d.toISOString().slice(0,10)}
function uniqueStrings(values:any[]){return Array.from(new Set(values.map(v=>String(v||'').trim()).filter(Boolean)))}

async function ensureAdminTable(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS admin_users(id INTEGER PRIMARY KEY CHECK(id=1),password_hash TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run()}
async function settings(db:D1Database){let s=await db.prepare('SELECT * FROM commission_settings WHERE id=1').first<any>();if(!s){await db.prepare('INSERT OR IGNORE INTO commission_settings(id) VALUES(1)').run();s=await db.prepare('SELECT * FROM commission_settings WHERE id=1').first<any>()}return s}
async function userById(db:D1Database,id:number){return db.prepare('SELECT id,username,display_name,mobile,user_type,active,permissions_json FROM users WHERE id=?').bind(id).first<User>()}
async function bookingByRef(db:D1Database,ref:string){return db.prepare('SELECT * FROM bookings WHERE reference=?').bind(ref).first<any>()}
async function activeDuplicate(db:D1Database,name:string,phone:string,exclude?:string){
 const sql=`SELECT reference,status,created_by_type,created_by_user_id,assigned_to_user_id,created_at FROM bookings WHERE status!='DONE' AND LOWER(TRIM(patient_name))=LOWER(TRIM(?)) AND TRIM(phone)=TRIM(?) ${exclude?'AND reference!=?':''} ORDER BY created_at DESC LIMIT 10`
 const args=exclude?[name,phone,exclude]:[name,phone]
 return (await db.prepare(sql).bind(...args).all()).results||[]
}
async function recomputeBooking(db:D1Database,ref:string,includeCurrent=false){
 const b=await bookingByRef(db,ref); if(!b)return
 if(isFinalizedBooking(b))return
 const s=await settings(db)
 let ownerId=b.commission_owner_user_id as number|null
 let ownerType=b.commission_owner_type as string|null
 if(b.created_by_type==='SALESMAN'&&b.created_by_user_id){ownerId=Number(b.created_by_user_id);ownerType='SALESMAN'}
 else if((b.created_by_type==='DOCTOR'||b.created_by_type==='REP')&&b.assigned_to_user_id){ownerId=Number(b.assigned_to_user_id);ownerType=b.created_by_type}
 if(!ownerId){await db.prepare('UPDATE bookings SET commission_owner_user_id=NULL,commission_owner_type=NULL,commission_base_amount=0,commission_bonus_amount=0,commission_amount=0,daily_patient_count=0,updated_at=CURRENT_TIMESTAMP WHERE reference=?').bind(ref).run();return}
 const owner=await userById(db,ownerId); if(!owner)return
 const isSales=owner.user_type==='SALESMAN'
 const baseRate=isSales?Number(s.salesman_base_rate):owner.user_type==='DOCTOR'?Number(s.doctor_base_rate):Number(s.rep_base_rate)
 const bonusRate=isSales?Number(s.salesman_bonus_rate):owner.user_type==='DOCTOR'?Number(s.doctor_bonus_rate):Number(s.rep_bonus_rate)
 const threshold=Number(s.daily_patient_threshold||10)
 const day=dateKey(b.created_at)
 const countRow=await db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE DATE(created_at)=? AND (status!='DONE' OR reference=?) AND ((created_by_type='SALESMAN' AND created_by_user_id=?) OR (created_by_type IN ('DOCTOR','REP') AND assigned_to_user_id=?))`).bind(day,includeCurrent?ref:'',ownerId,ownerId).first<any>()
 const count=Number(countRow?.n||0)
 const total=Number(b.original_total ?? b.total ?? 0)
 const base=total*baseRate
 const bonus=count>threshold?total*bonusRate:0
 let visitFee=Number(b.visit_fee_amount||0)
 let visitFeeRate=Number(b.visit_fee_rate||0)
 if(b.visit_fee_earned_at) { visitFee=Number(b.visit_fee_amount||0); visitFeeRate=Number(b.visit_fee_rate||0) }
 else if(b.created_by_type==='SALESMAN'&&b.assigned_to_user_id){
   const assigned=await userById(db,Number(b.assigned_to_user_id));
   visitFeeRate=assigned?.user_type==='DOCTOR'?Number(s.doctor_visit_fee):assigned?.user_type==='REP'?Number(s.rep_visit_fee):0
   visitFee=visitFeeRate
 }
 await db.prepare(`UPDATE bookings SET commission_owner_user_id=?,commission_owner_type=?,commission_base_rate=?,commission_bonus_rate=?,commission_threshold=?,commission_base_amount=?,commission_bonus_amount=?,commission_amount=?,daily_patient_count=?,visit_fee_rate=?,visit_fee_amount=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?`).bind(ownerId,ownerType,baseRate,bonusRate,threshold,base,bonus,base+bonus,count,visitFeeRate,visitFee,ref).run()
}
app.get('/tests',async c=>{
 const q=String(c.req.query('q')||'').trim().toLowerCase();if(!q)return c.json({tests:[]});const like=`%${q}%`
 const {results}=await c.env.DB.prepare(`SELECT test_no,analysis_name,unit,ref_range,specimen,duration,price,contract_price,patient_price FROM tests WHERE active=1 AND (LOWER(analysis_name) LIKE ? OR LOWER(test_no) LIKE ? OR LOWER(unit) LIKE ? OR LOWER(ref_range) LIKE ? OR LOWER(specimen) LIKE ?) ORDER BY CASE WHEN LOWER(test_no)=? THEN 0 WHEN LOWER(analysis_name)=? THEN 1 WHEN LOWER(test_no) LIKE ? THEN 2 WHEN LOWER(analysis_name) LIKE ? THEN 3 ELSE 4 END,analysis_name ASC LIMIT 50`).bind(like,like,like,like,like,q,q,`${q}%`,`${q}%`).all();return c.json({tests:results||[]})
})

app.get('/bookings/check-duplicate',async c=>{const name=String(c.req.query('name')||'').trim();const phone=String(c.req.query('phone')||'').trim();if(!name||!phone)return c.json({duplicates:[]});return c.json({duplicates:await activeDuplicate(c.env.DB,name,phone)})})

app.post('/logout',c=>{const options={httpOnly:true,secure:true,sameSite:'None' as const,path:'/'};deleteCookie(c,'admin_session',options);deleteCookie(c,'user_session',options);return c.json({ok:true})})

app.post('/bookings',async c=>{
 const a=await auth(c);const b=await c.req.json();if(!validBookingFields(b))return jsonErr(c,'Invalid booking')
 if(a?.kind==='USER'&&!hasPerm(a,'create_reservations'))return jsonErr(c,'You do not have permission to create reservations',403)
 const codes=uniqueStrings(b.tests.map((t:any)=>t.code)).slice(0,100);if(!codes.length)return jsonErr(c,'No tests selected')
 const ph=codes.map(()=>'?').join(',');const {results}=await c.env.DB.prepare(`SELECT test_no,analysis_name,unit,ref_range,specimen,duration,price,contract_price,patient_price FROM tests WHERE active=1 AND test_no IN (${ph})`).bind(...codes).all();
 const byCode=new Map((results||[]).map((r:any)=>[String(r.test_no),r]));const selected=codes.map(x=>byCode.get(x)).filter(Boolean);if(selected.length!==codes.length)return jsonErr(c,'One or more selected tests are invalid')
 const total=selected.reduce((s:number,t:any)=>s+Number(t.patient_price||0),0);const reference='LAB-'+Date.now().toString(36).toUpperCase()+'-'+randomHex();
 const createdByType=a?.kind==='USER'?a.user!.user_type:'PUBLIC';const creatorId=a?.kind==='USER'?a.user!.id:null
 const s=await settings(c.env.DB);const editHours=Number(s.edit_pending_hours||24);const deadline=new Date(Date.now()+editHours*3600000).toISOString()
 await c.env.DB.prepare(`INSERT INTO bookings(reference,patient_name,age,gender,phone,preferred_at,address,tests_json,total,original_total,status,created_by_user_id,created_by_type,edit_deadline,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(reference,String(b.patient_name).trim(),Number(b.age)||null,b.gender||null,String(b.phone).trim(),b.preferred_at||null,b.address||null,JSON.stringify(selected),total,total,'PENDING',creatorId,createdByType,deadline).run()
 await c.env.DB.prepare(`INSERT INTO booking_status_history(booking_reference,from_status,to_status,changed_by_user_id,changed_by_type) VALUES(?,?,?,?,?)`).bind(reference,null,'PENDING',creatorId,createdByType).run()
 await recomputeBooking(c.env.DB,reference)
 const duplicates=await activeDuplicate(c.env.DB,String(b.patient_name),String(b.phone),reference)
 return c.json({reference,total,status:'PENDING',duplicates})
})

app.post('/login',async c=>{
 const {username,password}=await c.req.json();if(!validText(username,128)||!validText(password,256))return jsonErr(c,'Invalid username or password',401);const key=loginKey('user',String(username),clientIp(c));if(!loginAllowed(key))return jsonErr(c,'Too many login attempts. Try again later.',429);const u=await c.env.DB.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND active=1').bind(String(username).trim()).first<LoginUser>();const verification=u?await verifyPassword(u.password_hash,String(password)):null;if(!u||!verification?.valid){loginFailure(key);return jsonErr(c,'Invalid username or password',401)}loginSuccess(key);if(verification.legacy)await c.env.DB.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(await hashPassword(String(password)),u.id).run();
 const token=makeToken(c.env.SESSION_SECRET,'u',u.id);setCookie(c,'user_session',token,{httpOnly:true,secure:true,sameSite:'None',path:'/',maxAge:28800});return c.json({ok:true,token,user:{id:u.id,username:u.username,display_name:u.display_name,mobile:u.mobile,user_type:u.user_type,permissions:JSON.parse(u.permissions_json||'[]')}})
})
app.get('/me',async c=>{const a=await authAs(c,'USER');if(!a)return jsonErr(c,'Unauthorized',401);return c.json({admin:false,user:{...a.user,permissions:JSON.parse(a.user!.permissions_json||'[]')}})})
app.get('/admin/me',async c=>{const a=await authAs(c,'ADMIN');if(!a)return jsonErr(c,'Unauthorized',401);return c.json({admin:true,permissions:ALL_PERMISSIONS})})
app.post('/change-password',async c=>{const a=await auth(c);if(!a||a.kind!=='USER')return jsonErr(c,'Unauthorized',401);const b=await c.req.json();if(!validText(b.new_password,256))return jsonErr(c,'Invalid password');await c.env.DB.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(await hashPassword(b.new_password),a.user!.id).run();return c.json({ok:true})})

app.get('/my/bookings',async c=>{const a=await auth(c);if(!a||a.kind!=='USER')return jsonErr(c,'Unauthorized',401);if(!hasPerm(a,'view_own_reservations'))return jsonErr(c,'Permission denied',403);const {results}=await c.env.DB.prepare(`SELECT b.*,u.display_name AS assigned_name FROM bookings b LEFT JOIN users u ON u.id=b.assigned_to_user_id WHERE b.created_by_user_id=? OR b.assigned_to_user_id=? ORDER BY b.created_at DESC LIMIT 500`).bind(a.user!.id,a.user!.id).all();return c.json({bookings:results||[]})})

app.get('/me/performance',async c=>{const a=await auth(c);if(!a||a.kind!=='USER')return jsonErr(c,'Unauthorized',401);if(!hasPerm(a,'view_own_reservations'))return jsonErr(c,'Permission denied',403);const range=reportRange(c);if(!range)return jsonErr(c,'A valid date range up to 366 days is required');const {results}=await c.env.DB.prepare(`SELECT * FROM bookings WHERE DATE(created_at) BETWEEN ? AND ? AND (created_by_user_id=? OR assigned_to_user_id=?) ORDER BY created_at DESC LIMIT 5000`).bind(range.from,range.to,a.user!.id,a.user!.id).all();const rows=results||[];const doneRows=rows.filter((b:any)=>b.status==='DONE');const acceptedRows=rows.filter((b:any)=>['ACCEPTED','CONFIRMED','DONE'].includes(b.status));const confirmedRows=rows.filter((b:any)=>['CONFIRMED','DONE'].includes(b.status));const testCount=rows.reduce((n:number,b:any)=>n+bookingTestCount(b),0);const finalized=doneRows.filter((b:any)=>Number(b.commission_owner_user_id)===a.user!.id).reduce((n:number,b:any)=>n+Number(b.commission_amount||0),0);const extras=Number((await c.env.DB.prepare(`SELECT COALESCE(SUM(e.commission_amount),0) AS amount FROM booking_extra_tests e JOIN bookings b ON b.reference=e.booking_reference WHERE e.added_by_user_id=? AND b.status='DONE' AND DATE(b.created_at) BETWEEN ? AND ?`).bind(a.user!.id,range.from,range.to).first<any>())?.amount||0);const paid=Number((await c.env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM commission_payments WHERE user_id=? AND DATE(paid_at) BETWEEN ? AND ?').bind(a.user!.id,range.from,range.to).first<any>())?.amount||0);const visit=Number((await c.env.DB.prepare(`SELECT COALESCE(SUM(visit_fee_amount),0) AS amount FROM bookings WHERE assigned_to_user_id=? AND created_by_type='SALESMAN' AND status='DONE' AND DATE(created_at) BETWEEN ? AND ?`).bind(a.user!.id,range.from,range.to).first<any>())?.amount||0);return c.json({from:range.from,to:range.to,bookings:rows.length,patients:rows.length,tests:testCount,accepted:acceptedRows.length,confirmed:confirmedRows.length,done:doneRows.length,completion_rate:rows.length?doneRows.length/rows.length:0,earned_commission:finalized+extras,paid_commission:paid,outstanding_commission:Math.max(0,finalized+extras-paid),extra_test_commission:extras,visit_fees:visit})})

app.get('/me/targets',async c=>{const a=await auth(c);if(!a||a.kind!=='USER')return jsonErr(c,'Unauthorized',401);if(!hasPerm(a,'view_own_reservations'))return jsonErr(c,'Permission denied',403);const todayKey=dateKey(new Date());const {results}=await c.env.DB.prepare('SELECT * FROM targets WHERE user_id=? AND active=1 AND period_start<=? AND period_end>=? ORDER BY period_start DESC LIMIT 12').bind(a.user!.id,todayKey,todayKey).all();return c.json({targets:await Promise.all((results||[]).map(target=>targetWithProgress(c.env.DB,target)))})
})

app.get('/admin/statistics',async c=>{const a=await auth(c);if(!a||!hasPerm(a,'view_all_reservations'))return jsonErr(c,'Unauthorized',401);const range=reportRange(c);if(!range)return jsonErr(c,'A valid date range up to 366 days is required');const rows=(await c.env.DB.prepare(`SELECT * FROM bookings WHERE DATE(created_at) BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 5000`).bind(range.from,range.to).all()).results||[];const statusCounts:any={PENDING:0,ASSIGNED:0,ACCEPTED:0,CONFIRMED:0,DONE:0};for(const b of rows as any[])if(statusCounts[b.status]!==undefined)statusCounts[b.status]++;const testCount=rows.reduce((n:number,b:any)=>n+bookingTestCount(b),0);const bookingValue=rows.reduce((n:number,b:any)=>n+Number(b.total||0),0);const extras=Number((await c.env.DB.prepare(`SELECT COALESCE(SUM(e.price),0) AS amount,COALESCE(SUM(e.commission_amount),0) AS commission FROM booking_extra_tests e JOIN bookings b ON b.reference=e.booking_reference WHERE DATE(b.created_at) BETWEEN ? AND ?`).bind(range.from,range.to).first<any>())?.amount||0);const extraCommission=Number((await c.env.DB.prepare(`SELECT COALESCE(SUM(e.commission_amount),0) AS amount FROM booking_extra_tests e JOIN bookings b ON b.reference=e.booking_reference WHERE DATE(b.created_at) BETWEEN ? AND ?`).bind(range.from,range.to).first<any>())?.amount||0);const finalized=rows.filter((b:any)=>b.status==='DONE').reduce((n:number,b:any)=>n+Number(b.commission_amount||0),0);const accrued=rows.filter((b:any)=>b.status!=='DONE').reduce((n:number,b:any)=>n+Number(b.commission_amount||0),0);const paid=Number((await c.env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM commission_payments WHERE DATE(paid_at) BETWEEN ? AND ?').bind(range.from,range.to).first<any>())?.amount||0);const visitFees=rows.filter((b:any)=>b.status==='DONE'&&b.created_by_type==='SALESMAN').reduce((n:number,b:any)=>n+Number(b.visit_fee_amount||0),0);const users=(await c.env.DB.prepare('SELECT id,display_name,user_type FROM users ORDER BY display_name').all()).results||[];const perUser=(users as any[]).map(user=>{const own=rows.filter((b:any)=>Number(b.created_by_user_id)===user.id||Number(b.assigned_to_user_id)===user.id);const assigned=rows.filter((b:any)=>Number(b.assigned_to_user_id)===user.id);const done=own.filter((b:any)=>b.status==='DONE');const commission=done.filter((b:any)=>Number(b.commission_owner_user_id)===user.id).reduce((n:number,b:any)=>n+Number(b.commission_amount||0),0);return {id:user.id,display_name:user.display_name,user_type:user.user_type,bookings:own.length,patients:own.length,accepted:own.filter((b:any)=>['ACCEPTED','CONFIRMED','DONE'].includes(b.status)).length,confirmed:own.filter((b:any)=>['CONFIRMED','DONE'].includes(b.status)).length,done:done.length,completion_rate:own.length?done.length/own.length:0,assigned:assigned.length,commission,assignment_workload:assigned.length}});return c.json({from:range.from,to:range.to,patients:rows.length,tests:testCount,booking_value:bookingValue,bookings_by_status:statusCounts,completion_rate:rows.length?statusCounts.DONE/rows.length:0,accrued_unfinalized_commission:accrued,finalized_commission:finalized,extra_tests:extras,extra_test_commission:extraCommission,paid_commission:paid,outstanding_commission:Math.max(0,finalized+extraCommission-paid),earned_visit_fees:visitFees,users:perUser})})
app.get('/admin/targets',async c=>{const a=await auth(c);if(!a||!hasPerm(a,'manage_targets'))return jsonErr(c,'Unauthorized',401);const userParam=c.req.query('user_id');const userId=userParam?validUserId(userParam):null;if(userParam&&!userId)return jsonErr(c,'Invalid user');const from=c.req.query('from'),to=c.req.query('to');if((from&&!validDateKey(from))||(to&&!validDateKey(to)))return jsonErr(c,'Invalid target period');if(from&&to&&from>to)return jsonErr(c,'Invalid target period');const filters:string[]=[];const params:any[]=[];if(userId){filters.push('t.user_id=?');params.push(userId)}if(from){filters.push('t.period_end>=?');params.push(from)}if(to){filters.push('t.period_start<=?');params.push(to)}const where=filters.length?`WHERE ${filters.join(' AND ')}`:'';const rows=await c.env.DB.prepare(`SELECT t.*,u.display_name,u.username,u.user_type FROM targets t JOIN users u ON u.id=t.user_id ${where} ORDER BY t.period_start DESC,u.display_name LIMIT 500`).bind(...params).all();return c.json({targets:await Promise.all((rows.results||[]).map(target=>targetWithProgress(c.env.DB,target)))})})
app.post('/admin/targets',async c=>{const a=await auth(c);if(!a||!hasPerm(a,'manage_targets'))return jsonErr(c,'Unauthorized',401);const b=await c.req.json();const userId=validUserId(b.user_id);if(!userId||!await userById(c.env.DB,userId)||!validDateKey(b.period_start)||!validDateKey(b.period_end)||b.period_start>b.period_end||b.metric!=='PATIENTS'||!validTargetValue(b.target_value))return jsonErr(c,'Invalid target');try{const r=await c.env.DB.prepare('INSERT INTO targets(user_id,period_start,period_end,metric,target_value,active) VALUES(?,?,?,?,?,?)').bind(userId,b.period_start,b.period_end,b.metric,Number(b.target_value),b.active===false?0:1).run();return c.json({ok:true,id:r.meta.last_row_id})}catch{return jsonErr(c,'A target already exists for this user and period',409)}})
app.put('/admin/targets/:id',async c=>{const a=await auth(c);if(!a||!hasPerm(a,'manage_targets'))return jsonErr(c,'Unauthorized',401);const id=validUserId(c.req.param('id'));if(!id)return jsonErr(c,'Invalid target');const b=await c.req.json();const userId=validUserId(b.user_id);if(!userId||!await userById(c.env.DB,userId)||!validDateKey(b.period_start)||!validDateKey(b.period_end)||b.period_start>b.period_end||b.metric!=='PATIENTS'||!validTargetValue(b.target_value))return jsonErr(c,'Invalid target');try{const r=await c.env.DB.prepare('UPDATE targets SET user_id=?,period_start=?,period_end=?,metric=?,target_value=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(userId,b.period_start,b.period_end,b.metric,Number(b.target_value),b.active===false?0:1,id).run();if(!r.meta.changes)return jsonErr(c,'Target not found',404);return c.json({ok:true})}catch{return jsonErr(c,'A target already exists for this user and period',409)}})
app.delete('/admin/targets/:id',async c=>{const a=await auth(c);if(!a||!hasPerm(a,'manage_targets'))return jsonErr(c,'Unauthorized',401);const id=validUserId(c.req.param('id'));if(!id)return jsonErr(c,'Invalid target');const r=await c.env.DB.prepare('DELETE FROM targets WHERE id=?').bind(id).run();if(!r.meta.changes)return jsonErr(c,'Target not found',404);return c.json({ok:true})})

app.get('/bookings/:reference',async c=>{const a=await auth(c);if(!a)return jsonErr(c,'Unauthorized',401);const ref=String(c.req.param('reference'));const b=await bookingByRef(c.env.DB,ref);if(!b)return jsonErr(c,'Booking not found',404);if(a.kind==='USER'&&!hasPerm(a,'view_all_reservations')&&b.created_by_user_id!==a.user!.id&&b.assigned_to_user_id!==a.user!.id)return jsonErr(c,'Forbidden',403);const assigned=b.assigned_to_user_id?await userById(c.env.DB,Number(b.assigned_to_user_id)):null;const extras=(await c.env.DB.prepare('SELECT * FROM booking_extra_tests WHERE booking_reference=? ORDER BY added_at ASC').bind(ref).all()).results||[];return c.json({booking:{...b,assigned_name:assigned?.display_name||null},extra_tests:extras})})

async function transition(c:AppContext,ref:string,to:string){const a=await auth(c);if(!a)return jsonErr(c,'Unauthorized',401);const b=await bookingByRef(c.env.DB,ref);if(!b)return jsonErr(c,'Booking not found',404);const from=String(b.status||'PENDING');if(!isValidBookingStatus(from))return jsonErr(c,'Booking has invalid status',409);if(!isValidBookingStatus(to))return jsonErr(c,'Invalid status');if(a.kind==='ADMIN'){/* controlled admin correction allowed */}else{
 if(BOOKING_STATUS_ORDER[to]<BOOKING_STATUS_ORDER[from])return jsonErr(c,'Status cannot move backwards',409)
 if(to==='ACCEPTED'&&(!hasPerm(a,'accept_assigned_reservations')||Number(b.assigned_to_user_id)!==a.user!.id))return jsonErr(c,'Permission denied',403)
 if(to==='CONFIRMED'&&(!hasPerm(a,'confirm_visits')||Number(b.assigned_to_user_id)!==a.user!.id))return jsonErr(c,'Permission denied',403)
 if(to==='DONE'&&(!hasPerm(a,'mark_visits_done')||Number(b.assigned_to_user_id)!==a.user!.id))return jsonErr(c,'Permission denied',403)
 if(to==='ASSIGNED')return jsonErr(c,'Only admin can assign reservations',403)
}
 const ts:any={};if(to==='ACCEPTED')ts.accepted_at=nowIso();if(to==='CONFIRMED')ts.confirmed_at=nowIso();if(to==='DONE')ts.done_at=nowIso();
 if(to==='CONFIRMED'&&!isFinalizedBooking(b)&&b.created_by_type==='SALESMAN'&&b.assigned_to_user_id){const assigned=await userById(c.env.DB,Number(b.assigned_to_user_id));const s=await settings(c.env.DB);ts.visit_fee_rate=assigned?.user_type==='DOCTOR'?Number(s.doctor_visit_fee):assigned?.user_type==='REP'?Number(s.rep_visit_fee):0;ts.visit_fee_amount=ts.visit_fee_rate;ts.visit_fee_earned_at=nowIso()}
 if(to==='DONE')await recomputeBooking(c.env.DB,ref,true)
 await c.env.DB.prepare(`UPDATE bookings SET status=?,accepted_at=COALESCE(?,accepted_at),confirmed_at=COALESCE(?,confirmed_at),done_at=COALESCE(?,done_at),visit_fee_rate=COALESCE(?,visit_fee_rate),visit_fee_amount=COALESCE(?,visit_fee_amount),visit_fee_earned_at=COALESCE(?,visit_fee_earned_at),updated_at=CURRENT_TIMESTAMP WHERE reference=?`).bind(to,ts.accepted_at||null,ts.confirmed_at||null,ts.done_at||null,ts.visit_fee_rate??null,ts.visit_fee_amount??null,ts.visit_fee_earned_at||null,ref).run()
 await c.env.DB.prepare('INSERT INTO booking_status_history(booking_reference,from_status,to_status,changed_by_user_id,changed_by_type) VALUES(?,?,?,?,?)').bind(ref,from,to,a.kind==='USER'?a.user!.id:null,a.kind).run()
 if(to!=='DONE')await recomputeBooking(c.env.DB,ref);return c.json({ok:true,status:to})
}
app.post('/bookings/:reference/status',async c=>{const b=await c.req.json();return transition(c,String(c.req.param('reference')),String(b.status||''))})

app.put('/bookings/:reference',async c=>{const a=await auth(c);if(!a)return jsonErr(c,'Unauthorized',401);const ref=String(c.req.param('reference'));const old=await bookingByRef(c.env.DB,ref);if(!old)return jsonErr(c,'Booking not found',404)
 if(isFinalizedBooking(old))return jsonErr(c,'Finalized reservations cannot be edited',409)
 const isAdmin=a.kind==='ADMIN';const ownPending=a.kind==='USER'&&old.created_by_user_id===a.user!.id&&old.status==='PENDING'&&hasPerm(a,'edit_own_pending_reservations')&&(!old.edit_deadline||new Date(old.edit_deadline).getTime()>=Date.now());const confirmedAssigned=a.kind==='USER'&&old.assigned_to_user_id===a.user!.id&&old.status==='CONFIRMED'&&hasPerm(a,'edit_confirmed_assigned_reservations');if(!isAdmin&&!ownPending&&!confirmedAssigned)return jsonErr(c,'You cannot edit this reservation',403)
 const b=await c.req.json();const candidate={patient_name:b.patient_name??old.patient_name,age:b.age??old.age,gender:b.gender??old.gender,phone:b.phone??old.phone,preferred_at:b.preferred_at??old.preferred_at,tests:b.tests};if(!validBookingFields(candidate))return jsonErr(c,'Invalid booking');const codes=uniqueStrings(b.tests.map((x:any)=>x.code)).slice(0,100)
 const ph=codes.map(()=>'?').join(',');const {results}=await c.env.DB.prepare(`SELECT test_no,analysis_name,unit,ref_range,specimen,duration,price,contract_price,patient_price FROM tests WHERE active=1 AND test_no IN (${ph})`).bind(...codes).all();const map=new Map((results||[]).map((x:any)=>[String(x.test_no),x]));const oldTests=JSON.parse(old.tests_json||'[]');const oldMap=new Map(oldTests.map((x:any)=>[String(x.test_no),x]));if(old.status==='CONFIRMED'&&!isAdmin){const added=codes.filter(code=>!oldMap.has(code));if(added.length)return jsonErr(c,'New tests during a confirmed visit must be added as Extra Tests',409)}const selected=codes.map(code=>oldMap.get(code)||map.get(code)).filter(Boolean);if(selected.length!==codes.length)return jsonErr(c,'One or more tests are invalid')
 const total=selected.reduce((s:number,t:any)=>s+Number(t.patient_price||0),0);await c.env.DB.prepare(`UPDATE bookings SET patient_name=?,age=?,gender=?,phone=?,preferred_at=?,address=?,tests_json=?,total=?,original_total=?,updated_at=CURRENT_TIMESTAMP WHERE reference=?`).bind(String(b.patient_name??old.patient_name).trim(),Number(b.age??old.age)||null,b.gender??old.gender??null,String(b.phone??old.phone).trim(),b.preferred_at??old.preferred_at??null,b.address??old.address??null,JSON.stringify(selected),total,total,ref).run()
 await recomputeBooking(c.env.DB,ref);return c.json({ok:true,reference:ref,total})
})

app.post('/bookings/:reference/extra-tests',async c=>{
 const a=await auth(c);if(!a||a.kind!=='USER'||!hasPerm(a,'add_extra_tests'))return jsonErr(c,'Permission denied',403)
 const ref=String(c.req.param('reference'));const b=await bookingByRef(c.env.DB,ref)
 if(!b||Number(b.assigned_to_user_id)!==a.user!.id||b.status!=='CONFIRMED')return jsonErr(c,'Extra tests can only be added by the assigned user after confirmation',403)
 const body=await c.req.json();if(!validTests(body.tests))return jsonErr(c,'Invalid extra tests');const codes=uniqueStrings(body.tests.map((x:any)=>x.code)).slice(0,100);if(!codes.length)return jsonErr(c,'No extra tests selected')
 const ph=codes.map(()=>'?').join(',');const {results}=await c.env.DB.prepare(`SELECT test_no,analysis_name,specimen,patient_price FROM tests WHERE active=1 AND test_no IN (${ph})`).bind(...codes).all();const map=new Map((results||[]).map((x:any)=>[String(x.test_no),x]));
 const existing=new Set((await c.env.DB.prepare('SELECT test_no FROM booking_extra_tests WHERE booking_reference=?').bind(ref).all()).results?.map((x:any)=>String(x.test_no))||[])
 const original=new Set((JSON.parse(b.tests_json||'[]')).map((x:any)=>String(x.test_no)))
 const s=await settings(c.env.DB);const rows=[]
 for(const code of codes){if(original.has(code)||existing.has(code))continue;const t=map.get(code);if(!t)continue;const price=Number(t.patient_price||0);const rate=Number(s.extra_tests_rate||0.05);rows.push({t,price,rate,amount:price*rate})}
 if(!rows.length)return jsonErr(c,'No new extra tests were selected')
 for(const x of rows)await c.env.DB.prepare('INSERT INTO booking_extra_tests(booking_reference,test_no,analysis_name,specimen,price,commission_rate,commission_amount,added_by_user_id) VALUES(?,?,?,?,?,?,?,?)').bind(ref,String(x.t.test_no),String(x.t.analysis_name),String(x.t.specimen||''),x.price,x.rate,x.amount,a.user!.id).run()
 const extraTotal=rows.reduce((n,x)=>n+x.price,0);const extraCommission=rows.reduce((n,x)=>n+x.amount,0)
 await c.env.DB.prepare('UPDATE bookings SET total=total+?,extra_tests_commission_amount=extra_tests_commission_amount+?,updated_at=CURRENT_TIMESTAMP WHERE reference=?').bind(extraTotal,extraCommission,ref).run()
 return c.json({ok:true,added:rows.map(x=>({test_no:x.t.test_no,analysis_name:x.t.analysis_name,price:x.price,commission_amount:x.amount})),extra_total:extraTotal,extra_commission:extraCommission})
})

app.post('/admin/login',async c=>{const {password}=await c.req.json();if(!validText(password,256))return jsonErr(c,'Invalid password',401);const key=loginKey('admin','admin',clientIp(c));if(!loginAllowed(key))return jsonErr(c,'Too many login attempts. Try again later.',429);await ensureAdminTable(c.env.DB);const row=await c.env.DB.prepare('SELECT password_hash FROM admin_users WHERE id=1').first<any>();const stored=row?.password_hash||c.env.ADMIN_PASSWORD_HASH;const verification=stored?await verifyPassword(stored,String(password)):null;if(!stored||!verification?.valid){loginFailure(key);return jsonErr(c,'Invalid password',401)}loginSuccess(key);if(verification.legacy||!row?.password_hash)await c.env.DB.prepare('INSERT OR REPLACE INTO admin_users(id,password_hash,updated_at) VALUES(1,?,CURRENT_TIMESTAMP)').bind(await hashPassword(String(password))).run();const token=makeToken(c.env.SESSION_SECRET,'a');setCookie(c,'admin_session',token,{httpOnly:true,secure:true,sameSite:'None',path:'/',maxAge:28800});return c.json({ok:true,token})})
app.post('/admin/change-password',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const {current_password,new_password}=await c.req.json();if(!validText(current_password,256)||!validText(new_password,256))return jsonErr(c,'Invalid password');await ensureAdminTable(c.env.DB);const row=await c.env.DB.prepare('SELECT password_hash FROM admin_users WHERE id=1').first<any>();const stored=row?.password_hash||c.env.ADMIN_PASSWORD_HASH;const verification=stored?await verifyPassword(stored,String(current_password)):null;if(!stored||!verification?.valid)return jsonErr(c,'Current password is incorrect',401);await c.env.DB.prepare('INSERT OR REPLACE INTO admin_users(id,password_hash,updated_at) VALUES(1,?,CURRENT_TIMESTAMP)').bind(await hashPassword(new_password),).run();return c.json({ok:true})})

app.get('/admin/bookings',async c=>{const a=await auth(c);if(!hasPerm(a,'view_all_reservations'))return jsonErr(c,'Unauthorized',401);const {results}=await c.env.DB.prepare(`SELECT b.*,cu.display_name AS creator_name,au.display_name AS assigned_name FROM bookings b LEFT JOIN users cu ON cu.id=b.created_by_user_id LEFT JOIN users au ON au.id=b.assigned_to_user_id ORDER BY CASE WHEN b.preferred_at IS NULL OR b.preferred_at='' THEN 1 ELSE 0 END,b.preferred_at ASC,b.created_at DESC LIMIT 500`).all();return c.json({bookings:results||[]})})

app.post('/admin/bookings/:reference/assign',async c=>{const a=await auth(c);if(!a)return jsonErr(c,'Unauthorized',401);if(!hasPerm(a,'assign_reservations'))return jsonErr(c,'Permission denied',403);const ref=String(c.req.param('reference'));const b=await bookingByRef(c.env.DB,ref);if(!b)return jsonErr(c,'Booking not found',404);if(isFinalizedBooking(b))return jsonErr(c,'Finalized bookings cannot be reassigned',409);const {user_id}=await c.req.json();const id=Number(user_id);if(!Number.isInteger(id)||id<=0)return jsonErr(c,'Invalid user');const u=await userById(c.env.DB,id);if(!u||!u.active||!['DOCTOR','REP'].includes(u.user_type))return jsonErr(c,'Reservation can only be assigned to an active Doctor or Rep');await c.env.DB.prepare(`UPDATE bookings SET assigned_to_user_id=?,assigned_at=CURRENT_TIMESTAMP,assigned_by_user_id=?,status=CASE WHEN status='PENDING' THEN 'ASSIGNED' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE reference=?`).bind(id,a.kind==='USER'?a.user!.id:null,ref).run();await c.env.DB.prepare('INSERT INTO booking_assignment_history(booking_reference,from_user_id,to_user_id,assigned_by_user_id) VALUES(?,?,?,?)').bind(ref,b.assigned_to_user_id||null,id,a.kind==='USER'?a.user!.id:null).run();if(b.status==='PENDING')await c.env.DB.prepare('INSERT INTO booking_status_history(booking_reference,from_status,to_status,changed_by_user_id,changed_by_type) VALUES(?,?,?,?,?)').bind(ref,'PENDING','ASSIGNED',null,'ADMIN').run();await recomputeBooking(c.env.DB,ref);return c.json({ok:true,status:b.status==='PENDING'?'ASSIGNED':b.status,assigned_to_user_id:id})})
app.post('/admin/bookings/:reference/status',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const body=await c.req.json();return transition(c,String(c.req.param('reference')),String(body.status||''))})

app.delete('/admin/bookings/:reference',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const ref=String(c.req.param('reference'));const b=await bookingByRef(c.env.DB,ref);if(!b)return jsonErr(c,'Booking not found',404);if(isFinalizedBooking(b))return jsonErr(c,'Finalized bookings cannot be deleted',409);await c.env.DB.batch([c.env.DB.prepare('DELETE FROM booking_extra_tests WHERE booking_reference=?').bind(ref),c.env.DB.prepare('DELETE FROM booking_status_history WHERE booking_reference=?').bind(ref),c.env.DB.prepare('DELETE FROM booking_assignment_history WHERE booking_reference=?').bind(ref),c.env.DB.prepare('DELETE FROM bookings WHERE reference=?').bind(ref)]);return c.json({ok:true,reference:ref})})

app.get('/admin/users',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const {results}=await c.env.DB.prepare('SELECT id,username,display_name,mobile,user_type,active,permissions_json,created_at,updated_at FROM users ORDER BY display_name').all();return c.json({users:(results||[]).map((u:any)=>({...u,permissions:JSON.parse(u.permissions_json||'[]')})),permissions:ALL_PERMISSIONS})})
app.post('/admin/users',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const b=await c.req.json();if(!validText(b.username,128)||!validName(b.display_name)||!validText(b.password,256)||!validPermissions(b.permissions)||!['DOCTOR','REP','SALESMAN'].includes(b.user_type)||!(!b.mobile||validPhone(b.mobile)))return jsonErr(c,'Invalid user');const permissions=uniqueStrings(b.permissions);try{const r=await c.env.DB.prepare('INSERT INTO users(username,display_name,password_hash,mobile,user_type,active,permissions_json) VALUES(?,?,?,?,?,?,?)').bind(String(b.username).trim(),String(b.display_name).trim(),await hashPassword(b.password),String(b.mobile||''),b.user_type,b.active===false?0:1,JSON.stringify(permissions)).run();return c.json({ok:true,id:r.meta.last_row_id})}catch{return jsonErr(c,'Username already exists',409)}})
app.put('/admin/users/:id',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const id=Number(c.req.param('id'));if(!Number.isInteger(id)||id<=0)return jsonErr(c,'Invalid user');const b=await c.req.json();if(!validText(b.username,128)||!validName(b.display_name)||!validPermissions(b.permissions)||!['DOCTOR','REP','SALESMAN'].includes(b.user_type)||!(!b.mobile||validPhone(b.mobile))||!!b.password&&!validText(b.password,256))return jsonErr(c,'Invalid user');const permissions=uniqueStrings(b.permissions);await c.env.DB.prepare('UPDATE users SET username=?,display_name=?,mobile=?,user_type=?,active=?,permissions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(String(b.username).trim(),String(b.display_name).trim(),String(b.mobile||''),b.user_type,b.active?1:0,JSON.stringify(permissions),id).run();if(b.password)await c.env.DB.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(await hashPassword(b.password),id).run();return c.json({ok:true})})

app.get('/admin/commission-settings',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);return c.json({settings:await settings(c.env.DB)})})
app.put('/admin/commission-settings',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const b=await c.req.json();const keys=['salesman_base_rate','salesman_bonus_rate','doctor_base_rate','doctor_bonus_rate','rep_base_rate','rep_bonus_rate','extra_tests_rate','daily_patient_threshold','doctor_visit_fee','rep_visit_fee','edit_pending_hours'];const vals=keys.map(k=>Number(b[k]));if(vals.some(v=>!Number.isFinite(v)||v<0))return jsonErr(c,'Invalid commission settings');await c.env.DB.prepare(`UPDATE commission_settings SET salesman_base_rate=?,salesman_bonus_rate=?,doctor_base_rate=?,doctor_bonus_rate=?,rep_base_rate=?,rep_bonus_rate=?,extra_tests_rate=?,daily_patient_threshold=?,doctor_visit_fee=?,rep_visit_fee=?,edit_pending_hours=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).bind(...vals).run();return c.json({ok:true,settings:await settings(c.env.DB)})})

app.get('/admin/financials',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const users=(await c.env.DB.prepare(`SELECT id,display_name,user_type FROM users WHERE active=1 ORDER BY display_name`).all()).results||[];const out=[];for(const u of users as any[]){const accrued=await c.env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS amount FROM bookings WHERE status!='DONE' AND commission_owner_user_id=?`).bind(u.id).first<any>();const finalized=await c.env.DB.prepare(`SELECT COALESCE(SUM(commission_amount),0) AS amount FROM bookings WHERE status='DONE' AND commission_owner_user_id=?`).bind(u.id).first<any>();const extra=await c.env.DB.prepare(`SELECT COALESCE(SUM(e.commission_amount),0) AS amount FROM booking_extra_tests e JOIN bookings b ON b.reference=e.booking_reference WHERE e.added_by_user_id=? AND b.status='DONE'`).bind(u.id).first<any>();const visit=await c.env.DB.prepare(`SELECT COALESCE(SUM(visit_fee_amount),0) AS amount FROM bookings WHERE status='DONE' AND assigned_to_user_id=? AND created_by_type='SALESMAN'`).bind(u.id).first<any>();const paid=await c.env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM commission_payments WHERE user_id=?').bind(u.id).first<any>();const visitPaid=await c.env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM visit_fee_payments WHERE user_id=?').bind(u.id).first<any>();const accruedAmount=Number(accrued?.amount||0),finalizedAmount=Number(finalized?.amount||0),extraAmount=Number(extra?.amount||0),visitAmount=Number(visit?.amount||0),paidAmount=Number(paid?.amount||0),visitPaidAmount=Number(visitPaid?.amount||0);out.push({...u,accrued_unfinalized_commission:accruedAmount,finalized_commission:finalizedAmount,extra_test_commission:extraAmount,earned_visit_fees:visitAmount,paid_commission:paidAmount,paid_visit_fees:visitPaidAmount,outstanding_commission:Math.max(0,finalizedAmount+extraAmount-paidAmount),outstanding_visit_fees:Math.max(0,visitAmount-visitPaidAmount)})}return c.json({users:out})})
app.post('/admin/payments/commission',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const b=await c.req.json();const uid=Number(b.user_id),amount=Number(b.amount);if(!uid||!Number.isFinite(amount)||amount<=0)return jsonErr(c,'Invalid payment');const done=await c.env.DB.prepare(`SELECT COALESCE(SUM(commission_amount + extra_tests_commission_amount),0) AS n FROM bookings WHERE status='DONE' AND commission_owner_user_id=?`).bind(uid).first<any>();const paid=await c.env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM commission_payments WHERE user_id=?').bind(uid).first<any>();if(amount>Number(done?.n||0)-Number(paid?.n||0)+0.000001)return jsonErr(c,'Payment exceeds outstanding commission',409);await c.env.DB.prepare('INSERT INTO commission_payments(user_id,amount,paid_by_user_id,note) VALUES(?,?,?,?)').bind(uid,amount,null,String(b.note||'')).run();return c.json({ok:true})})
app.post('/admin/payments/visit-fee',async c=>{const a=await auth(c);if(!a||a.kind!=='ADMIN')return jsonErr(c,'Unauthorized',401);const b=await c.req.json();const uid=Number(b.user_id),amount=Number(b.amount);if(!uid||!Number.isFinite(amount)||amount<=0)return jsonErr(c,'Invalid payment');const earned=await c.env.DB.prepare(`SELECT COALESCE(SUM(visit_fee_amount),0) AS n FROM bookings WHERE status='DONE' AND assigned_to_user_id=? AND created_by_type='SALESMAN'`).bind(uid).first<any>();const paid=await c.env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM visit_fee_payments WHERE user_id=?').bind(uid).first<any>();if(amount>Number(earned?.n||0)-Number(paid?.n||0)+0.000001)return jsonErr(c,'Payment exceeds outstanding visit fees',409);await c.env.DB.prepare('INSERT INTO visit_fee_payments(user_id,amount,paid_by_user_id,note) VALUES(?,?,?,?)').bind(uid,amount,null,String(b.note||'')).run();return c.json({ok:true})})

app.get('/admin/tests',async c=>{const a=await auth(c);if(!hasPerm(a,'manage_catalog'))return jsonErr(c,'Unauthorized',401);const q=String(c.req.query('q')||'').trim().toLowerCase();if(!q)return c.json({tests:[]});const like=`%${q}%`;const {results}=await c.env.DB.prepare(`SELECT test_no,analysis_name,unit,specimen,patient_price,active FROM tests WHERE active=1 AND (LOWER(test_no) LIKE ? OR LOWER(analysis_name) LIKE ? OR LOWER(unit) LIKE ? OR LOWER(specimen) LIKE ?) ORDER BY analysis_name LIMIT 5`).bind(like,like,like,like).all();return c.json({tests:results||[]})})
app.post('/admin/tests/price',async c=>{const a=await auth(c);if(!hasPerm(a,'manage_catalog'))return jsonErr(c,'Unauthorized',401);const b=await c.req.json();const n=String(b.test_no||'').trim(),p=Number(b.patient_price);if(!n||!Number.isFinite(p)||p<0)return jsonErr(c,'Invalid test number or price');const r=await c.env.DB.prepare('UPDATE tests SET patient_price=?,price=?,updated_at=CURRENT_TIMESTAMP WHERE test_no=?').bind(p,p,n).run();if(!r.meta.changes)return jsonErr(c,'Test not found',404);return c.json({ok:true,test_no:n,patient_price:p})})
app.post('/admin/tests/import',async c=>{const a=await auth(c);if(!hasPerm(a,'manage_catalog'))return jsonErr(c,'Unauthorized',401);const {tests}=await c.req.json();if(!Array.isArray(tests)||tests.length>5000)return jsonErr(c,'Invalid catalog');const statements=[];for(const t of tests){if(!t.test_no||!t.analysis_name||!Number.isFinite(Number(t.patient_price)))return jsonErr(c,`Invalid row: ${t.test_no||t.analysis_name||'unknown'}`);statements.push(c.env.DB.prepare(`INSERT INTO tests(test_no,analysis_name,unit,ref_range,specimen,duration,price,contract_price,patient_price,active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(test_no) DO UPDATE SET analysis_name=excluded.analysis_name,unit=excluded.unit,ref_range=excluded.ref_range,specimen=excluded.specimen,duration=excluded.duration,price=excluded.price,contract_price=excluded.contract_price,patient_price=excluded.patient_price,active=1,updated_at=CURRENT_TIMESTAMP`).bind(String(t.test_no),String(t.analysis_name),String(t.unit||''),String(t.ref_range||''),String(t.specimen||''),Number(t.duration)||0,Number(t.price)||Number(t.patient_price)||0,Number(t.contract_price)||0,Number(t.patient_price)))}await c.env.DB.batch(statements);return c.json({count:tests.length})})

app.get('/health',c=>c.json({ok:true,version:'1.3.0'}))
export default app

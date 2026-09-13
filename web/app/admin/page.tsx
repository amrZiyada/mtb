'use client'
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../../lib/api'
import { APP_VERSION } from '../../lib/version'

const sourceHeaders = ['#', 'Analysis name', 'Unit', 'Ref. range', 'Specimen', 'Duration', 'Price', 'Contract', 'Patient']
const requiredHeaders = ['#', 'Analysis name', 'Unit', 'Ref. range', 'Specimen', 'Duration', 'Price']
const textColumns = ['Unit', 'Ref. range', 'Specimen']
const keyMap:any = {'#':'test_no','Analysis name':'analysis_name','Unit':'unit','Ref. range':'ref_range','Specimen':'specimen','Duration':'duration','Price':'price','Contract':'contract_price','Patient':'patient_price'}

function cell(row:any[], index:number) { const v=row[index]; return v===null||v===undefined?'':String(v).trim() }
function numberValue(value:any) { if(typeof value==='number') return value; const text=String(value??'').trim().replace(/,/g,''); if(!text)return NaN; const n=Number(text); return Number.isFinite(n)?n:NaN }
function appendText(current:string,next:string){if(!next)return current;if(!current)return next;return current.includes(next)?current:`${current}\n${next}`}
function parseLaboratoryPriceList(ws:XLSX.WorkSheet){
 const matrix=XLSX.utils.sheet_to_json<any[]>(ws,{header:1,defval:'',raw:true})
 const headerIndex=matrix.findIndex(row=>requiredHeaders.every(header=>row.some((v:any)=>String(v??'').trim()===header)))
 if(headerIndex<0) throw new Error(`Could not find the approved price-list header: ${requiredHeaders.join(' · ')}`)
 const header=matrix[headerIndex]; const columns:any={}
 for(const name of requiredHeaders) columns[name]=header.findIndex((v:any)=>String(v??'').trim()===name)
 columns['Contract']=header.findIndex((v:any)=>String(v??'').trim()==='Contract'); columns['Patient']=header.findIndex((v:any)=>String(v??'').trim()==='Patient')
 const hasPatient=columns['Patient']>=0; const normalized:any[]=[]; let current:any=null
 for(let i=headerIndex+1;i<matrix.length;i++){
   const row=matrix[i]; if(!row.some((v:any)=>String(v??'').trim()!==''))continue
   const analysisName=cell(row,columns['Analysis name']); const testNo=cell(row,columns['#']); const duration=numberValue(row[columns['Duration']]); const price=numberValue(row[columns['Price']]); const contract=columns['Contract']>=0?numberValue(row[columns['Contract']]):NaN; const patient=hasPatient?numberValue(row[columns['Patient']]):price
   const hasNumericTestData=[duration,price,contract,patient].some(Number.isFinite)
   if(analysisName&&(testNo||hasNumericTestData)){ current={test_no:testNo||`AUTO-${i+1}`,analysis_name:analysisName,unit:cell(row,columns['Unit']),ref_range:cell(row,columns['Ref. range']),specimen:cell(row,columns['Specimen']),duration:Number.isFinite(duration)?duration:0,price:Number.isFinite(price)?price:(Number.isFinite(patient)?patient:0),contract_price:Number.isFinite(contract)?contract:0,patient_price:Number.isFinite(patient)?patient:price,_row:i+1}; normalized.push(current); continue }
   if(current){ if(analysisName)current.analysis_name=appendText(current.analysis_name,analysisName); for(const name of textColumns){const next=cell(row,columns[name]);if(next)current[keyMap[name]]=appendText(current[keyMap[name]],next)} }
 }
 return {tests:normalized,legacyEightColumn:!hasPatient}
}

type CatalogTest={test_no:string;analysis_name:string;unit:string;specimen:string;patient_price:number;active:number}
type Booking={reference:string;created_at:string;patient_name:string;age:number|null;gender:string|null;phone:string;preferred_at:string|null;address:string|null;tests_json:string;total:number;status?:string|null}

function formatDate(value:any){
 if(!value)return 'Not specified'
 const d=new Date(String(value))
 if(Number.isNaN(d.getTime())) return String(value)
 return d.toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
}
function preferredTime(value:any){
 if(!value)return null
 const d=new Date(String(value)); return Number.isNaN(d.getTime())?null:d.getTime()
}
function bookingTests(b:Booking){
 try { const x=JSON.parse(b.tests_json||'[]'); return Array.isArray(x)?x:[] } catch { return [] }
}

export default function Admin(){
 const [password,setPassword]=useState(''),[logged,setLogged]=useState(false),[rows,setRows]=useState<any[]>([]),[bookings,setBookings]=useState<Booking[]>([]),[catalog,setCatalog]=useState<CatalogTest[]>([]),[msg,setMsg]=useState(''),[catalogQuery,setCatalogQuery]=useState(''),[catalogLoading,setCatalogLoading]=useState(false),[currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[busy,setBusy]=useState(false),[selectedBooking,setSelectedBooking]=useState<Booking|null>(null),[bookingView,setBookingView]=useState<'upcoming'|'all'|'past'>('upcoming'),[bookingQuery,setBookingQuery]=useState('')
 async function login(){try{const x=await api<any>('/admin/login',{method:'POST',body:JSON.stringify({password})});if(x.token)localStorage.setItem('mtb_admin_token',x.token);setLogged(true);setMsg('Authenticated')}catch(e:any){setMsg(e.message)}}
 function logout(){localStorage.removeItem('mtb_admin_token');setLogged(false);setPassword('');setMsg('Logged out')}
 async function loadBookings(){try{const x=await api<any>('/admin/bookings');setBookings(Array.isArray(x.bookings)?x.bookings:[])}catch(e:any){if(String(e.message)==='Unauthorized')logout();else setMsg(e.message)}}
 async function loadCatalog(query:string){
  try{
    setCatalogLoading(true)
    const q=query.trim()
    if(!q){setCatalog([]);return}
    const x=await api<any>(`/admin/tests?q=${encodeURIComponent(q)}`)
    setCatalog(Array.isArray(x.tests)?x.tests.slice(0,5):[])
  }catch(e:any){
    if(String(e.message)==='Unauthorized')logout();else setMsg(e.message)
  }finally{
    setCatalogLoading(false)
  }
}
 useEffect(()=>{if(logged){loadBookings()}},[logged])
 useEffect(()=>{
   if(!logged)return
   const timer=window.setTimeout(()=>{loadCatalog(catalogQuery)},220)
   return()=>window.clearTimeout(timer)
 },[logged,catalogQuery])
 useEffect(()=>{const token=typeof window!=='undefined'?localStorage.getItem('mtb_admin_token'):null;if(token)setLogged(true)},[])
 async function parse(file:File){try{const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,blankrows:true});const ws=wb.Sheets[wb.SheetNames[0]];const parsed=parseLaboratoryPriceList(ws);const normalized=parsed.tests;if(!normalized.length){setMsg('No laboratory tests were found after the approved price-list header.');setRows([]);return}const invalid=normalized.find(r=>!r.analysis_name||!Number.isFinite(r.patient_price));if(invalid){setMsg(`Invalid row ${invalid._row}: Analysis name and Price are required.`);setRows([]);return}setRows(normalized);setMsg(`${normalized.length} tests loaded from ${file.name}${parsed.legacyEightColumn?' — approved 8-column format detected; Price is used as the patient price.':''}`)}catch(e:any){setMsg(e?.message||'Could not read this Excel/CSV file.');setRows([])}}
 async function publish(){try{setBusy(true);const x=await api<any>('/admin/tests/import',{method:'POST',body:JSON.stringify({tests:rows})});setMsg(`Published ${x.count} tests successfully.`);setRows([]);setCatalog([]);setCatalogQuery('')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 async function changePrice(testNo:string,value:string){const price=Number(value);if(!Number.isFinite(price)||price<0)return;try{await api('/admin/tests/price',{method:'POST',body:JSON.stringify({test_no:testNo,patient_price:price})});setCatalog(c=>c.map(t=>t.test_no===testNo?{...t,patient_price:price}:t));setMsg(`Price updated for #${testNo}.`)}catch(e:any){setMsg((e as Error).message)}}
 async function deleteBooking(reference:string){if(!window.confirm(`Delete booking ${reference}? This cannot be undone.`))return;try{setBusy(true);await api(`/admin/bookings/${encodeURIComponent(reference)}`,{method:'DELETE'});setBookings(b=>b.filter(x=>x.reference!==reference));if(selectedBooking?.reference===reference)setSelectedBooking(null);setMsg(`Booking ${reference} deleted.`)}catch(e:any){setMsg((e as Error).message)}finally{setBusy(false)}}
 async function changePassword(){try{setBusy(true);await api('/admin/change-password',{method:'POST',body:JSON.stringify({current_password:currentPassword,new_password:newPassword})});setCurrentPassword('');setNewPassword('');setMsg('Password changed successfully.')}catch(e:any){setMsg((e as Error).message)}finally{setBusy(false)}}
 const visibleCatalog=catalog.slice(0,5)
 const filteredBookings=useMemo(()=>{
   const now=Date.now(); const q=bookingQuery.trim().toLowerCase()
   return bookings.filter(b=>{
     const t=preferredTime(b.preferred_at)
     const matchesView=bookingView==='all'||(bookingView==='upcoming'?(t!==null&&t>=now):(t!==null&&t<now))
     const text=`${b.reference} ${b.patient_name} ${b.phone} ${b.gender||''} ${b.preferred_at||''}`.toLowerCase()
     return matchesView&&(!q||text.includes(q))
   })
 },[bookings,bookingView,bookingQuery])
 const upcomingCount=useMemo(()=>{const now=Date.now();return bookings.filter(b=>{const t=preferredTime(b.preferred_at);return t!==null&&t>=now}).length},[bookings])
 if(!logged)return <main className="min-h-screen grid place-items-center p-4 bg-slate-50"><div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow"><h1 className="text-xl font-bold">Admin login</h1><p className="mt-1 text-sm text-slate-500">Works on desktop and mobile browsers.</p><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} className="mt-4 w-full rounded-xl border px-3 py-3"/><button onClick={login} className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-white">Login</button>{msg&&<p className="mt-3 text-sm">{msg}</p>}</div></main>
 return <main className="min-h-screen bg-slate-50 p-4"><div className="mx-auto max-w-7xl">
   <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Catalog & Bookings Admin</h1><p className="text-sm text-slate-500">v{APP_VERSION}</p></div><div className="flex gap-2"><button onClick={loadBookings} className="rounded-lg border bg-white px-3 py-2 text-sm">Refresh bookings</button><button onClick={logout} className="rounded-lg border bg-white px-3 py-2 text-sm">Logout</button></div></div>
   {msg&&<div className="mt-4 rounded-xl border bg-white p-3 text-sm">{msg}</div>}
   <section className="mt-5 rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Upcoming reservations</h2><p className="text-sm text-slate-500">{upcomingCount} upcoming reservation{upcomingCount===1?'':'s'} with a preferred date/time.</p></div><div className="flex flex-wrap gap-2"><button onClick={()=>setBookingView('upcoming')} className={`rounded-lg px-3 py-2 text-sm ${bookingView==='upcoming'?'bg-slate-900 text-white':'border bg-white'}`}>Upcoming</button><button onClick={()=>setBookingView('all')} className={`rounded-lg px-3 py-2 text-sm ${bookingView==='all'?'bg-slate-900 text-white':'border bg-white'}`}>All</button><button onClick={()=>setBookingView('past')} className={`rounded-lg px-3 py-2 text-sm ${bookingView==='past'?'bg-slate-900 text-white':'border bg-white'}`}>Past</button><input value={bookingQuery} onChange={e=>setBookingQuery(e.target.value)} placeholder="Search patient / phone / reference" className="w-64 rounded-lg border px-3 py-2 text-sm"/></div></div>
     <div className="mt-4 grid gap-3">
       {filteredBookings.map(b=><article key={b.reference} className="rounded-2xl border p-4">
         <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 dir="auto" className="font-bold">{b.patient_name}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{b.reference}</span></div><div className="mt-2 text-sm text-slate-600">📅 {formatDate(b.preferred_at)} · 📞 {b.phone}</div><div className="mt-1 text-sm text-slate-500">Age {b.age??'—'} · {b.gender||'—'} · Total {Number(b.total||0)} EGP</div></div><div className="flex gap-2"><button onClick={()=>setSelectedBooking(b)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">View details</button><button disabled={busy} onClick={()=>deleteBooking(b.reference)} className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-40">Delete</button></div></div>
         <div className="mt-3 text-xs text-slate-400">Created {formatDate(b.created_at)}</div>
       </article>)}
       {!filteredBookings.length&&<p className="py-8 text-center text-slate-500">No reservations in this view.</p>}
     </div>
   </section>
   <div className="mt-5 grid gap-5 lg:grid-cols-2">
    <section className="rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">Import approved price list</h2><label className="mt-4 block cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center"><input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e=>e.target.files?.[0]&&parse(e.target.files[0])}/><b>Choose the approved laboratory price-list</b><div className="mt-2 text-sm text-slate-500">Supports the current 8-column .xls format and older 9-column format.</div></label><button disabled={!rows.length||busy} onClick={publish} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-white disabled:opacity-40">{busy?'Working…':'Publish catalog'}</button></section>
    <section className="rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">Change admin password</h2><input type="password" placeholder="Current password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="mt-4 w-full rounded-xl border px-3 py-3"/><input type="password" placeholder="New password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="mt-3 w-full rounded-xl border px-3 py-3"/><button disabled={busy||!currentPassword||!newPassword} onClick={changePassword} className="mt-3 rounded-xl bg-slate-900 px-5 py-3 text-white disabled:opacity-40">Change password</button></section>
   </div>
   {rows.length>0&&<div className="mt-5 overflow-auto rounded-2xl border bg-white"><div className="p-4 font-semibold">Preview · {rows.length} tests</div><table className="min-w-full text-sm"><thead><tr>{sourceHeaders.map(c=><th className="border-b p-3 text-left whitespace-nowrap" key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(0,20).map((r,i)=><tr key={i}>{sourceHeaders.map(c=><td className="border-b p-3 align-top" key={c}>{String(r[keyMap[c]]??'')}</td>)}</tr>)}</tbody></table></div>}
   <section className="mt-5 rounded-2xl border bg-white p-5">
     <div className="flex flex-wrap items-center justify-between gap-3">
       <div><h2 className="text-lg font-bold">Test prices</h2><p className="text-sm text-slate-500">Search the catalog; tests are loaded only while searching. Maximum 5 results.</p></div>
       <input dir="auto" value={catalogQuery} onChange={e=>setCatalogQuery(e.target.value)} placeholder="Search test number or name…" className="w-full max-w-md rounded-lg border px-3 py-2"/>
     </div>
     <div className="mt-4 overflow-auto">
       {catalogLoading&&<p className="py-4 text-center text-sm text-slate-500">Searching…</p>}
       <table className="min-w-full text-sm"><thead><tr>{['#','Analysis name','Unit','Specimen','Patient price','Save'].map(c=><th key={c} className="border-b p-3 text-left whitespace-nowrap">{c}</th>)}</tr></thead>
       <tbody>{visibleCatalog.map(t=><tr key={t.test_no}><td className="border-b p-3">{t.test_no}</td><td dir="auto" className="border-b p-3">{t.analysis_name}</td><td dir="auto" className="border-b p-3">{t.unit}</td><td dir="auto" className="border-b p-3">{t.specimen}</td><td className="border-b p-3"><input id={`price-${t.test_no}`} defaultValue={t.patient_price} type="number" min="0" step="0.01" className="w-28 rounded-lg border px-2 py-2"/></td><td className="border-b p-3"><button onClick={()=>{const el=document.getElementById(`price-${t.test_no}`) as HTMLInputElement|null;if(el)changePrice(t.test_no,el.value)}} className="rounded-lg bg-slate-900 px-3 py-2 text-white">Save</button></td></tr>)}</tbody></table>
       {!catalogLoading&&!catalogQuery.trim()&&<p className="py-8 text-center text-slate-500">Start typing to search the catalog.</p>}
       {!catalogLoading&&catalogQuery.trim()&&!visibleCatalog.length&&<p className="py-8 text-center text-slate-500">No matching tests found.</p>}
     </div>
   </section>
 </div>
 {selectedBooking&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedBooking(null)}}><div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">Reservation details</h2><p className="mt-1 text-sm text-slate-500">{selectedBooking.reference}</p></div><button onClick={()=>setSelectedBooking(null)} className="rounded-lg border px-3 py-2">✕</button></div>
   <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Patient</div><div dir="auto" className="font-semibold">{selectedBooking.patient_name}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Phone</div><div className="font-semibold">{selectedBooking.phone}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Preferred date/time</div><div className="font-semibold">{formatDate(selectedBooking.preferred_at)}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Patient details</div><div className="font-semibold">Age {selectedBooking.age??'—'} · {selectedBooking.gender||'—'}</div></div></div>
   <div className="mt-3 rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Address / home collection</div><div dir="auto" className="mt-1 whitespace-pre-wrap font-medium">{selectedBooking.address||'Not provided'}</div></div>
   <div className="mt-5"><h3 className="font-bold">Reserved tests</h3><div className="mt-2 divide-y rounded-xl border">{bookingTests(selectedBooking).map((t:any,i:number)=><div key={i} className="flex items-start justify-between gap-4 p-3"><div><div className="font-medium">{t.analysis_name||t.test_no}</div><div className="text-xs text-slate-500">#{t.test_no}{t.specimen?` · ${t.specimen}`:''}</div></div><div className="font-semibold">{Number(t.patient_price||0)} EGP</div></div>)}{!bookingTests(selectedBooking).length&&<div className="p-4 text-sm text-slate-500">No test details stored.</div>}</div></div>
   <div className="mt-4 flex justify-between border-t pt-4 text-lg font-bold"><span>Total</span><span>{Number(selectedBooking.total||0)} EGP</span></div>
   <div className="mt-2 text-xs text-slate-400">Booking created {formatDate(selectedBooking.created_at)}</div>
   <div className="mt-5 flex justify-end gap-2"><button onClick={()=>setSelectedBooking(null)} className="rounded-xl border px-4 py-2">Close</button><button disabled={busy} onClick={()=>deleteBooking(selectedBooking.reference)} className="rounded-xl border border-red-300 px-4 py-2 text-red-700">Delete reservation</button></div>
 </div></div>}
 </main>
}

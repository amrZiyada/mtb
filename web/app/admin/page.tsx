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
 const matrix=XLSX.utils.sheet_to_json<any[]>(ws,{header:1,defval:'',raw:true,blankrows:true})
 const headerIndex=matrix.findIndex(row=>requiredHeaders.every(header=>row.some((v:any)=>String(v??'').trim()===header)))
 if(headerIndex<0) throw new Error(`Could not find the approved price-list header: ${requiredHeaders.join(' · ')}`)
 const header=matrix[headerIndex]
 const columns:any={}
 for(const name of requiredHeaders) columns[name]=header.findIndex((v:any)=>String(v??'').trim()===name)
 columns['Contract']=header.findIndex((v:any)=>String(v??'').trim()==='Contract')
 columns['Patient']=header.findIndex((v:any)=>String(v??'').trim()==='Patient')
 const hasPatient=columns['Patient']>=0
 const normalized:any[]=[]
 let current:any=null
 for(let i=headerIndex+1;i<matrix.length;i++){
   const row=matrix[i]; const hasContent=row.some((v:any)=>String(v??'').trim()!==''); if(!hasContent)continue
   const analysisName=cell(row,columns['Analysis name']); const testNo=cell(row,columns['#'])
   const duration=numberValue(row[columns['Duration']]); const price=numberValue(row[columns['Price']])
   const contract=columns['Contract']>=0?numberValue(row[columns['Contract']]):NaN
   const patient=hasPatient?numberValue(row[columns['Patient']]):price
   const hasNumericTestData=[duration,price,contract,patient].some(Number.isFinite)
   if(analysisName&&(testNo||hasNumericTestData)){
     current={test_no:testNo||`AUTO-${i+1}`,analysis_name:analysisName,unit:cell(row,columns['Unit']),ref_range:cell(row,columns['Ref. range']),specimen:cell(row,columns['Specimen']),duration:Number.isFinite(duration)?duration:0,price:Number.isFinite(price)?price:(Number.isFinite(patient)?patient:0),contract_price:Number.isFinite(contract)?contract:0,patient_price:Number.isFinite(patient)?patient:price,_row:i+1}
     normalized.push(current); continue
   }
   if(current){
     if(analysisName)current.analysis_name=appendText(current.analysis_name,analysisName)
     for(const name of textColumns){const next=cell(row,columns[name]);if(next)current[keyMap[name]]=appendText(current[keyMap[name]],next)}
   }
 }
 return {tests:normalized,legacyEightColumn:!hasPatient}
}

type CatalogTest={test_no:string;analysis_name:string;unit:string;specimen:string;patient_price:number;active:number}

export default function Admin(){
 const [password,setPassword]=useState(''),[logged,setLogged]=useState(false),[rows,setRows]=useState<any[]>([]),[bookings,setBookings]=useState<any[]>([]),[catalog,setCatalog]=useState<CatalogTest[]>([]),[msg,setMsg]=useState(''),[catalogQuery,setCatalogQuery]=useState(''),[currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[busy,setBusy]=useState(false)
 async function login(){try{const x=await api<any>('/admin/login',{method:'POST',body:JSON.stringify({password})});if(x.token)localStorage.setItem('mtb_admin_token',x.token);setLogged(true);setMsg('Authenticated')}catch(e:any){setMsg(e.message)}}
 function logout(){localStorage.removeItem('mtb_admin_token');setLogged(false);setPassword('');setMsg('Logged out')}
 async function loadBookings(){try{const x=await api<any>('/admin/bookings');setBookings(x.bookings)}catch(e:any){if(String(e.message)==='Unauthorized')logout();else setMsg(e.message)}}
 async function loadCatalog(){try{const x=await api<any>('/admin/tests');setCatalog(x.tests)}catch(e:any){if(String(e.message)==='Unauthorized')logout();else setMsg(e.message)}}
 useEffect(()=>{if(logged){loadBookings();loadCatalog()}},[logged])
 async function parse(file:File){
   try{
     const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false}); const ws=wb.Sheets[wb.SheetNames[0]]
     const parsed=parseLaboratoryPriceList(ws); const normalized=parsed.tests
     if(!normalized.length){setMsg('No laboratory tests were found after the approved price-list header.');setRows([]);return}
     const invalid=normalized.find(r=>!r.analysis_name||!Number.isFinite(r.patient_price))
     if(invalid){setMsg(`Invalid row ${invalid._row}: Analysis name and Price are required.`);setRows([]);return}
     setRows(normalized);setMsg(`${normalized.length} tests loaded from ${file.name}${parsed.legacyEightColumn?' — approved 8-column format detected; Price is used as the patient price.':''}`)
   }catch(e:any){setMsg(e?.message||'Could not read this Excel/CSV file.');setRows([])}
 }
 async function publish(){try{setBusy(true);const x=await api<any>('/admin/tests/import',{method:'POST',body:JSON.stringify({tests:rows})});setMsg(`Published ${x.count} tests successfully.`);await loadCatalog()}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
 async function changePrice(testNo:string,value:string){const price=Number(value);if(!Number.isFinite(price)||price<0)return;try{await api('/admin/tests/price',{method:'POST',body:JSON.stringify({test_no:testNo,patient_price:price})});setCatalog(c=>c.map(t=>t.test_no===testNo?{...t,patient_price:price}:t));setMsg(`Price updated for #${testNo}.`)}catch(e:any){setMsg((e as Error).message)}}
 async function deleteBooking(reference:string){if(!window.confirm(`Delete booking ${reference}? This cannot be undone.`))return;try{setBusy(true);await api(`/admin/bookings/${encodeURIComponent(reference)}`,{method:'DELETE'});setBookings(b=>b.filter(x=>x.reference!==reference));setMsg(`Booking ${reference} deleted.`)}catch(e:any){setMsg((e as Error).message)}finally{setBusy(false)}}
 async function changePassword(){try{setBusy(true);await api('/admin/change-password',{method:'POST',body:JSON.stringify({current_password:currentPassword,new_password:newPassword})});setCurrentPassword('');setNewPassword('');setMsg('Password changed successfully.')}catch(e:any){setMsg((e as Error).message)}finally{setBusy(false)}}
 const visibleCatalog=useMemo(()=>catalog.filter(t=>`${t.test_no} ${t.analysis_name} ${t.unit} ${t.specimen}`.toLowerCase().includes(catalogQuery.toLowerCase())),[catalog,catalogQuery])
 if(!logged)return <main className="min-h-screen grid place-items-center p-4 bg-slate-50"><div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow"><h1 className="text-xl font-bold">Admin login</h1><p className="mt-1 text-sm text-slate-500">Works on desktop and mobile browsers.</p><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} className="mt-4 w-full rounded-xl border px-3 py-3"/><button onClick={login} className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-white">Login</button><p className="mt-3 text-sm">{msg}</p></div></main>
 return <main className="min-h-screen bg-slate-50 p-4"><div className="mx-auto max-w-7xl"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Catalog & Bookings Admin</h1><p className="text-sm text-slate-500">v{APP_VERSION}</p></div><button onClick={logout} className="rounded-lg border bg-white px-3 py-2 text-sm">Logout</button></div>
   <div className="mt-5 grid gap-5 lg:grid-cols-2">
    <section className="rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">Import approved price list</h2><label className="mt-4 block cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center"><input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e=>e.target.files?.[0]&&parse(e.target.files[0])}/><b>Choose the approved laboratory price-list</b><div className="mt-2 text-sm text-slate-500">Supports the current 8-column .xls format (Date + #, Analysis name, Unit, Ref. range, Specimen, Duration, Price) as well as the older 9-column format.</div></label><button disabled={!rows.length||busy} onClick={publish} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-white disabled:opacity-40">{busy?'Working…':'Publish catalog'}</button><p className="mt-3 text-sm">{msg}</p></section>
    <section className="rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">Change admin password</h2><input type="password" placeholder="Current password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="mt-4 w-full rounded-xl border px-3 py-3"/><input type="password" minLength={1} placeholder="New password (minimum 1 character)" value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="mt-3 w-full rounded-xl border px-3 py-3"/><button disabled={busy||!currentPassword||newPassword.length<1} onClick={changePassword} className="mt-3 rounded-xl bg-slate-900 px-5 py-3 text-white disabled:opacity-40">Change password</button></section>
   </div>
   {rows.length>0&&<div className="mt-5 overflow-auto rounded-2xl border bg-white"><div className="p-4 font-semibold">Preview · {rows.length} tests</div><table className="min-w-full text-sm"><thead><tr>{sourceHeaders.map(c=><th className="border-b p-3 text-left whitespace-nowrap" key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(0,20).map((r,i)=><tr key={i}>{sourceHeaders.map(c=><td className="border-b p-3 align-top" key={c}>{String(r[keyMap[c]]??'')}</td>)}</tr>)}</tbody></table></div>}
   <section className="mt-5 rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Test prices</h2><input value={catalogQuery} onChange={e=>setCatalogQuery(e.target.value)} placeholder="Search tests…" className="rounded-lg border px-3 py-2"/><button onClick={loadCatalog} className="rounded-lg border px-3 py-2 text-sm">Refresh</button></div><div className="mt-4 overflow-auto"><table className="min-w-full text-sm"><thead><tr>{['#','Analysis name','Unit','Specimen','Patient price','Save'].map(c=><th key={c} className="border-b p-3 text-left whitespace-nowrap">{c}</th>)}</tr></thead><tbody>{visibleCatalog.map(t=><tr key={t.test_no}><td className="border-b p-3">{t.test_no}</td><td className="border-b p-3">{t.analysis_name}</td><td className="border-b p-3">{t.unit}</td><td className="border-b p-3">{t.specimen}</td><td className="border-b p-3"><input id={`price-${t.test_no}`} defaultValue={t.patient_price} type="number" min="0" step="0.01" className="w-28 rounded-lg border px-2 py-2"/></td><td className="border-b p-3"><button onClick={()=>{const el=document.getElementById(`price-${t.test_no}`) as HTMLInputElement|null;if(el)changePrice(t.test_no,el.value)}} className="rounded-lg bg-slate-900 px-3 py-2 text-white">Save</button></td></tr>)}</tbody></table>{!visibleCatalog.length&&<p className="py-8 text-center text-slate-500">No tests found.</p>}</div></section>
   <section className="mt-5 rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Incoming bookings</h2><button onClick={loadBookings} className="rounded-lg border px-3 py-2 text-sm">Refresh</button></div><div className="mt-4 overflow-auto"><table className="min-w-full text-sm"><thead><tr>{['reference','created_at','patient_name','age','gender','phone','preferred_at','total','status','action'].map(c=><th key={c} className="border-b p-3 text-left">{c}</th>)}</tr></thead><tbody>{bookings.map((b:any)=><tr key={b.reference}>{['reference','created_at','patient_name','age','gender','phone','preferred_at','total','status'].map(c=><td key={c} className="border-b p-3 whitespace-nowrap">{String(b[c]??'')}</td>)}<td className="border-b p-3 whitespace-nowrap"><button disabled={busy} onClick={()=>deleteBooking(b.reference)} className="rounded-lg border border-red-300 px-3 py-2 text-red-700 disabled:opacity-40">Delete</button></td></tr>)}</tbody></table>{!bookings.length&&<p className="py-8 text-center text-slate-500">No bookings yet.</p>}</div></section>
 </div></main>
}

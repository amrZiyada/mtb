'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import {api} from '../lib/api'
import {APP_VERSION} from '../lib/version'

type Test={test_no:string;analysis_name:string;unit:string;ref_range:string;specimen:string;duration:number;price:number;contract_price:number;patient_price:number}
type Cart=Record<string,boolean>
type TestMap=Record<string,Test>

function SearchBox({q,setQ,searchRef,onEnter}:{q:string;setQ:(v:string)=>void;searchRef:React.RefObject<HTMLInputElement|null>;onEnter:()=>void}){
  return <div className="rounded-2xl border bg-white p-3 shadow-sm">
    <input ref={searchRef} autoComplete="off" inputMode="search" value={q}
      onChange={e=>setQ(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();onEnter()}}}
      placeholder="Search test, specimen, unit or reference range…"
      className="w-full rounded-xl border px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300" />
  </div>
}

function CartBox({selected,cart,total,addTest,removeTest,onReserve}:{selected:Test[];cart:Cart;total:number;addTest:(t:Test)=>void;removeTest:(n:string)=>void;onReserve:()=>void}){
  const count=selected.length
  return <div className="rounded-2xl border bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between">
      <h2 className="font-bold">Reservation</h2>
      {count>0&&<span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{count} test{count===1?'':'s'}</span>}
    </div>
    {selected.length>0 ? <>
      <div className="mt-3 max-h-52 space-y-2 overflow-auto">
        {selected.map(t=><div className="flex items-center justify-between gap-3 text-sm" key={t.test_no}>
          <div className="min-w-0 flex-1"><div dir="auto" className="truncate font-medium">{t.analysis_name}</div><div className="text-xs text-slate-500">{t.patient_price} EGP</div></div>
          <button type="button" onClick={()=>removeTest(t.test_no)} className="rounded-lg border px-3 py-1.5 text-xs">Remove</button>
        </div>)}
      </div>
      <div className="my-3 flex justify-between border-t pt-3 font-bold"><span>Total</span><span>{total} EGP</span></div>
      <button type="button" onClick={onReserve} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white">Reserve</button>
    </> : <div className="mt-2 text-sm text-slate-500">No tests added yet.</div>}
  </div>
}

export default function Home(){
  const [tests,setTests]=useState<Test[]>([])
  const [catalog,setCatalog]=useState<TestMap>({})
  const [q,setQ]=useState('')
  const [cart,setCart]=useState<Cart>({})
  const [open,setOpen]=useState(false)
  const [done,setDone]=useState<any>(null)
  const [loading,setLoading]=useState(false)
  const [err,setErr]=useState('')
  const searchRef=useRef<HTMLInputElement|null>(null)
  const requestId=useRef(0)
  const [form,setForm]=useState({patient_name:'',age:'',gender:'',phone:'',preferred_at:'',address:''})
  const [duplicateWarning,setDuplicateWarning]=useState<any[]>([])
  const [duplicateConfirmed,setDuplicateConfirmed]=useState(false)

  useEffect(()=>{
    const term=q.trim().toLowerCase()
    if(!term){setTests([]);setLoading(false);return}
    const id=++requestId.current
    const controller=new AbortController()
    const timer=window.setTimeout(async()=>{
      try{
        setLoading(true);setErr('')
        const x=await api<{tests:Test[]}>(`/tests?q=${encodeURIComponent(term)}`,{signal:controller.signal} as any)
        if(id!==requestId.current||controller.signal.aborted)return
        // Defensive client-side filtering: even if an old Worker is still deployed,
        // never display the whole catalogue for a search.
        const matches=(x.tests||[]).filter(t=>{
          const hay=[t.test_no,t.analysis_name,t.unit,t.ref_range,t.specimen].map(v=>String(v||'').toLowerCase())
          return hay.some(v=>v.includes(term))
        }).slice(0,50)
        setTests(matches)
        setCatalog(prev=>{const next={...prev};for(const t of matches)next[t.test_no]=t;return next})
      }catch(e:any){if(!controller.signal.aborted&&id===requestId.current)setErr(e.message||'Search failed')}
      finally{if(!controller.signal.aborted&&id===requestId.current)setLoading(false)}
    },220)
    return()=>{window.clearTimeout(timer);controller.abort()}
  },[q])

  const selected=useMemo(()=>Object.keys(cart).filter(k=>cart[k]>0&&catalog[k]).map(k=>catalog[k]),[cart,catalog])
  const total=useMemo(()=>selected.reduce((s,t)=>s+Number(t.patient_price),0),[selected,cart])
  const addTest=(t:Test)=>{if(cart[t.test_no])return;setCatalog(p=>({...p,[t.test_no]:t}));setCart(c=>({...c,[t.test_no]:true}))}
  const removeTest=(n:string)=>setCart(c=>{const x={...c};delete x[n];return x})
  const addFirstResult=()=>{if(!tests[0])return;addTest(tests[0]);setQ('');window.setTimeout(()=>searchRef.current?.focus(),0)}
  const submit=async(e:any)=>{e.preventDefault();try{setErr('');const d=await api<any>(`/bookings/check-duplicate?name=${encodeURIComponent(form.patient_name)}&phone=${encodeURIComponent(form.phone)}`);if(d.duplicates?.length&&!duplicateConfirmed){setDuplicateWarning(d.duplicates);return}const x=await api<any>('/bookings',{method:'POST',body:JSON.stringify({...form,age:Number(form.age),tests:selected.map(t=>({code:t.test_no}))})});setDone(x);setCart({});setOpen(false);setDuplicateWarning([]);setDuplicateConfirmed(false)}catch(e:any){setErr(e.message||'Booking failed')}}

  const Results=()=> <div className="mt-4">
    {!q.trim()?<div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">Start typing to search the test catalogue.</div>
    :loading?<div className="py-10 text-center text-sm text-slate-500">Searching…</div>
    :tests.length===0?<div className="rounded-2xl border bg-white p-8 text-center text-sm text-slate-500">No matching tests found.</div>
    :<><div className="mb-2 text-xs text-slate-500">Showing {tests.length} matching test{tests.length===1?'':'s'}</div><div className="grid gap-3">
      {tests.map(t=><article key={t.test_no} className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 dir="auto" className="font-semibold">{t.analysis_name}</h2><div className="mt-1 text-sm text-slate-500">#{t.test_no}{t.unit&&` · ${t.unit}`}{t.specimen&&` · ${t.specimen}`}</div>{t.ref_range&&<div className="mt-2 text-xs text-slate-500"><b>Ref:</b> {t.ref_range}</div>}<div className="mt-2 text-xs font-medium text-slate-600">TAT: {t.duration} {t.duration===1?'hour':'hours'}</div></div><div className="shrink-0 text-right"><div className="text-lg font-bold">{t.patient_price}</div><div className="text-xs text-slate-500">EGP</div></div></div>
        <div className="mt-3"><button type="button" disabled={!!cart[t.test_no]} onClick={()=>addTest(t)} className="rounded-lg border px-4 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400">{cart[t.test_no]?"Added":"Add"}</button></div>
      </article>)}
    </div></>}
  </div>

  return <main className="min-h-screen">
    <header className="bg-slate-900 text-white"><div className="mx-auto max-w-6xl px-4 py-6 sm:py-7"><h1 className="text-2xl font-bold sm:text-3xl">Booking Lab by Amr Ziyada</h1><div className="mt-1 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-300 sm:text-base">Choose your tests and reserve a convenient time.</p><a href="/login" className="rounded-lg border border-white/20 px-3 py-2 text-sm">Staff login</a></div></div></header>

    {/* MOBILE: one deliberate vertical order — SEARCH → TEST RESULTS → RESERVATION */}
    <div className="mx-auto max-w-6xl px-4 py-4 lg:hidden">
      <div className="sticky top-0 z-40 -mx-4 border-b bg-slate-50/95 px-4 py-3 backdrop-blur"><SearchBox q={q} setQ={setQ} searchRef={searchRef} onEnter={addFirstResult}/></div>
      {err&&<div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      <Results />
      <div className="mt-6"><CartBox selected={selected} cart={cart} total={total} addTest={addTest} removeTest={removeTest} onReserve={()=>setOpen(true)}/></div>
    </div>

    {/* DESKTOP: results on the left, reservation on the right */}
    <div className="mx-auto hidden max-w-6xl px-4 py-6 lg:block">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <section><div className="sticky top-0 z-20"><SearchBox q={q} setQ={setQ} searchRef={searchRef} onEnter={addFirstResult}/></div>{err&&<div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</div>}<Results/></section>
        <aside className="sticky top-4"><CartBox selected={selected} cart={cart} total={total} addTest={addTest} removeTest={removeTest} onReserve={()=>setOpen(true)}/></aside>
      </div>
    </div>

    {open&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6"><div className="flex justify-between"><h2 className="text-xl font-bold">Booking details</h2><button type="button" onClick={()=>setOpen(false)}>✕</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Patient name<input required value={form.patient_name} onChange={e=>setForm({...form,patient_name:e.target.value})} className="rounded-xl border px-3 py-2"/></label><label className="grid gap-1 text-sm">Age<input required min="0" max="120" type="number" value={form.age} onChange={e=>setForm({...form,age:e.target.value})} className="rounded-xl border px-3 py-2"/></label><label className="grid gap-1 text-sm">Phone number<input required value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} className="rounded-xl border px-3 py-2"/></label><label className="grid gap-1 text-sm">Preferred date/time<input type="datetime-local" value={form.preferred_at} onChange={e=>setForm({...form,preferred_at:e.target.value})} className="rounded-xl border px-3 py-2"/></label><label className="grid gap-1 text-sm">Gender<select required value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})} className="rounded-xl border px-3 py-2"><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></label><label className="grid gap-1 text-sm sm:col-span-2">Address / home collection<textarea value={form.address} onChange={e=>setForm({...form,address:e.target.value})} className="rounded-xl border px-3 py-2" rows={3}/></label></div><button className="mt-5 w-full rounded-xl bg-slate-900 py-3 font-semibold text-white">Confirm booking · {total} EGP</button></form></div>}
    {duplicateWarning.length>0&&<div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-bold">Possible duplicate patient</h2><p className="mt-2 text-sm text-slate-600">This patient already has an active reservation. You can continue if this is intentional.</p><div className="mt-4 space-y-2">{duplicateWarning.map((d:any)=><div key={d.reference} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{d.reference}</b> · {d.status}</div>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>{setDuplicateWarning([]);setDuplicateConfirmed(false)}} className="rounded-lg border px-4 py-2">Back</button><button type="button" onClick={()=>{setDuplicateWarning([]);setDuplicateConfirmed(true)}} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Continue anyway</button></div></div></div>}
    {done&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-7 text-center"><div className="text-4xl">✓</div><h2 className="mt-3 text-2xl font-bold">Booking received</h2><p className="mt-2 text-slate-600">Reference</p><div className="my-3 rounded-xl bg-slate-100 p-4 text-2xl font-bold tracking-widest">{done.reference}</div><p className="text-sm text-slate-500">Total: {done.total} EGP</p><button onClick={()=>setDone(null)} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white">Done</button></div></div>}
    <footer className="mx-auto max-w-6xl px-4 pb-6 text-center text-xs text-slate-400">v{APP_VERSION}</footer>
  </main>
}

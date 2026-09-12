'use client'

import {useEffect,useMemo,useState} from 'react'
import {api} from '../lib/api'
import {APP_VERSION} from '../lib/version'

type Test={
  test_no:string
  analysis_name:string
  unit:string
  ref_range:string
  specimen:string
  duration:number
  price:number
  contract_price:number
  patient_price:number
}

type Cart=Record<string,number>

export default function Home(){
  const [tests,setTests]=useState<Test[]>([])
  const [q,setQ]=useState('')
  const [specimen,setSpecimen]=useState('')
  const [cart,setCart]=useState<Cart>({})
  const [open,setOpen]=useState(false)
  const [done,setDone]=useState<any>(null)
  const [loading,setLoading]=useState(true)
  const [err,setErr]=useState('')

  const [form,setForm]=useState({
    patient_name:'',
    age:'',
    gender:'',
    phone:'',
    preferred_at:'',
    address:''
  })

  useEffect(()=>{
    api<{tests:Test[]}>('/tests')
      .then(x=>setTests(x.tests))
      .catch(e=>setErr(e.message))
      .finally(()=>setLoading(false))
  },[])

  const specimens=useMemo(
    ()=>Array.from(new Set(tests.map(x=>x.specimen).filter(Boolean))).sort(),
    [tests]
  )

  const filtered=useMemo(
    ()=>tests.filter(t=>
      (!q||`${t.analysis_name} ${t.test_no} ${t.unit} ${t.ref_range} ${t.specimen}`
        .toLowerCase()
        .includes(q.toLowerCase()))
      &&
      (!specimen||t.specimen===specimen)
    ),
    [tests,q,specimen]
  )

  const total=tests.reduce(
    (s,t)=>s+(cart[t.test_no]||0)*Number(t.patient_price),
    0
  )

  const selected=tests.filter(t=>cart[t.test_no])

  const addTest=(testNo:string)=>{
    setCart(c=>({...c,[testNo]:(c[testNo]||0)+1}))
  }

  const removeTest=(testNo:string)=>{
    setCart(c=>({...c,[testNo]:Math.max(0,(c[testNo]||0)-1)}))
  }

  const submit=async(e:any)=>{
    e.preventDefault()
    try{
      setErr('')
      const x=await api<any>('/bookings',{
        method:'POST',
        body:JSON.stringify({
          ...form,
          age:Number(form.age),
          tests:selected.map(t=>({code:t.test_no}))
        })
      })
      setDone(x)
      setCart({})
      setOpen(false)
    }catch(e:any){
      setErr(e.message)
    }
  }

  const SearchBox=()=> (
    <div className="rounded-2xl border bg-white p-3 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          onKeyDown={e=>{
            if(e.key==='Enter'&&!e.nativeEvent.isComposing){
              e.preventDefault()
              const first=filtered[0]
              if(first){
                addTest(first.test_no)
                setQ('')
              }
            }
          }}
          placeholder="Search test, specimen, unit or reference range…"
          className="rounded-xl border px-4 py-3 outline-none focus:ring-2 focus:ring-slate-300"
        />
        <select
          value={specimen}
          onChange={e=>setSpecimen(e.target.value)}
          className="rounded-xl border px-4 py-3"
        >
          <option value="">All specimens</option>
          {specimens.map(s=><option key={s}>{s}</option>)}
        </select>
      </div>
    </div>
  )

  const CartBox=({mobile=false}:{mobile?:boolean})=> (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${mobile?'':'p-5'}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Reservation</h2>
        {selected.length>0&&(
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">
            {selected.reduce((n,t)=>n+(cart[t.test_no]||0),0)} test{selected.reduce((n,t)=>n+(cart[t.test_no]||0),0)===1?'':'s'}
          </span>
        )}
      </div>

      {selected.length>0 ? (
        <>
          <div className={`mt-3 space-y-2 ${mobile?'max-h-40 overflow-auto':''}`}>
            {selected.map(t=>(
              <div className="flex items-center justify-between gap-3 text-sm" key={t.test_no}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.analysis_name}</div>
                  <div className="text-xs text-slate-500">
                    {cart[t.test_no]} × {t.patient_price} EGP
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button aria-label={`Remove ${t.analysis_name}`} onClick={()=>removeTest(t.test_no)} className="h-7 w-7 rounded-lg border">−</button>
                  <span className="w-5 text-center">{cart[t.test_no]}</span>
                  <button aria-label={`Add ${t.analysis_name}`} onClick={()=>addTest(t.test_no)} className="h-7 w-7 rounded-lg border">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="my-3 flex justify-between border-t pt-3 font-bold">
            <span>Total</span>
            <span>{total} EGP</span>
          </div>

          <button onClick={()=>setOpen(true)} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white">
            Reserve
          </button>
        </>
      ) : (
        <div className="mt-2 text-sm text-slate-500">No tests added yet.</div>
      )}
    </div>
  )

  return (
    <main className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-7">
          <h1 className="text-2xl font-bold sm:text-3xl">Booking Lab by Amr Ziyada</h1>
          <p className="mt-1 text-sm text-slate-300 sm:text-base">Choose your tests and reserve a convenient time.</p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
        <div className="lg:hidden">
          <div className="sticky top-0 z-40 -mx-4 space-y-3 border-b bg-slate-50/95 px-4 py-3 backdrop-blur">
            <SearchBox />
            <CartBox mobile />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_330px]">
          <section>
            <div className="hidden lg:block lg:sticky lg:top-0 lg:z-20">
              <SearchBox />
            </div>

            {err&&<div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</div>}

            {loading ? (
              <div className="py-12 text-center">Loading tests…</div>
            ) : (
              <div className="mt-4 grid gap-3">
                {filtered.map(t=>(
                  <article key={t.test_no} className="rounded-2xl border bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="font-semibold">{t.analysis_name}</h2>
                        <div className="mt-1 text-sm text-slate-500">
                          #{t.test_no}{t.unit&&` · ${t.unit}`}{t.specimen&&` · ${t.specimen}`}
                        </div>
                        {t.ref_range&&<div className="mt-2 text-xs text-slate-500"><b>Ref:</b> {t.ref_range}</div>}
                        <div className="mt-2 text-xs font-medium text-slate-600">TAT: {t.duration} {t.duration===1?'hour':'hours'}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-lg font-bold">{t.patient_price}</div>
                        <div className="text-xs text-slate-500">EGP</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button aria-label="Remove" onClick={()=>removeTest(t.test_no)} className="h-9 w-9 rounded-lg border">−</button>
                      <span className="min-w-6 text-center">{cart[t.test_no]||0}</span>
                      <button aria-label="Add" onClick={()=>addTest(t.test_no)} className="h-9 w-9 rounded-lg border">+</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="hidden h-fit lg:sticky lg:top-4 lg:block">
            <CartBox />
          </aside>
        </div>
      </div>

      {open&&(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <form onSubmit={submit} className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6">
            <div className="flex justify-between">
              <h2 className="text-xl font-bold">Booking details</h2>
              <button type="button" onClick={()=>setOpen(false)}>✕</button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Patient name<input required value={form.patient_name} onChange={e=>setForm({...form,patient_name:e.target.value})} className="rounded-xl border px-3 py-2"/></label>
              <label className="grid gap-1 text-sm">Age<input required min="0" max="120" type="number" value={form.age} onChange={e=>setForm({...form,age:e.target.value})} className="rounded-xl border px-3 py-2"/></label>
              <label className="grid gap-1 text-sm">Phone number<input required value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} className="rounded-xl border px-3 py-2"/></label>
              <label className="grid gap-1 text-sm">Preferred date/time<input type="datetime-local" value={form.preferred_at} onChange={e=>setForm({...form,preferred_at:e.target.value})} className="rounded-xl border px-3 py-2"/></label>
              <label className="grid gap-1 text-sm">Gender<select required value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})} className="rounded-xl border px-3 py-2"><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></label>
              <label className="grid gap-1 text-sm sm:col-span-2">Address / home collection<textarea value={form.address} onChange={e=>setForm({...form,address:e.target.value})} className="rounded-xl border px-3 py-2" rows={3}/></label>
            </div>
            <button className="mt-5 w-full rounded-xl bg-slate-900 py-3 font-semibold text-white">Confirm booking · {total} EGP</button>
          </form>
        </div>
      )}

      {done&&(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-7 text-center">
            <div className="text-4xl">✓</div>
            <h2 className="mt-3 text-2xl font-bold">Booking received</h2>
            <p className="mt-2 text-slate-600">Reference</p>
            <div className="my-3 rounded-xl bg-slate-100 p-4 text-2xl font-bold tracking-widest">{done.reference}</div>
            <p className="text-sm text-slate-500">Total: {done.total} EGP</p>
            <button onClick={()=>setDone(null)} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white">Done</button>
          </div>
        </div>
      )}

      <footer className="mx-auto max-w-6xl px-4 pb-6 text-center text-xs text-slate-400">v{APP_VERSION}</footer>
    </main>
  )
}

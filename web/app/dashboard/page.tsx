'use client'
import {useEffect,useState,useCallback,useMemo} from 'react'
import {api} from '../../lib/api'

type Booking=any
type TestItem={test_no:string;analysis_name:string;patient_price?:number}
type Draft={patient_name:string;age:string;gender:string;phone:string;address:string;preferred_at:string;tests:TestItem[]}
const today=()=>new Date().toISOString().slice(0,10)

function parseTests(json:string):TestItem[]{try{return JSON.parse(json||'[]')}catch{return[]}}

function draftFor(b:Booking):Draft{
  const originalTests=parseTests(b.tests_json||'[]')
  return {
    patient_name:b.patient_name||'',
    age:b.age==null?'':String(b.age),
    gender:b.gender||'',
    phone:b.phone||'',
    address:b.address||'',
    preferred_at:b.preferred_at?String(b.preferred_at).slice(0,16):'',
    tests:originalTests
  }
}

function TestSelector({tests,onChange,status,mode,blockedTests}:{tests:TestItem[];onChange:(t:TestItem[])=>void;status:string;mode?:'original'|'extra';blockedTests?:TestItem[]}){
  const [searchQuery,setSearchQuery]=useState('')
  const [results,setResults]=useState<TestItem[]>([])
  const [loading,setLoading]=useState(false)
  const existingCodes=useMemo(()=>new Set([...tests.map(t=>t.test_no),...(blockedTests||[]).map(t=>t.test_no)]),[tests,blockedTests])

  useEffect(()=>{
    let cancelled=false
    if(!searchQuery.trim()){setResults([]);return}
    setLoading(true)
    api<{tests:TestItem[]}>(`/tests?q=${encodeURIComponent(searchQuery.trim())}`)
      .then(d=>{if(!cancelled)setResults(d.tests||[])})
      .catch(()=>{if(!cancelled)setResults([])})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return ()=>{cancelled=true}
  },[searchQuery])

  const addTest=(test:TestItem)=>{
    if(existingCodes.has(test.test_no))return
    onChange([...tests,test])
  }
  const removeTest=(code:string)=>{
    onChange(tests.filter(t=>t.test_no!==code))
  }

  const isConfirmedOrLater=status==='CONFIRMED'||status==='DONE'
  const canEdit=mode==='original'?status==='PENDING':status==='CONFIRMED'

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="grid gap-1 text-sm">
          <label>Search tests by name or code</label>
          <input
            value={searchQuery}
            onChange={e=>setSearchQuery(e.target.value)}
            placeholder={mode==='extra'?'Type to search extra tests...':'Type to search tests...'}
            className="rounded-lg border px-3 py-2"
          />
        </div>
      )}
      {canEdit && results.length>0 && (
        <div className="max-h-48 overflow-auto rounded-lg border p-2 space-y-1">
          {results.map(t=>(
            <button
              key={t.test_no}
              type="button"
              onClick={()=>addTest(t)}
              disabled={existingCodes.has(t.test_no)}
              className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                existingCodes.has(t.test_no)
                  ? 'opacity-50 cursor-not-allowed bg-slate-100'
                  : 'hover:bg-slate-50'
              }`}
            >
              <span className="font-mono text-xs text-slate-600">{t.test_no}</span>
              <span className="flex-1 truncate">{t.analysis_name}</span>
              <span className="text-xs text-slate-500">{t.patient_price!=null?t.patient_price:'0'} EGP</span>
              {existingCodes.has(t.test_no) && <span className="text-xs text-green-600">Added</span>}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <label className="text-sm font-medium">{mode==='extra'?'Extra tests':'Selected tests'} ({tests.length})</label>
        {tests.length===0 ? (
          <p className="text-sm text-slate-500">{mode==='extra'?'No extra tests added':'No tests selected'}</p>
        ) : (
          <ul className="space-y-1">
            {tests.map((t,i)=>(
              <li key={`${t.test_no}-${i}`} className="flex items-center gap-2 rounded bg-slate-50 px-3 py-2">
                <span className="font-mono text-xs text-slate-600">{t.test_no}</span>
                <span className="flex-1 truncate">{t.analysis_name}</span>
                <span className="text-xs text-slate-500">{t.patient_price!=null?t.patient_price:'0'} EGP</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={()=>removeTest(t.test_no)}
                    className="text-red-600 hover:text-red-800 text-sm"
                    aria-label={`Remove ${t.analysis_name}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EditForm({
  draft,
  setDraft,
  onSave,
  onClose,
  busy,
  status,
  originalTotal,
  originalTests,
  extraTests,
  setExtraTests,
  canAddExtraTests
}:{
  draft:Draft;
  setDraft:(x:Draft)=>void;
  onSave:()=>void;
  onClose:()=>void;
  busy:boolean;
  status:string;
  originalTotal?:number;
  originalTests:TestItem[];
  extraTests:TestItem[];
  setExtraTests:(t:TestItem[])=>void;
  canAddExtraTests:boolean;
}){
  const isConfirmed=status==='CONFIRMED'
  const isDone=status==='DONE'
  const canEditPatient=status==='PENDING'||status==='CONFIRMED'
  const canEditOriginalTests=status==='PENDING'

  const handleTestsChange=useCallback((newTests:TestItem[])=>{
    setDraft({...draft,tests:newTests})
  },[draft])

  return (
    <form onSubmit={e=>{e.preventDefault();onSave()}} className="mt-5 space-y-4">
      {canEditPatient && (
        <>
        <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Patient name
              <input required value={draft.patient_name} onChange={e=>setDraft({...draft,patient_name:e.target.value})} className="rounded-lg border px-3 py-2" disabled={!canEditPatient}/>
            </label>
            <label className="grid gap-1 text-sm">
              Age
              <input required min="0" max="120" type="number" value={draft.age} onChange={e=>setDraft({...draft,age:e.target.value})} className="rounded-lg border px-3 py-2" disabled={!canEditPatient}/>
            </label>
            <label className="grid gap-1 text-sm">
              Gender
              <select required value={draft.gender} onChange={e=>setDraft({...draft,gender:e.target.value})} className="rounded-lg border px-3 py-2" disabled={!canEditPatient}>
                <option value="">Select</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Phone
              <input required value={draft.phone} onChange={e=>setDraft({...draft,phone:e.target.value})} className="rounded-lg border px-3 py-2" disabled={!canEditPatient}/>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Preferred date/time
              <input type="datetime-local" value={draft.preferred_at} onChange={e=>setDraft({...draft,preferred_at:e.target.value})} className="rounded-lg border px-3 py-2" disabled={!canEditPatient}/>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Address
              <textarea rows={3} value={draft.address} onChange={e=>setDraft({...draft,address:e.target.value})} className="rounded-lg border px-3 py-2" disabled={!canEditPatient}/>
            </label>
          </div>
        </>
      )}

      <div className="border-t pt-4">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Original tests (historical)</span>
          <TestSelector
            tests={canEditOriginalTests ? draft.tests : originalTests}
            onChange={canEditOriginalTests ? handleTestsChange : ()=>{}}
            status={status}
            mode="original"
            blockedTests={canEditOriginalTests ? undefined : originalTests}
          />
          {status==='PENDING' && (
            <p className="text-xs text-slate-500">
              Original total preserved: {originalTotal!=null?originalTotal+' EGP':'—'}
              . Historical pricing for original tests is maintained.
            </p>
          )}
        </label>
      </div>

      {isConfirmed && canAddExtraTests && (
        <div className="border-t pt-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Extra tests</span>
            <TestSelector
              tests={extraTests}
              onChange={setExtraTests}
              status={status}
              mode="extra"
              blockedTests={originalTests}
            />
            <p className="text-xs text-amber-600">
              Extra tests are billed separately. Commission rate: 5%.
            </p>
          </label>
        </div>
      )}

      {isConfirmed && canAddExtraTests && extraTests.length>0 && (
        <div className="rounded-lg bg-amber-50 p-3 border border-amber-200">
          <p className="text-sm font-medium text-amber-800">Pending extra tests to be added on save:</p>
          <ul className="mt-1 ml-4 list-disc text-sm text-amber-700">
            {extraTests.map((t,i)=>(
              <li key={`${t.test_no}-${i}`}>{t.test_no} — {t.analysis_name} ({t.patient_price!=null?t.patient_price:'0'} EGP)</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-4 py-2">Cancel</button>
        <button type="submit" disabled={busy||(canEditOriginalTests&&draft.tests.length===0)} className="rounded-lg bg-slate-900 px-4 py-2 text-white">
          {busy?'Saving…':'Save changes'}
        </button>
      </div>
    </form>
  )
}

function Performance({from,to,setFrom,setTo,data,load}:{from:string;to:string;setFrom:(x:string)=>void;setTo:(x:string)=>void;data:any;load:()=>void}){
  return (
    <section className="mt-5 rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">My performance</h2>
          <p className="text-sm text-slate-500">Completed values use finalized financial records.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1 text-xs"><span>From</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="rounded-lg border px-2 py-2 text-sm"/></label>
          <label className="grid gap-1 text-xs"><span>To</span><input type="date" value={to} onChange={e=>setTo(e.target.value)} className="rounded-lg border px-2 py-2 text-sm"/></label>
          <button onClick={load} className="rounded-lg border px-3 py-2 text-sm">Apply</button>
        </div>
      </div>
      {data&&<div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>Bookings <b>{data.bookings}</b></div>
        <div>Patients <b>{data.patients}</b></div>
        <div>Accepted <b>{data.accepted}</b></div>
        <div>Confirmed <b>{data.confirmed}</b></div>
        <div>Done <b>{data.done}</b></div>
        <div>Completion rate <b>{(Number(data.completion_rate)*100).toFixed(1)}%</b></div>
        <div>Earned commission <b>{data.earned_commission}</b></div>
        <div>Paid commission <b>{data.paid_commission}</b></div>
        <div>Outstanding commission <b>{data.outstanding_commission}</b></div>
        <div>Visit fees <b>{data.visit_fees}</b></div>
        <div>Extra-test commission <b>{data.extra_test_commission}</b></div>
        <div>Tests <b>{data.tests}</b></div>
      </div>}
    </section>
  )
}

function TargetPanel({targets}:{targets:any[]}){
  return (
    <section className="mt-5 rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-bold">Target progress</h2>
      {targets.length?(
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {targets.map(target=>(
            <div key={target.id} className="rounded-xl border p-4">
              <div className="text-sm text-slate-500">{target.period_start} to {target.period_end}</div>
              <div className="mt-2 text-2xl font-bold">{target.actual} / {target.target_value}</div>
              <div className="text-sm">{Math.round(Number(target.percentage)*100)}% achieved · {target.remaining>0?`${target.remaining} remaining`:'Target reached'}</div>
            </div>
          ))}
        </div>
      ):(
        <p className="mt-2 text-sm text-slate-500">No active target configured.</p>
      )}
    </section>
  )
}

export default function Dashboard(){
  const [me,setMe]=useState<any>(null)
  const [rows,setRows]=useState<Booking[]>([])
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const [newPass,setNewPass]=useState('')
  const [selected,setSelected]=useState<Booking|null>(null)
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState<Draft|null>(null)
  const [extraTests,setExtraTests]=useState<TestItem[]>([])
  const [from,setFrom]=useState(today())
  const [to,setTo]=useState(today())
  const [performance,setPerformance]=useState<any>(null)
  const [targets,setTargets]=useState<any[]>([])

  const load=async()=>{
    try{
      const m=await api<any>('/me')
      if(!m.user)throw Error('Unauthorized')
      setMe(m)
      const x=await api<any>('/my/bookings')
      setRows(x.bookings||[])
    }catch(e:any){
      setMsg(e.message)
      if(e.message==='Unauthorized')location.href='/login'
    }
  }

  const loadPerformance=async()=>{
    try{setPerformance(await api<any>(`/me/performance?from=${from}&to=${to}`))}catch(e:any){setMsg(e.message)}
  }

  const loadTargets=async()=>{
    try{setTargets((await api<any>('/me/targets')).targets||[])}catch(e:any){setMsg(e.message)}
  }

  useEffect(()=>{load()},[])
  useEffect(()=>{if(me){loadPerformance();loadTargets()}},[me])

  async function status(ref:string,status:string){
    try{
      setBusy(true)
      await api(`/bookings/${encodeURIComponent(ref)}/status`,{method:'POST',body:JSON.stringify({status})})
      await load()
      setSelected(null)
    }catch(e:any){setMsg(e.message)}finally{setBusy(false)}
  }

  async function savePassword(){
    try{
      await api('/change-password',{method:'POST',body:JSON.stringify({new_password:newPass})})
      setNewPass('')
      setMsg('Password changed.')
    }catch(e:any){setMsg(e.message)}
  }

  async function saveEdit(){
    if(!selected||!draft)return
    try{
      setBusy(true)
      const isConfirmed=selected.status==='CONFIRMED'
      const originalTestCodes=draft.tests.map(t=>({code:t.test_no}))
      const body={
        patient_name:draft.patient_name,
        age:Number(draft.age)||null,
        gender:draft.gender,
        phone:draft.phone,
        address:draft.address,
        preferred_at:draft.preferred_at,
        tests:originalTestCodes
      }
      const res=await api<{ok:boolean;reference:string;total:number}>(`/bookings/${encodeURIComponent(selected.reference)}`,{method:'PUT',body:JSON.stringify(body)})
      if(!res.ok)throw new Error('Server returned error')

      if(isConfirmed && extraTests.length>0){
        const extraCodes=extraTests.map(t=>({code:t.test_no}))
        await api(`/bookings/${encodeURIComponent(selected.reference)}/extra-tests`,{method:'POST',body:JSON.stringify({tests:extraCodes})})
      }

      setMsg('Reservation updated.')
      setEditing(false)
      setExtraTests([])
      await load()
      const x=await api<any>(`/bookings/${encodeURIComponent(selected.reference)}`)
      setSelected({...x.booking,extra_tests:x.extra_tests})
    }catch(e:any){
      const msg=e?.message||e?.error||'Failed to update reservation'
      setMsg(msg)
    }finally{
      setBusy(false)
    }
  }

  if(!me)return <main className="p-6">Loading…</main>
  const p=me.user.permissions||[]

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl bg-slate-900 p-6 text-white">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{me.user.display_name}</h1>
              <p className="mt-1 text-sm text-slate-300">{me.user.user_type}</p>
            </div>
            <button onClick={async()=>{
              try{await api('/logout',{method:'POST'})}finally{localStorage.removeItem('mtb_user_token');location.href='/login'}
            }} className="rounded-lg border border-white/20 px-3 py-2">Logout</button>
          </div>
        </header>
        {msg&&<div className="mt-4 rounded-xl border bg-white p-3 text-sm">{msg}</div>}
        <Performance from={from} to={to} setFrom={setFrom} setTo={setTo} data={performance} load={loadPerformance}/>
        <TargetPanel targets={targets}/>
        <section className="mt-5 rounded-2xl border bg-white p-5">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">My / Assigned Reservations</h2>
              <p className="text-sm text-slate-500">Status and actions are enforced by your permissions.</p>
            </div>
            <button onClick={load} className="rounded-lg border px-3 py-2">Refresh</button>
          </div>
          <div className="mt-4 grid gap-3">
            {rows.map(b=>(
              <article key={b.reference} className="rounded-xl border p-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <div dir="auto" className="font-bold">{b.patient_name}</div>
                    <div className="text-sm text-slate-500">{b.reference} · {b.phone} · {b.total} EGP</div>
                    <div className="mt-1 text-sm">Status: <b>{b.status}</b>{b.assigned_name&&` · Assigned: ${b.assigned_name}`}</div>
                  </div>
                  <button
                    onClick={async()=>{
                      const x=await api<any>(`/bookings/${encodeURIComponent(b.reference)}`)
                      setSelected({...x.booking,extra_tests:x.extra_tests})
                      setExtraTests([])
                      setEditing(false)
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                  >Details</button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {b.status==='PENDING' && p.includes('edit_own_pending_reservations') && (
                    <button
                      onClick={()=>{setSelected(b);setDraft(draftFor(b));setExtraTests([]);setEditing(true)}}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >Edit reservation</button>
                  )}
                  {b.status==='CONFIRMED' && p.includes('edit_confirmed_assigned_reservations') && (
                    <button
                      onClick={()=>{setSelected(b);setDraft(draftFor(b));setExtraTests([]);setEditing(true)}}
                      className="rounded-lg border px-3 py-2 text-sm"
                    >Edit confirmed reservation</button>
                  )}
                  {b.status==='ASSIGNED' && p.includes('accept_assigned_reservations') && (
                    <button disabled={busy} onClick={()=>status(b.reference,'ACCEPTED')} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Accept Reservation</button>
                  )}
                  {b.status==='ACCEPTED' && p.includes('confirm_visits') && (
                    <button disabled={busy} onClick={()=>status(b.reference,'CONFIRMED')} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Confirm Visit</button>
                  )}
                  {b.status==='CONFIRMED' && p.includes('mark_visits_done') && (
                    <button disabled={busy} onClick={()=>status(b.reference,'DONE')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white">Mark Done</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
        {selected && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6">
              <div className="flex justify-between">
                <h2 className="text-xl font-bold">{selected.reference}</h2>
                <button onClick={()=>{setSelected(null);setEditing(false);setExtraTests([])}}>✕</button>
              </div>
              {editing && draft ? (
                <EditForm
                  draft={draft}
                  setDraft={setDraft}
                  onSave={saveEdit}
                  onClose={()=>{setEditing(false);setExtraTests([])}}
                  busy={busy}
                  status={selected.status}
                  originalTotal={selected.original_total}
                  originalTests={parseTests(selected.tests_json||'[]')}
                  extraTests={extraTests}
                  setExtraTests={setExtraTests}
                  canAddExtraTests={p.includes('add_extra_tests')}
                />
              ) : (
                <>
                  <div className="mt-4 grid gap-2 text-sm">
                    <div>Patient: <b dir="auto">{selected.patient_name}</b></div>
                    <div>Phone: {selected.phone}</div>
                    <div>Status: <b>{selected.status}</b></div>
                    <div>Total: <b>{selected.total} EGP</b></div>
                    {selected.original_total!=null && <div>Original total: <b>{selected.original_total} EGP</b></div>}
                    {selected.address&&<div>Address: {selected.address}</div>}
                    <div className="mt-2">
                      <b>Original tests:</b>
                      <ul className="mt-1 ml-4 list-disc text-sm">
                        {(JSON.parse(selected.tests_json||'[]') as TestItem[]).map((t,i)=>(
                          <li key={`${t.test_no}-${i}`}>{t.test_no} — {t.analysis_name} {t.patient_price!=null?`(${t.patient_price} EGP)`:''}</li>
                        ))}
                      </ul>
                    </div>
                    {selected.extra_tests && selected.extra_tests.length>0 && (
                      <div className="mt-2">
                        <b>Extra tests:</b>
                        <ul className="mt-1 ml-4 list-disc text-sm">
                          {selected.extra_tests.map((t:any,i:number)=>(
                            <li key={`${t.test_no}-${i}`}>{t.test_no} — {t.analysis_name} ({t.price} EGP)</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="mt-5 flex justify-end">
                    <button onClick={()=>{setSelected(null);setExtraTests([])}} className="rounded-lg border px-4 py-2">Close</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
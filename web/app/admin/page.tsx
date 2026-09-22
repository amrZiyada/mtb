'use client'
import {useEffect,useState} from 'react'
import * as XLSX from 'xlsx'
import {api} from '../../lib/api'
import {APP_VERSION} from '../../lib/version'
const headers=['#','Analysis name','Unit','Ref. range','Specimen','Duration','Price','Contract','Patient']
function cell(r:any[],i:number){return i<0?'':String(r[i]??'').trim()}
function num(v:any){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:NaN}
function parseSheet(ws:XLSX.WorkSheet){const m=XLSX.utils.sheet_to_json<any[]>(ws,{header:1,defval:'',raw:true});const req=['#','Analysis name','Unit','Ref. range','Specimen','Duration','Price'];const hi=m.findIndex(r=>req.every(h=>r.some((v:any)=>String(v??'').trim()===h)));if(hi<0)throw Error('Approved price-list header not found');const h=m[hi],c:any={};for(const x of req)c[x]=h.findIndex((v:any)=>String(v??'').trim()===x);c.Contract=h.findIndex((v:any)=>String(v??'').trim()==='Contract');c.Patient=h.findIndex((v:any)=>String(v??'').trim()==='Patient');const out:any[]=[];let cur:any=null;for(let i=hi+1;i<m.length;i++){const r=m[i];if(!r.some((v:any)=>String(v??'').trim()))continue;const name=cell(r,c['Analysis name']),no=cell(r,c['#']),price=num(r[c.Price]);if(name&&(no||Number.isFinite(price))){cur={test_no:no||`AUTO-${i+1}`,analysis_name:name,unit:cell(r,c.Unit),ref_range:cell(r,c['Ref. range']),specimen:cell(r,c.Specimen),duration:Number.isFinite(num(r[c.Duration]))?num(r[c.Duration]):0,price:Number.isFinite(price)?price:num(r[c.Patient]),contract_price:c.Contract>=0?num(r[c.Contract]):0,patient_price:c.Patient>=0&&Number.isFinite(num(r[c.Patient]))?num(r[c.Patient]):price};out.push(cur);continue}if(cur&&name)cur.analysis_name+=`\n${name}`}return out}
function fmt(v:any){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString()}
function isoDate(d:Date){return d.toISOString().slice(0,10)}
function rangeFor(preset:string){const end=new Date(),start=new Date(end);if(preset==='today'){}else if(preset==='week'){start.setDate(end.getDate()-end.getDay())}else if(preset==='month'){start.setDate(1)}return {from:isoDate(start),to:isoDate(end)}}
const rateKeys=['salesman_base_rate','salesman_bonus_rate','doctor_base_rate','doctor_bonus_rate','rep_base_rate','rep_bonus_rate','extra_tests_rate']
const settingLabels:any={salesman_base_rate:'Salesman base %',salesman_bonus_rate:'Salesman bonus %',doctor_base_rate:'Doctor base %',doctor_bonus_rate:'Doctor bonus %',rep_base_rate:'Rep base %',rep_bonus_rate:'Rep bonus %',extra_tests_rate:'Extra tests %',daily_patient_threshold:'Daily bonus threshold',doctor_visit_fee:'Doctor visit fee',rep_visit_fee:'Rep visit fee',edit_pending_hours:'Pending edit hours'}

function AdminEditForm({booking, onClose, onSave, busy}:{booking:any; onClose:()=>void; onSave:()=>void; busy:boolean}){
  const [form,setForm]=useState<any>({
    patient_name:booking.patient_name||'',
    age:booking.age??'',
    gender:booking.gender||'',
    phone:booking.phone||'',
    preferred_at:booking.preferred_at||'',
    address:booking.address||'',
  })
  const [reservedTests,setReservedTests]=useState<any[]>([])
  const [searchQ,setSearchQ]=useState('')
  const [searchResults,setSearchResults]=useState<any[]>([])
  const [searching,setSearching]=useState(false)
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)

  const isFinalized = booking.status==='DONE'||!!booking.done_at
  const isConfirmed = booking.status==='CONFIRMED'

  useEffect(()=>{
    try{
      const tests = JSON.parse(booking.tests_json||'[]')
      setReservedTests(tests.map((t:any)=>({code:t.test_no,name:t.analysis_name,specimen:t.specimen||'',price:t.patient_price||0})))
    }catch{setReservedTests([])}
  },[booking])

  async function doSearch(q:string){
    setSearchQ(q)
    if(!q.trim()){setSearchResults([]);return}
    setSearching(true)
    try{
      const x=await api<any>(`/admin/tests?q=${encodeURIComponent(q)}`)
      setSearchResults(x.tests||[])
    }catch(e:any){setError(e.message)}
    finally{setSearching(false)}
  }

  function addTest(test:any){
    if(reservedTests.some(t=>t.code===test.test_no)) return
    setReservedTests([...reservedTests,{code:test.test_no,name:test.analysis_name,specimen:test.specimen||'',price:test.patient_price||0}])
    setSearchQ('')
    setSearchResults([])
    setError('')
  }

  function removeTest(code:string){
    setReservedTests(reservedTests.filter(t=>t.code!==code))
  }

  async function handleSave(){
    setError('')
    if(reservedTests.length===0){
      setError('At least one test is required')
      return
    }
    try{
      setSaving(true)
      const codes = reservedTests.map(t=>t.code)
      await api(`/bookings/${encodeURIComponent(booking.reference)}`,{
        method:'PUT',
        body:JSON.stringify({
          ...form,
          age:form.age?Number(form.age):null,
          tests:codes.map(code=>({code})),
        })
      })
      onSave()
      onClose()
    }catch(e:any){
      setError(e.message)
    }finally{
      setSaving(false)
    }
  }

  if(!booking) return null

  const originalTests = JSON.parse(booking.tests_json||'[]')
  const extraTests = booking.extra_tests||[]

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold">{booking.reference}</h2>
            <p className="text-sm text-slate-500">Status: <b>{booking.status}</b>{isConfirmed&&' · Extra Tests are managed separately'}</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none hover:text-slate-600">✕</button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Patient name<input value={form.patient_name} onChange={e=>setForm({...form,patient_name:e.target.value})} className="rounded-lg border px-3 py-2" disabled={isFinalized}/></label>
          <label className="grid gap-1 text-sm">Phone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} className="rounded-lg border px-3 py-2" disabled={isFinalized}/></label>
          <label className="grid gap-1 text-sm">Age<input type="number" min="0" max="120" value={form.age} onChange={e=>setForm({...form,age:e.target.value})} className="rounded-lg border px-3 py-2" disabled={isFinalized}/></label>
          <label className="grid gap-1 text-sm">Gender<select value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})} className="rounded-lg border px-3 py-2" disabled={isFinalized}><option value="">—</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></label>
          <label className="grid gap-1 text-sm">Preferred date/time<input type="datetime-local" value={form.preferred_at?.slice(0,16)||''} onChange={e=>setForm({...form,preferred_at:e.target.value})} className="rounded-lg border px-3 py-2" disabled={isFinalized}/></label>
          <label className="grid gap-1 text-sm sm:col-span-2">Address<textarea value={form.address} onChange={e=>setForm({...form,address:e.target.value})} rows={2} className="rounded-lg border px-3 py-2" disabled={isFinalized}/></label>
        </div>

        <div className="mt-5">
          <h3 className="font-semibold">Reserved Tests {reservedTests.length?`(${reservedTests.length})`:''}</h3>
          {isConfirmed && (
            <p className="text-xs text-amber-700 mt-1">Confirmed reservation — Reserved Tests are locked. Extra Tests are managed separately.</p>
          )}
          <div className="mt-2 flex gap-2">
            <input
              value={searchQ}
              onChange={e=>doSearch(e.target.value)}
              placeholder="Search test by name or number to add…"
              className="flex-1 rounded-lg border px-3 py-2"
              disabled={isFinalized || isConfirmed}
              autoComplete="off"
            />
          </div>
          {searching && <p className="text-xs text-slate-500 mt-1">Searching…</p>}
          {searchResults.length>0 && (
            <div className="mt-2 max-h-48 overflow-auto rounded-lg border bg-slate-50 p-2">
              {searchResults.map(t=><button
                key={t.test_no}
                type="button"
                onClick={()=>addTest(t)}
                disabled={reservedTests.some(rt=>rt.code===t.test_no)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed flex justify-between gap-2"
              ><span><b>{t.test_no}</b> · {t.analysis_name}</span><span className="text-xs text-slate-500">{t.specimen||''}</span></button>)}
            </div>
          )}

          <div className="mt-3 space-y-2">
            {reservedTests.length===0 && !isFinalized && !isConfirmed && (
              <p className="text-sm text-slate-500">No reserved tests. Search and add tests above.</p>
            )}
            {reservedTests.map((t,i)=>(<div key={t.code} className="flex items-center justify-between gap-2 rounded-lg border p-2 bg-white">
              <div className="flex-1 min-w-0"><span className="font-mono text-sm">{t.code}</span> · <span dir="auto">{t.name}</span> <span className="text-xs text-slate-500">({t.specimen})</span></div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">{t.price} EGP</span>
                {!isFinalized && !isConfirmed && <button type="button" onClick={()=>removeTest(t.code)} className="text-red-600 hover:text-red-800 text-sm font-medium">Remove</button>}
              </div>
            </div>))}
          </div>
        </div>

        {isConfirmed && extraTests.length>0 && (
          <div className="mt-5 border-t pt-4">
            <h3 className="font-semibold">Extra Tests (read-only)</h3>
            <div className="mt-2 space-y-1">
              {extraTests.map((t:any)=>(<div key={t.test_no} className="flex items-center justify-between gap-2 rounded-lg border p-2 bg-slate-50"><div className="flex-1 min-w-0"><span className="font-mono text-sm">{t.test_no}</span> · <span dir="auto">{t.analysis_name}</span></div><span className="text-sm text-slate-600">{t.price} EGP</span></div>))}
            </div>
          </div>
        )}

        {error && <div className="mt-3 text-sm text-red-700">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy||saving} className="rounded-lg border px-4 py-2">Close</button>
          {!isFinalized && !isConfirmed && <button onClick={handleSave} disabled={busy||saving||reservedTests.length===0} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Save Changes</button>}
          {isConfirmed && <button onClick={onClose} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Done</button>}
        </div>
      </div>
    </div>
  )
}

export default function Admin(){
  const [pass,setPass]=useState(''),[logged,setLogged]=useState(false),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[bookings,setBookings]=useState<any[]>([]),[users,setUsers]=useState<any[]>([]),[permissions,setPermissions]=useState<string[]>([]),[tab,setTab]=useState<'bookings'|'users'|'commission'|'catalog'|'finance'|'statistics'|'targets'>('bookings'),[selected,setSelected]=useState<any>(null),[settings,setSettings]=useState<any>(null),[catalogRows,setCatalogRows]=useState<any[]>([]),[catalogQ,setCatalogQ]=useState(''),[catalog,setCatalog]=useState<any[]>([]),[userForm,setUserForm]=useState<any>({username:'',display_name:'',password:'',mobile:'',user_type:'DOCTOR',active:true,permissions:[]}),[editingUser,setEditingUser]=useState<number|null>(null),[payment,setPayment]=useState<any>({user_id:'',amount:'',note:'',type:'commission'}),[finance,setFinance]=useState<any[]>([]),[adminCurrent,setAdminCurrent]=useState(''),[adminNext,setAdminNext]=useState(''),[statPreset,setStatPreset]=useState('today'),[statFrom,setStatFrom]=useState(rangeFor('today').from),[statTo,setStatTo]=useState(rangeFor('today').to),[stats,setStats]=useState<any>(null),[priceLists,setPriceLists]=useState<any[]>([]),[activePriceListId,setActivePriceListId]=useState<number|null>(null),[priceListName,setPriceListName]=useState('')
  const [editingBooking,setEditingBooking]=useState<any>(null)
  const [newBooking,setNewBooking]=useState<any>({patient_name:'',age:'',gender:'',phone:'',address:'',preferred_at:''})
  const [newBookingTests,setNewBookingTests]=useState<any[]>([])
  const [newBookingQ,setNewBookingQ]=useState('')
  const [newBookingResults,setNewBookingResults]=useState<any[]>([])
  const [bookingQ,setBookingQ]=useState('')
  const [bookingSort,setBookingSort]=useState('registration')
  const [bookingDir,setBookingDir]=useState('desc')

  async function searchNewBookingTests(q:string){
    setNewBookingQ(q)
    if(!q.trim()){setNewBookingResults([]);return}
    try{
      const x=await api<any>(`/tests?q=${encodeURIComponent(q)}`)
      setNewBookingResults(x.tests||[])
    }catch(e:any){setMsg(e.message)}
  }

  function addNewBookingTest(t:any){
    if(newBookingTests.some(x=>x.test_no===t.test_no))return
    setNewBookingTests(x=>[...x,t])
    setNewBookingQ('')
    setNewBookingResults([])
  }

  async function createBooking(){
    try{
      if(!newBooking.patient_name.trim()||!newBooking.phone.trim()||!newBookingTests.length){
        setMsg('Patient name, phone, and at least one test are required.')
        return
      }

      const duplicateCheck=await api<any>(`/bookings/check-duplicate?name=${encodeURIComponent(newBooking.patient_name.trim())}&phone=${encodeURIComponent(newBooking.phone.trim())}`)
      if((duplicateCheck.duplicates||[]).length){
        const proceed=window.confirm(
          `A pending reservation already exists for this patient or phone number.\\n\\nCreate another reservation anyway?`
        )
        if(!proceed)return
      }

      setBusy(true)
      const x=await api<any>('/bookings',{method:'POST',body:JSON.stringify({
        ...newBooking,
        age:Number(newBooking.age)||null,
        tests:newBookingTests.map(t=>({code:t.test_no}))
      })})
      setNewBooking({patient_name:'',age:'',gender:'',phone:'',address:'',preferred_at:''})
      setNewBookingTests([])
      setNewBookingQ('')
      setNewBookingResults([])
      await loadBookings()
      setMsg(`Reservation created: ${x.reference}`)
    }catch(e:any){setMsg(e.message)}
    finally{setBusy(false)}
  }

const loadBookings=async(q=bookingQ,sort=bookingSort,dir=bookingDir)=>{
    try{
      const x=await api<any>(`/admin/bookings?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}&dir=${encodeURIComponent(dir)}`)
      setBookings(x.bookings||[])
    }catch(e:any){setMsg(e.message)}
  }
  const loadPriceLists=async()=>{
    try{
      const x=await api<any>('/admin/price-lists');
      setPriceLists(x.price_lists||[]);
      setActivePriceListId(x.active_id??null);
    }catch(e:any){
      setMsg(e.message);
    }
  }

  const load=async()=>{try{const [u,s,f]=await Promise.all([api<any>('/admin/users'),api<any>('/admin/commission-settings'),api<any>('/admin/financials')]);await loadBookings();await loadPriceLists();setUsers(u.users||[]);setPermissions(u.permissions||[]);setSettings(s.settings);setFinance(f.users||[])}catch(e:any){setMsg(e.message)}}
  const loadStats=async(from=statFrom,to=statTo)=>{try{setStats(await api<any>(`/admin/statistics?from=${from}&to=${to}`))}catch(e:any){setMsg(e.message)}}
  const [targets,setTargets]=useState<any[]>([]),[targetForm,setTargetForm]=useState<any>({user_id:'',period_start:`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`,period_end:isoDate(new Date()),metric:'PATIENTS',target_value:'',active:true}),[editingTarget,setEditingTarget]=useState<number|null>(null)
  const loadTargets=async()=>{try{setTargets((await api<any>('/admin/targets')).targets||[])}catch(e:any){setMsg(e.message)}}
  useEffect(()=>{api<any>('/admin/me').then(x=>{if(x.admin)setLogged(true)}).catch(()=>{})},[]);useEffect(()=>{if(logged){load();loadStats();loadTargets()}},[logged])
  async function login(){try{const result=await api<{token:string}>('/admin/login',{method:'POST',body:JSON.stringify({password:pass})});localStorage.setItem('mtb_admin_token',result.token);setLogged(true)}catch(e:any){setMsg(e.message)}}
  async function changePassword(){try{setBusy(true);await api('/admin/change-password',{method:'POST',body:JSON.stringify({current_password:adminCurrent,new_password:adminNext})});setAdminCurrent('');setAdminNext('');setMsg('Admin password changed.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function status(ref:string,status:string){try{setBusy(true);await api(`/admin/bookings/${encodeURIComponent(ref)}/status`,{method:'POST',body:JSON.stringify({status})});await load();setMsg(`Status changed to ${status}.`)}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function assign(ref:string,id:string){try{setBusy(true);await api(`/admin/bookings/${encodeURIComponent(ref)}/assign`,{method:'POST',body:JSON.stringify({user_id:Number(id)})});await load();setMsg('Reservation assigned.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function removeBooking(ref:string){if(!window.confirm('Delete this non-finalized reservation?'))return;try{setBusy(true);await api(`/admin/bookings/${encodeURIComponent(ref)}`,{method:'DELETE'});setBookings(x=>x.filter(b=>b.reference!==ref));setMsg('Reservation deleted.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function saveTarget(){try{setBusy(true);const url=editingTarget?`/admin/targets/${editingTarget}`:'/admin/targets';await api(url,{method:editingTarget?'PUT':'POST',body:JSON.stringify({...targetForm,user_id:Number(targetForm.user_id),target_value:Number(targetForm.target_value)})});setTargetForm({user_id:'',period_start:`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-01`,period_end:isoDate(new Date()),metric:'PATIENTS',target_value:'',active:true});setEditingTarget(null);await loadTargets();setMsg('Target saved.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function removeTarget(id:number){if(!window.confirm('Delete this target?'))return;try{setBusy(true);await api(`/admin/targets/${id}`,{method:'DELETE'});setTargets(x=>x.filter(t=>t.id!==id));setMsg('Target deleted.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function saveUser(){try{setBusy(true);const method=editingUser?'PUT':'POST';const url=editingUser?`/admin/users/${editingUser}`:'/admin/users';await api(url,{method,body:JSON.stringify(userForm)});setUserForm({username:'',display_name:'',password:'',mobile:'',user_type:'DOCTOR',active:true,permissions:[]});setEditingUser(null);await load();setMsg('User saved.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function saveSettings(){try{setBusy(true);await api('/admin/commission-settings',{method:'PUT',body:JSON.stringify(settings)});await load();setMsg('Commission settings saved.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function pay(){try{setBusy(true);await api(payment.type==='commission'?'/admin/payments/commission':'/admin/payments/visit-fee',{method:'POST',body:JSON.stringify({user_id:Number(payment.user_id),amount:Number(payment.amount),note:payment.note})});setPayment({user_id:'',amount:'',note:'',type:payment.type});await load();setMsg('Payment recorded.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  async function importCatalog(){
  const name=priceListName.trim();

  if(!name){
    setMsg('Enter a price-list name before publishing.');
    return;
  }

  try{
    setBusy(true);

    const x=await api<any>('/admin/price-lists/import',{
      method:'POST',
      body:JSON.stringify({
        name,
        tests:catalogRows
      })
    });

    setCatalogRows([]);
    setPriceListName('');
    setCatalog([]);
    setCatalogQ('');
    await loadPriceLists();

    setMsg(`Published "${x.name}" with ${x.count} tests.`);
  }catch(e:any){
    setMsg(e.message);
  }finally{
    setBusy(false);
  }
}
  async function activatePriceList(id:number){
  if(id===activePriceListId)return;

  try{
    setBusy(true);

    const x=await api<any>(`/admin/price-lists/${id}/activate`,{
      method:'POST'
    });

    setActivePriceListId(id);
    await loadPriceLists();
    setCatalog([]);

    if(catalogQ.trim()){
      const r=await api<any>(`/admin/tests?q=${encodeURIComponent(catalogQ)}`);
      setCatalog(r.tests||[]);
    }

    setMsg(`Active price list: ${x.name||'selected list'}.`);
  }catch(e:any){
    setMsg(e.message);
  }finally{
    setBusy(false);
  }
}

async function searchCatalog(q:string){setCatalogQ(q);if(!q.trim()){setCatalog([]);return}try{const x=await api<any>(`/admin/tests?q=${encodeURIComponent(q)}`);setCatalog(x.tests||[])}catch(e:any){setMsg(e.message)}}
  function choosePreset(value:string){setStatPreset(value);if(value!=='custom'){const r=rangeFor(value);setStatFrom(r.from);setStatTo(r.to);loadStats(r.from,r.to)}}
  const doctorReps=users.filter(u=>u.active&&['DOCTOR','REP'].includes(u.user_type))

  function openEdit(b:any){setEditingBooking(b);setSelected(null)}

  if(!logged)return <main className="min-h-screen grid place-items-center bg-slate-50 p-4"><div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow"><h1 className="text-xl font-bold">Admin login</h1><input autoFocus type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} placeholder="Password" className="mt-4 w-full rounded-xl border px-3 py-3"/><button onClick={login} className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-white">Login</button>{msg&&<p className="mt-3 text-sm text-red-700">{msg}</p>}</div></main>
  return <main className="min-h-screen bg-slate-50 p-4"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 p-5 text-white"><div><h1 className="text-2xl font-bold">Booking Lab Admin</h1><p className="text-sm text-slate-300">v{APP_VERSION}</p></div><div className="flex gap-2"><button onClick={load} className="rounded-lg border border-white/20 px-3 py-2">Refresh</button><button onClick={async()=>{try{await api('/logout',{method:'POST'})}finally{localStorage.removeItem('mtb_admin_token');location.reload()}}} className="rounded-lg border border-white/20 px-3 py-2">Logout</button></div></header>{msg&&<div className="mt-4 rounded-xl border bg-white p-3 text-sm">{msg}</div>}
  <nav className="mt-4 flex flex-wrap gap-2">{(['bookings','users','commission','catalog','finance','statistics','targets'] as const).map(x=><button key={x} onClick={()=>setTab(x)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab===x?'bg-slate-900 text-white':'border bg-white'}`}>{x}</button>)}</nav>
  {tab==='bookings'&&<section className="mt-4 grid gap-3">
    <div className="rounded-2xl border bg-white p-5">
      <h2 className="font-bold">Create reservation</h2>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <input value={newBooking.patient_name} onChange={e=>setNewBooking({...newBooking,patient_name:e.target.value})} placeholder="Patient name" className="rounded-lg border px-3 py-2"/>
        <input type="number" value={newBooking.age} onChange={e=>setNewBooking({...newBooking,age:e.target.value})} placeholder="Age" className="rounded-lg border px-3 py-2"/>
        <select value={newBooking.gender} onChange={e=>setNewBooking({...newBooking,gender:e.target.value})} className="rounded-lg border px-3 py-2"><option value="">Gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select>
        <input value={newBooking.phone} onChange={e=>setNewBooking({...newBooking,phone:e.target.value})} placeholder="Phone" className="rounded-lg border px-3 py-2"/>
        <input value={newBooking.address} onChange={e=>setNewBooking({...newBooking,address:e.target.value})} placeholder="Address" className="rounded-lg border px-3 py-2 md:col-span-2"/>
        <input type="datetime-local" value={newBooking.preferred_at} onChange={e=>setNewBooking({...newBooking,preferred_at:e.target.value})} className="rounded-lg border px-3 py-2"/>
      </div>
      <div className="mt-3">
        <input
        value={newBookingQ}
        onChange={e=>searchNewBookingTests(e.target.value)}
        onKeyDown={async e=>{
          if(e.key!=='Enter')return
          e.preventDefault()
          if(newBookingResults.length){
            addNewBookingTest(newBookingResults[0])
            return
          }
          const q=newBookingQ.trim()
          if(!q)return
          try{
            const x=await api<any>(`/tests?q=${encodeURIComponent(q)}`)
            const first=x.tests?.[0]
            if(first)addNewBookingTest(first)
          }catch(err:any){
            setMsg(err.message)
          }
        }}
        placeholder="Search tests to add"
        className="w-full rounded-lg border px-3 py-2"
      />
        {newBookingResults.length>0&&<div className="mt-2 rounded-lg border">{newBookingResults.map(t=><button type="button" key={t.test_no} onClick={()=>addNewBookingTest(t)} className="block w-full border-b px-3 py-2 text-left last:border-0 hover:bg-slate-50"><b>{t.test_no}</b> · <span dir="auto">{t.analysis_name}</span> · {t.patient_price} EGP</button>)}</div>}
      </div>
      {newBookingTests.length>0&&<div className="mt-3 flex flex-wrap gap-2">{newBookingTests.map(t=><span key={t.test_no} className="rounded-full border px-3 py-1 text-sm">{t.analysis_name} · {t.patient_price} EGP <button type="button" onClick={()=>setNewBookingTests(x=>x.filter(y=>y.test_no!==t.test_no))}>×</button></span>)}</div>}
      <button type="button" disabled={busy} onClick={createBooking} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Create reservation</button>
    </div>
    <div className="rounded-2xl border bg-white p-4">
      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
        <input value={bookingQ} onChange={e=>{setBookingQ(e.target.value);loadBookings(e.target.value,bookingSort,bookingDir)}} placeholder="Search patient, phone, or reservation number" className="rounded-lg border px-3 py-2"/>
        <select value={bookingSort} onChange={e=>{setBookingSort(e.target.value);loadBookings(bookingQ,e.target.value,bookingDir)}} className="rounded-lg border px-3 py-2">
          <option value="patient">Patient name</option>
          <option value="registration">Registration date</option>
          <option value="appointment">Appointment date</option>
          <option value="updated">Last edited</option>
          <option value="reference">Reservation number</option>
        </select>
        <select value={bookingDir} onChange={e=>{setBookingDir(e.target.value);loadBookings(bookingQ,bookingSort,e.target.value)}} className="rounded-lg border px-3 py-2">
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
        <button onClick={()=>loadBookings()} className="rounded-lg border px-4 py-2">Refresh</button>
      </div>
    </div>
    {bookings.map(b=><article key={b.reference} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-4"><div><h2 dir="auto" className="font-bold">{b.patient_name}</h2><p className="text-sm text-slate-500">{b.reference} · {b.phone} · {Number(b.total||0)} EGP</p><p className="mt-1 text-sm">Status: <b>{b.status}</b> · Creator: {b.creator_name||b.created_by_type} · Assigned: {b.assigned_name||'Unassigned'}</p><p className="text-xs text-slate-400">Created {fmt(b.created_at)} · Preferred {fmt(b.preferred_at)}</p></div><div className="flex gap-2"><button onClick={()=>openEdit(b)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">Edit</button>{b.status!=='DONE'&&<button onClick={()=>removeBooking(b.reference)} disabled={busy} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">Delete</button>}</div></div><div className="mt-3 flex flex-wrap gap-2"><select value={b.assigned_to_user_id||''} onChange={e=>e.target.value&&assign(b.reference,e.target.value)} disabled={busy||b.status==='DONE'} className="rounded-lg border px-3 py-2 text-sm"><option value="">Assign Doctor / Rep…</option>{doctorReps.map(u=><option key={u.id} value={u.id}>{u.display_name} · {u.user_type}</option>)}</select><select value={b.status||'PENDING'} onChange={e=>status(b.reference,e.target.value)} disabled={busy} className="rounded-lg border px-3 py-2 text-sm">{['PENDING','ASSIGNED','ACCEPTED','CONFIRMED','DONE'].map(s=><option key={s}>{s}</option>)}</select></div></article>)}{!bookings.length&&<div className="rounded-2xl border bg-white p-8 text-center">No reservations.</div>}</section>}
  {tab==='users'&&<section className="mt-4 grid gap-5 lg:grid-cols-[1fr_420px]"><div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Users</h2><div className="mt-4 space-y-2">{users.map(u=><div key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><b>{u.display_name}</b><div className="text-xs text-slate-500">{u.username} · {u.user_type} · {u.active?'Active':'Inactive'}</div></div><button onClick={()=>{setEditingUser(u.id);setUserForm({...u,password:'',permissions:u.permissions||[]})}} className="rounded-lg border px-3 py-2 text-sm">Edit</button></div>)}</div></div><div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">{editingUser?'Edit user':'Create user'}</h2><div className="mt-3 grid gap-2"><input value={userForm.username} onChange={e=>setUserForm({...userForm,username:e.target.value})} placeholder="Username" className="rounded-lg border px-3 py-2"/><input value={userForm.display_name} onChange={e=>setUserForm({...userForm,display_name:e.target.value})} placeholder="Display name" className="rounded-lg border px-3 py-2"/><input value={userForm.mobile} onChange={e=>setUserForm({...userForm,mobile:e.target.value})} placeholder="Mobile" className="rounded-lg border px-3 py-2"/><select value={userForm.user_type} onChange={e=>setUserForm({...userForm,user_type:e.target.value})} className="rounded-lg border px-3 py-2"><option value="DOCTOR">Doctor</option><option value="REP">Medical Representative</option><option value="SALESMAN">Salesman</option></select><input type="password" value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})} placeholder={editingUser?'New password (optional)':'Password'} className="rounded-lg border px-3 py-2"/><label className="text-sm"><input type="checkbox" checked={!!userForm.active} onChange={e=>setUserForm({...userForm,active:e.target.checked})}/> Active</label><div className="max-h-72 overflow-auto rounded-xl border p-3">{permissions.map(k=><label key={k} className="block text-sm"><input type="checkbox" checked={userForm.permissions.includes(k)} onChange={e=>setUserForm({...userForm,permissions:e.target.checked?[...userForm.permissions,k]:userForm.permissions.filter((x:string)=>x!==k)})}/> {k}</label>)}</div><button disabled={busy} onClick={saveUser} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Save user</button></div></div></section>}
  {tab==='commission'&&settings&&<section className="mt-4 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Commission & Visit Fees</h2><p className="mt-1 text-sm text-slate-500">Percentages are displayed as rates, for example 1%, 0.5%, and 5%.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.keys(settingLabels).map(k=><label key={k} className="grid gap-1 text-sm"><span>{settingLabels[k]}</span><input type="number" step={rateKeys.includes(k)?'0.1':'0.01'} value={rateKeys.includes(k)?Number(settings[k])*100:settings[k]} onChange={e=>setSettings({...settings,[k]:rateKeys.includes(k)?Number(e.target.value)/100:Number(e.target.value)})} className="rounded-lg border px-3 py-2"/></label>)}</div><button disabled={busy} onClick={saveSettings} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-white">Save settings</button></section>}
  {tab==='catalog'&&<section className="mt-4 grid gap-5">

  <div className="rounded-2xl border bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-bold">Price lists</h2>
        <p className="mt-1 text-sm text-slate-500">
          Reservations keep their historical price-list snapshot.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-600">Active:</span>

        <select
          value={activePriceListId??''}
          disabled={busy||!priceLists.length}
          onChange={e=>activatePriceList(Number(e.target.value))}
          className="rounded-lg border bg-white px-3 py-2 text-sm"
        >
          {!priceLists.length&&<option value="">No price lists</option>}
          {priceLists.map(pl=>
            <option key={pl.id} value={pl.id}>
              {pl.name}{pl.active?' — ACTIVE':''}
            </option>
          )}
        </select>
      </div>
    </div>

    {priceLists.length>0&&(
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Name</th>
              <th className="p-2">Tests</th>
              <th className="p-2">Created</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {priceLists.map(pl=>(
              <tr key={pl.id} className="border-b last:border-0">
                <td className="p-2 font-semibold">{pl.name}</td>
                <td className="p-2">{pl.test_count}</td>
                <td className="p-2">{fmt(pl.created_at)}</td>
                <td className="p-2">
                  {pl.active
                    ? <span className="font-semibold">ACTIVE</span>
                    : <button
                        type="button"
                        disabled={busy}
                        onClick={()=>activatePriceList(Number(pl.id))}
                        className="rounded-lg border px-3 py-1"
                      >
                        Activate
                      </button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>

  <div className="rounded-2xl border bg-white p-5">
    <h2 className="font-bold">Import new price list</h2>

    <p className="mt-1 text-sm text-slate-500">
      Importing creates a new price list; it does not overwrite an existing list.
    </p>

    <input
      value={priceListName}
      onChange={e=>setPriceListName(e.target.value)}
      placeholder="Price list name, e.g. September 2026"
      className="mt-3 w-full rounded-lg border px-3 py-2"
    />

    <input
      className="mt-3"
      type="file"
      accept=".xls,.xlsx,.csv"
      onChange={async e=>{
        const f=e.target.files?.[0];
        if(!f)return;

        try{
          const wb=XLSX.read(
            await f.arrayBuffer(),
            {type:'array',cellDates:false}
          );

          setCatalogRows(
            parseSheet(wb.Sheets[wb.SheetNames[0]])
          );

          setMsg('Price list parsed. Review then publish.');
        }catch(err:any){
          setMsg(err.message);
        }
      }}
    />

    <p className="mt-2 text-sm text-slate-500">
      {catalogRows.length} rows ready.
    </p>

    <button
      type="button"
      disabled={!catalogRows.length||!priceListName.trim()||busy}
      onClick={importCatalog}
      className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
    >
      Create price list
    </button>
  </div>

  <div className="rounded-2xl border bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-bold">Search / edit test prices</h2>
        <p className="mt-1 text-sm text-slate-500">
          Price changes apply to the active price list only.
        </p>
      </div>

      {activePriceListId&&(
        <span className="rounded-full border px-3 py-1 text-sm font-semibold">
          {priceLists.find(x=>Number(x.id)===Number(activePriceListId))?.name||'Active list'}
        </span>
      )}
    </div>

    <input
      value={catalogQ}
      onChange={e=>searchCatalog(e.target.value)}
      placeholder="Search test number or name"
      className="mt-3 w-full rounded-lg border px-3 py-2"
    />

    <div className="mt-3 space-y-2">
      {catalog.map(t=>(
        <div
          key={t.test_no}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
        >
          <div>
            <b>{t.test_no}</b> ·
            <span dir="auto"> {t.analysis_name}</span>
          </div>

          <input
            type="number"
            defaultValue={t.patient_price}
            onBlur={async e=>{
              try{
                await api('/admin/tests/price',{
                  method:'POST',
                  body:JSON.stringify({
                    test_no:t.test_no,
                    patient_price:Number(e.target.value)
                  })
                });
                setMsg('Price saved.');
              }catch(err:any){
                setMsg(err.message);
              }
            }}
            className="w-28 rounded-lg border px-2 py-1"
          />
        </div>
      ))}
    </div>
  </div>

</section>}
  {tab==='finance'&&<><section className="mt-4 rounded-2xl border bg-white p-5"><h2 className="font-bold">Financial summary</h2><div className="mt-4 overflow-auto"><table className="min-w-full text-sm"><thead><tr>{['User','Type','Accrued / unfinalized','Finalized commission','Extra-test commission','Earned visit fees','Paid commission','Paid visit fees','Outstanding commission','Outstanding visit fees'].map(x=><th className="border-b p-2 text-left whitespace-nowrap" key={x}>{x}</th>)}</tr></thead><tbody>{finance.map(x=><tr key={x.id}><td className="border-b p-2">{x.display_name}</td><td className="border-b p-2">{x.user_type}</td><td className="border-b p-2">{x.accrued_unfinalized_commission}</td><td className="border-b p-2">{x.finalized_commission}</td><td className="border-b p-2">{x.extra_test_commission}</td><td className="border-b p-2">{x.earned_visit_fees}</td><td className="border-b p-2">{x.paid_commission}</td><td className="border-b p-2">{x.paid_visit_fees}</td><td className="border-b p-2">{x.outstanding_commission}</td><td className="border-b p-2">{x.outstanding_visit_fees}</td></tr>)}</tbody></table></div></section><section className="mt-4 rounded-2xl border bg-white p-5"><h2 className="font-bold">Record payment</h2><select value={payment.user_id} onChange={e=>setPayment({...payment,user_id:e.target.value})} className="mt-3 w-full rounded-lg border px-3 py-2"><option value="">Select user</option>{users.map(u=><option key={u.id} value={u.id}>{u.display_name}</option>)}</select><select value={payment.type} onChange={e=>setPayment({...payment,type:e.target.value})} className="mt-2 w-full rounded-lg border px-3 py-2"><option value="commission">Commission</option><option value="visit">Visit fee</option></select><input type="number" value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})} placeholder="Amount" className="mt-2 w-full rounded-lg border px-3 py-2"/><input value={payment.note} onChange={e=>setPayment({...payment,note:e.target.value})} placeholder="Note" className="mt-2 w-full rounded-lg border px-3 py-2"/><button disabled={busy||!payment.user_id||!payment.amount} onClick={pay} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white">Record payment</button></section></>}
  {tab==='targets'&&<section className="mt-4 grid gap-5 lg:grid-cols-[1fr_380px]"><div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Targets</h2><p className="mt-1 text-sm text-slate-500">Patient targets use reservation creation dates.</p><div className="mt-4 space-y-2">{targets.map(t=><div key={t.id} className="rounded-xl border p-3"><div className="flex flex-wrap justify-between gap-2"><div><b>{t.display_name}</b><div className="text-xs text-slate-500">{t.period_start} to {t.period_end} · {t.active?'Active':'Disabled'}</div></div><div className="text-right"><b>{t.actual} / {t.target_value}</b><div className="text-xs">{Math.round(Number(t.percentage)*100)}% · {t.remaining>0?`${t.remaining} remaining`:'Target reached'}</div></div></div><div className="mt-2 flex gap-2"><button onClick={()=>{setEditingTarget(t.id);setTargetForm({user_id:t.user_id,period_start:t.period_start,period_end:t.period_end,metric:t.metric,target_value:t.target_value,active:!!t.active})}} className="rounded-lg border px-3 py-1 text-sm">Edit</button><button onClick={()=>removeTarget(t.id)} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1 text-sm text-red-700">Delete</button></div></div>)}{!targets.length&&<p className="py-8 text-center text-sm text-slate-500">No targets configured.</p>}</div></div><div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">{editingTarget?'Edit target':'Create target'}</h2><div className="mt-3 grid gap-2"><select value={targetForm.user_id} onChange={e=>setTargetForm({...targetForm,user_id:e.target.value})} className="rounded-lg border px-3 py-2"><option value="">Select user</option>{users.map(u=><option key={u.id} value={u.id}>{u.display_name} · {u.user_type}</option>)}</select><label className="grid gap-1 text-sm">Period start<input type="date" value={targetForm.period_start} onChange={e=>setTargetForm({...targetForm,period_start:e.target.value})} className="rounded-lg border px-3 py-2"/></label><label className="grid gap-1 text-sm">Period end<input type="date" value={targetForm.period_end} onChange={e=>setTargetForm({...targetForm,period_end:e.target.value})} className="rounded-lg border px-3 py-2"/></label><label className="grid gap-1 text-sm">Patient target<input type="number" min="1" step="1" value={targetForm.target_value} onChange={e=>setTargetForm({...targetForm,target_value:e.target.value})} className="rounded-lg border px-3 py-2"/></label><label className="text-sm"><input type="checkbox" checked={!!targetForm.active} onChange={e=>setTargetForm({...targetForm,active:e.target.checked})}/> Active</label><div className="flex gap-2"><button disabled={busy} onClick={saveTarget} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Save target</button>{editingTarget&&<button onClick={()=>setEditingTarget(null)} className="rounded-lg border px-4 py-2">Cancel</button>}</div></div></div></section>}
  {tab==='statistics'&&<section className="mt-4 grid gap-4"><div className="rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-bold">Operational statistics</h2><p className="text-sm text-slate-500">Bounded date-filtered summary.</p></div><div className="flex flex-wrap gap-2"><select value={statPreset} onChange={e=>choosePreset(e.target.value)} className="rounded-lg border px-3 py-2"><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option></select><input type="date" value={statFrom} onChange={e=>{setStatPreset('custom');setStatFrom(e.target.value)}} className="rounded-lg border px-2 py-2"/><input type="date" value={statTo} onChange={e=>{setStatPreset('custom');setStatTo(e.target.value)}} className="rounded-lg border px-2 py-2"/><button onClick={()=>loadStats()} className="rounded-lg bg-slate-900 px-3 py-2 text-white">Apply</button></div></div>{stats&&<div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div>Patients <b>{stats.patients}</b></div><div>Tests <b>{stats.tests}</b></div><div>Booking value <b>{stats.booking_value}</b></div><div>Completion rate <b>{(Number(stats.completion_rate)*100).toFixed(1)}%</b></div><div>Accrued / unfinalized commission <b>{stats.accrued_unfinalized_commission}</b></div><div>Finalized commission <b>{stats.finalized_commission}</b></div><div>Extra-test value <b>{stats.extra_tests}</b></div><div>Extra-test commission <b>{stats.extra_test_commission}</b></div><div>Paid commission <b>{stats.paid_commission}</b></div><div>Outstanding commission <b>{stats.outstanding_commission}</b></div><div>Earned visit fees <b>{stats.earned_visit_fees}</b></div>{Object.entries(stats.bookings_by_status||{}).map(([k,v])=><div key={k}>{k} bookings <b>{String(v)}</b></div>)}</div>}</div>{stats&&<div className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Per-user statistics and assignment workload</h2><div className="mt-4 overflow-auto"><table className="min-w-full text-sm"><thead><tr>{['User','Type','Bookings','Patients','Accepted','Confirmed','Done','Completion','Assigned workload','Commission'].map(x=><th key={x} className="border-b p-2 text-left whitespace-nowrap">{x}</th>)}</tr></thead><tbody>{stats.users.map((x:any)=><tr key={x.id}><td className="border-b p-2">{x.display_name}</td><td className="border-b p-2">{x.user_type}</td><td className="border-b p-2">{x.bookings}</td><td className="border-b p-2">{x.patients}</td><td className="border-b p-2">{x.accepted}</td><td className="border-b p-2">{x.confirmed}</td><td className="border-b p-2">{x.done}</td><td className="border-b p-2">{(Number(x.completion_rate)*100).toFixed(1)}%</td><td className="border-b p-2">{x.assignment_workload}</td><td className="border-b p-2">{x.commission}</td></tr>)}</tbody></table></div></div>}</section>}

  {editingBooking && <AdminEditForm
    booking={editingBooking}
    onClose={()=>setEditingBooking(null)}
    onSave={load}
    busy={busy}
  />}

  {selected&&!editingBooking&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6"><div className="flex justify-between"><h2 className="text-xl font-bold">{selected.reference}</h2><button onClick={()=>setSelected(null)}>✕</button></div><div className="mt-4 grid gap-2 text-sm"><div>Patient: <b dir="auto">{selected.patient_name}</b></div><div>Phone: {selected.phone}</div><div>Status: <b>{selected.status}</b></div><div>Creator: {selected.creator_name||selected.created_by_type}</div><div>Assigned: {selected.assigned_name||'Unassigned'}</div><div>Total: {selected.total} EGP</div><div>Commission owner: {selected.commission_owner_type||'—'} {selected.commission_amount??0} EGP</div><div>Visit fee: {selected.visit_fee_amount??0} EGP</div></div><div className="mt-5 flex flex-wrap gap-2">{['PENDING','ASSIGNED','ACCEPTED','CONFIRMED','DONE'].map(s=><button key={s} onClick={()=>status(selected.reference,s)} disabled={busy} className="rounded-lg border px-3 py-2 text-sm">{s}</button>)}</div></div></div>}

  <section className="mt-4 rounded-2xl border bg-white p-5"><h2 className="font-bold">Admin password</h2><div className="mt-3 grid gap-2 sm:grid-cols-3"><input type="password" value={adminCurrent} onChange={e=>setAdminCurrent(e.target.value)} placeholder="Current password" className="rounded-lg border px-3 py-2"/><input type="password" value={adminNext} onChange={e=>setAdminNext(e.target.value)} placeholder="New password" className="rounded-lg border px-3 py-2"/><button disabled={busy||!adminCurrent||!adminNext} onClick={changePassword} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Change password</button></div></section>
  </div></main>
}
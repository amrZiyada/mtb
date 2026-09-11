'use client'
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../../lib/api'
import { APP_VERSION } from '../../lib/version'

const required = ['#', 'Analysis name', 'Unit', 'Ref. range', 'Specimen', 'Duration', 'Price', 'Contract', 'Patient']
const textColumns = ['Unit', 'Ref. range', 'Specimen']
const keyMap:any = {'#':'test_no','Analysis name':'analysis_name','Unit':'unit','Ref. range':'ref_range','Specimen':'specimen','Duration':'duration','Price':'price','Contract':'contract_price','Patient':'patient_price'}

function cell(row:any[], index:number) {
  const v = row[index]
  return v === null || v === undefined ? '' : String(v).trim()
}

function numberValue(value:any) {
  if (typeof value === 'number') return value
  const text = String(value ?? '').trim().replace(/,/g, '')
  if (!text) return NaN
  const n = Number(text)
  return Number.isFinite(n) ? n : NaN
}

function appendText(current:string, next:string) {
  if (!next) return current
  if (!current) return next
  return current.includes(next) ? current : `${current}\n${next}`
}

function parseLaboratoryPriceList(ws:XLSX.WorkSheet) {
  // The supplied laboratory file has a title/date row first, then the real
  // table header on the second row. Find the header instead of assuming row 1.
  const matrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: true, blankrows: true })
  const headerIndex = matrix.findIndex(row => required.every(header => row.some((v:any) => String(v ?? '').trim() === header)))
  if (headerIndex < 0) throw new Error(`Could not find the standard price-list header: ${required.join(' · ')}`)

  const header = matrix[headerIndex]
  const columns:any = {}
  for (const name of required) columns[name] = header.findIndex((v:any) => String(v ?? '').trim() === name)

  const normalized:any[] = []
  let current:any = null

  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const row = matrix[i]
    const hasContent = row.some((v:any) => String(v ?? '').trim() !== '')
    if (!hasContent) continue

    const analysisName = cell(row, columns['Analysis name'])
    const testNo = cell(row, columns['#'])
    const duration = numberValue(row[columns['Duration']])
    const price = numberValue(row[columns['Price']])
    const contract = numberValue(row[columns['Contract']])
    const patient = numberValue(row[columns['Patient']])
    const hasNumericTestData = [duration, price, contract, patient].some(Number.isFinite)

    // A row with a test number or price data starts a new test. Rows containing
    // text only (even when the text is in the Analysis name column) are
    // continuation lines in the laboratory's standard export.
    if (analysisName && (testNo || hasNumericTestData)) {
      current = {
        test_no: testNo || `AUTO-${i + 1}`,
        analysis_name: analysisName,
        unit: cell(row, columns['Unit']),
        ref_range: cell(row, columns['Ref. range']),
        specimen: cell(row, columns['Specimen']),
        duration: Number.isFinite(duration) ? duration : 0,
        price: Number.isFinite(price) ? price : 0,
        contract_price: Number.isFinite(contract) ? contract : 0,
        patient_price: patient,
        _row: i + 1,
      }
      normalized.push(current)
      continue
    }

    // The standard file uses continuation rows for long analysis names,
    // reference ranges, units, and specimen text. Attach them to the
    // preceding test instead of importing them as separate tests.
    if (current) {
      if (analysisName) current.analysis_name = appendText(current.analysis_name, analysisName)
      for (const name of textColumns) {
        const next = cell(row, columns[name])
        if (next) current[keyMap[name]] = appendText(current[keyMap[name]], next)
      }
    }
  }

  return normalized
}

export default function Admin() {
  const [password,setPassword]=useState(''),[logged,setLogged]=useState(false),[rows,setRows]=useState<any[]>([]),[bookings,setBookings]=useState<any[]>([]),[msg,setMsg]=useState('')
  async function login(){try{await api('/admin/login',{method:'POST',body:JSON.stringify({password})});setLogged(true);setMsg('Authenticated')}catch(e:any){setMsg(e.message)}}
  async function loadBookings(){try{const x=await api<any>('/admin/bookings');setBookings(x.bookings)}catch(e:any){setMsg(e.message)}}
  useEffect(()=>{if(logged)loadBookings()},[logged])
  async function parse(file:File){
    try {
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false})
      const ws=wb.Sheets[wb.SheetNames[0]]
      const normalized=parseLaboratoryPriceList(ws)
      if(!normalized.length){setMsg('No laboratory tests were found after the standard price-list header.');setRows([]);return}
      const invalid=normalized.find(r=>!r.analysis_name||!Number.isFinite(r.patient_price))
      if(invalid){setMsg(`Invalid row ${invalid._row}: Analysis name and Patient price are required.`);setRows([]);return}
      setRows(normalized);setMsg(`${normalized.length} tests loaded from ${file.name}.`)
    } catch { setMsg('Could not read this Excel/CSV file.') }
  }
  async function publish(){try{const x=await api<any>('/admin/tests/import',{method:'POST',body:JSON.stringify({tests:rows})});setMsg(`Published ${x.count} tests successfully.`);await loadBookings()}catch(e:any){setMsg(e.message)}}
  if(!logged)return <main className="min-h-screen grid place-items-center p-4"><div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow"><h1 className="text-xl font-bold">Admin login</h1><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} className="mt-4 w-full rounded-xl border px-3 py-3"/><button onClick={login} className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-white">Login</button><p className="mt-3 text-sm">{msg}</p></div></main>
  return <main className="min-h-screen p-4"><div className="mx-auto max-w-7xl"><div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-bold">Catalog & Bookings Admin</h1><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">v{APP_VERSION}</span></div>
    <div className="mt-5 rounded-2xl border bg-white p-6"><label className="block rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer"><input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e=>e.target.files?.[0]&&parse(e.target.files[0])}/><b>Drop or choose the standard laboratory Excel/CSV</b><div className="mt-2 text-sm text-slate-500">Accepts the supplied laboratory price-list directly (.xls, .xlsx, or .csv), including its title/date row and continuation rows.</div></label><button disabled={!rows.length} onClick={publish} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-white disabled:opacity-40">Publish catalog</button><p className="mt-3 text-sm">{msg}</p></div>
    {rows.length>0&&<div className="mt-5 overflow-auto rounded-2xl border bg-white"><table className="min-w-full text-sm"><thead><tr>{required.map(c=><th className="border-b p-3 text-left whitespace-nowrap" key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(0,20).map((r,i)=><tr key={i}>{required.map(c=>{return <td className="border-b p-3 align-top" key={c}>{String(r[keyMap[c]]??'')}</td>})}</tr>)}</tbody></table></div>}
    <section className="mt-6 rounded-2xl border bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Incoming bookings</h2><button onClick={loadBookings} className="rounded-lg border px-3 py-2 text-sm">Refresh</button></div><div className="mt-4 overflow-auto"><table className="min-w-full text-sm"><thead><tr>{['reference','created_at','patient_name','age','gender','phone','preferred_at','total','status'].map(c=><th key={c} className="border-b p-3 text-left">{c}</th>)}</tr></thead><tbody>{bookings.map((b:any)=><tr key={b.reference}>{['reference','created_at','patient_name','age','gender','phone','preferred_at','total','status'].map(c=><td key={c} className="border-b p-3 whitespace-nowrap">{String(b[c]??'')}</td>)}</tr>)}</tbody></table>{!bookings.length&&<p className="py-8 text-center text-slate-500">No bookings yet.</p>}</div></section>
  </div></main>
}

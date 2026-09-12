export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
export async function api<T>(path:string, init?:RequestInit):Promise<T>{
 const token = typeof window !== 'undefined' ? window.localStorage.getItem('mtb_admin_token') : null
 const r=await fetch(`${API}${path}`,{...init,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ } ),...(init?.headers||{})},credentials:'include'})
 const data=await r.json().catch(()=>({}))
 if(!r.ok) throw new Error(data.error||'Request failed')
 return data
}

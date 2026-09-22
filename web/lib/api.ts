const API=process.env.NEXT_PUBLIC_API_URL||''
export async function api<T=any>(path:string,options:RequestInit={}){
 const headers=new Headers(options.headers||{});if(options.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json')
 if(typeof window!=='undefined'&&!headers.has('Authorization')){const adminRequest=path==='/admin/me'||path.startsWith('/admin/');const token=localStorage.getItem(adminRequest?'mtb_admin_token':'mtb_user_token');if(token)headers.set('Authorization',`Bearer ${token}`)}
 const r=await fetch(`${API}${path}`,{...options,headers,credentials:'include'});let data:any={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(data?.error||`Request failed (${r.status})`);return data as T
}

import { CDP_URL } from './config.js';
import { getShop } from './shops.js';
// Isolated page session: no browser attachment, navigation, cookie access or target close.
export async function connectPromotionPage(url,{WebSocketImpl=WebSocket,timeoutMs=12000}={}) {
 const ws=new WebSocketImpl(url);let closed=false,id=0;const pending=new Map();
 const fail=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Page CDP closed'));}pending.clear();};
 ws.onclose=fail;
 try {await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Page CDP open timeout')),timeoutMs);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error('Page CDP connection failed'));};});}catch(e){ws.close();throw e;}
 ws.onerror=fail;
 ws.onmessage=e=>{let d;try{d=JSON.parse(e.data);}catch{return;}const p=pending.get(d.id);if(!p)return;pending.delete(d.id);clearTimeout(p.timer);if(d.error||d.result?.exceptionDetails)p.reject(Error('Page CDP evaluation failed'));else p.resolve(d.result?.result?.value);};
 return {
  async evaluate(fn,arg){if(closed)throw Error('Page CDP closed');return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('Page CDP evaluation timeout'));},timeoutMs);pending.set(n,{resolve,reject,timer});try{ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression:`(${fn.toString()})(${arg===undefined?'':JSON.stringify(arg)})`,returnByValue:true,awaitPromise:true,timeout:timeoutMs-1}}));}catch{pending.delete(n);clearTimeout(timer);reject(Error('Page CDP send failed'));}});},
  async close(){fail();ws.close();}
 };
}

export async function withPromotionPage(options,run,{fetchImpl=fetch,connect=connectPromotionPage}={}) {
 if(!/^[1-9]\d*$/.test(String(options.expectedMallId||'')))throw Error('expectedMallId required');
 if(options.cdpUrl&&options.shop)throw Error('Choose cdpUrl or shop, not both');
 const endpoint=options.cdpUrl||(options.shop?`http://127.0.0.1:${getShop(options.shop).port}`:CDP_URL);
 const u=new URL(endpoint);
 if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('CDP endpoint must be a loopback HTTP origin');
 const response=await fetchImpl(`${u.origin}/json/list`,{signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!response.ok)throw Error('CDP target listing failed');
 const targets=await response.json();
 const candidates=targets.filter(t=>{try{const p=new URL(t.url),w=new URL(t.webSocketDebuggerUrl);return t.type==='page'&&p.protocol==='https:'&&['mms.pinduoduo.com','yingxiao.pinduoduo.com'].includes(p.hostname)&&!p.pathname.startsWith('/login')&&w.protocol==='ws:'&&w.hostname===u.hostname&&w.port===u.port&&w.pathname.startsWith('/devtools/page/');}catch{return false;}}).sort((a,b)=>Number(b.url.includes('mms.pinduoduo.com'))-Number(a.url.includes('mms.pinduoduo.com')));
 for(const target of candidates){
  let page;try{page=await connect(target.webSocketDebuggerUrl);}catch{continue;}
  let ready=false;
  try{ready=await page.evaluate(()=>location.hostname==='mms.pinduoduo.com'?typeof window.__mms?.fetch?.post==='function':typeof window.$$ANQ_INSTANCE?.service('Http')?.request==='function');}catch{}
  if(!ready){await page.close();continue;}
  // Once a live page is selected, never retry a different identity after an API error.
  try{return await run(page);}finally{await page.close();}
 }
 throw Error('No live promotion request channel at selected endpoint; complete login in its browser');
}

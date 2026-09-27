import test from 'node:test';
import assert from 'node:assert/strict';
import * as cdp from '../src/promotion-detail.js';
import {EventEmitter} from 'node:events';
class Socket extends EventEmitter {
 constructor(){super();queueMicrotask(()=>this.onopen?.());}
 send(raw){const d=JSON.parse(raw);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({id:d.id,result:{result:{value:42}}})}));}
 close(){this.closed=true;this.onclose?.();}
}
test('page websocket evaluates independently of hung browser attachment and closes only socket',async()=>{
 assert.equal(typeof cdp.connectPromotionPage,'function');
 const page=await cdp.connectPromotionPage('ws://127.0.0.1:9224/devtools/page/test',{WebSocketImpl:Socket,timeoutMs:30});
 assert.equal(await page.evaluate(()=>42),42);await page.close();
 await assert.rejects(page.evaluate(()=>42),/closed/);
});

test('explicit endpoint selects only live allowed page, never falls back to another shop',async()=>{
 assert.equal(typeof cdp.withPromotionPage,'function');
 let seen;
 const value=await cdp.withPromotionPage({cdpUrl:'http://127.0.0.1:9224',expectedMallId:'123456789'},async p=>p.marker,{
 fetchImpl:async url=>{seen=url;return {ok:true,json:async()=>[{type:'page',url:'https://evil.test/',webSocketDebuggerUrl:'ws://127.0.0.1:9224/devtools/page/evil'},{type:'page',url:'https://yingxiao.pinduoduo.com/goods/promotion/list',webSocketDebuggerUrl:'ws://127.0.0.1:9224/devtools/page/good'}]};},
 connect:async url=>({marker:url,evaluate:async()=>true,close:async()=>{}})
 });
 assert.equal(seen,'http://127.0.0.1:9224/json/list');assert.match(value,/page\/good$/);
 await assert.rejects(cdp.withPromotionPage({cdpUrl:'http://evil.test',expectedMallId:'1'},()=>{}),/loopback/);
 await assert.rejects(cdp.withPromotionPage({cdpUrl:'http://127.0.0.1:9224'},()=>{}),/expectedMallId/);
});

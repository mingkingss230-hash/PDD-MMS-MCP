import test from 'node:test';import assert from 'node:assert/strict';
test('native daily batch resumes creative only, preserves missing exports, records per-ad failures',async()=>{
 const m=await import('../src/promotion-native-batch.js').catch(()=>({}));assert.equal(typeof m.collectNativeDaily,'function');
 const list={date:'2026-09-14',identity:{mallId:'1'},complete:true,totalAdNum:2,adInfos:[{adId:'10',goodsId:'100',reportInfo:{}},{adId:'20',goodsId:'200',reportInfo:{}}]};
 const exp={date:list.date,identity:list.identity,rowCount:24,goodsCount:1,coverage:{missingCurrent:[{adId:'20',goodsId:'200'}]},files:{parsed:'native.json'}};
 const creative=id=>({date:list.date,identity:{mallId:'1',adId:id,goodsId:id+'0'},creativeDaily:{count:1,rows:[{creativeId:'7',reportInfo:null}]}});let saves=0;
 const first=await m.collectNativeDaily(list,exp,async id=>{if(id==='20')throw Error('read failed');return creative(id)},{save:async()=>saves++,delayMs:0});assert.equal(first.creativeSuccess,1);assert.equal(first.hourlySource,'native-export-only');assert.equal(first.missingCurrent.length,1);assert.equal(first.supplementaryHourlyCalls,0);assert(saves>=3);
 const called=[];const second=await m.collectNativeDaily(list,exp,async id=>{called.push(id);return creative(id)},{previous:first,delayMs:0});assert.deepEqual(called,['20']);assert.equal(second.creativeCount,2);assert.equal(second.creativeNullCount,2);assert.equal(second.complete,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/promotion-detail.js';
test('creative-only collection never queries hourly and preserves null metrics',async()=>{
 assert.equal(typeof api.collectCreativeDaily,'function');const paths=[];
 const r=await api.collectCreativeDaily({adId:'10',goodsId:'100',expectedMallId:'1',date:'2026-09-14'},async(p)=>{paths.push(p);return {mallId:1,creativeListForDisplay:[{creativeId:7,reportInfo:null}],sumReportInfo:{}}});
 assert.deepEqual(paths,[api.CREATIVE_PATH]);assert.equal(r.creativeDaily.count,1);assert.equal(r.creativeDaily.rows[0].reportInfo,null);assert.equal(r.hourly,undefined);
});
test('batch persists after each ad, retains errors and resumes only matching complete results',async()=>{
 assert.equal(typeof api.collectPromotionBatch,'function');
 const list={date:'2026-09-14',identity:{mallId:'1'},totalAdNum:2,complete:true,adInfos:[{adId:10,goodsId:100},{adId:20,goodsId:200}]};
 const detail=id=>({date:list.date,identity:{mallId:'1',adId:String(id),goodsId:String(id*10)},hourly:{complete:true,rows:Array.from({length:24},(_,hour)=>({hour}))},creativeDaily:{count:1,rows:[{creativeId:1,reportInfo:null}]}});
 let saves=0;
 const first=await api.collectPromotionBatch(list,async id=>{if(id==='20')throw Error('failure');return detail(Number(id));},{save:async()=>{saves++},delayMs:0});
 assert.equal(first.complete,false);assert.equal(first.successCount,1);assert.equal(first.errors['20'],'failure');assert(saves>=2);
 const called=[];const second=await api.collectPromotionBatch(list,async id=>{called.push(id);return detail(Number(id));},{previous:first,save:async()=>{},delayMs:0});
 assert.deepEqual(called,['20']);assert.equal(second.complete,true);assert.equal(second.successCount,2);assert.equal(Object.keys(second.errors).length,0);
 await assert.rejects(api.collectPromotionBatch({...list,identity:{mallId:'2'}},async()=>{}, {previous:first}),/resume identity/);
});

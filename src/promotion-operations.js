import {createHash} from 'node:crypto';
import {DETAIL_PATH} from './promotion-detail.js';
export const OPERATION_PATH='/mms-gateway/venus/api/log/queryOperationLogWithCount';
export async function collectOperationLogs(options,post,{savePage=async()=>{},delayMs=350}={}){
 const {adId,expectedMallId,startDate,endDate}=options;
 for(const v of [adId,expectedMallId])if(!/^[1-9]\d*$/.test(String(v))||!Number.isSafeInteger(Number(v)))throw Error('Invalid identifier');
 for(const d of [startDate,endDate])if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('Invalid calendar date');
 if(startDate>endDate)throw Error('Invalid date range');
 const detail=await post(DETAIL_PATH,{adId:Number(adId),withTagsInfo:true,clientType:1});
 if(String(detail?.mallId)!==String(expectedMallId)||String(detail?.adId)!==String(adId)||!detail.goodsId||detail.scenesMode!==1)throw Error('Shop/ad identity mismatch');
 const identity={mallId:String(expectedMallId),adId:String(adId),goodsId:String(detail.goodsId)};
 let queryId=null,total=null;const unique=new Map();
 for(let pageNumber=1;pageNumber<=1000;pageNumber++){
 const request={plateType:15,moduleType:0,operatorType:0,operateType:0,fieldToValue:{adId:Number(adId)},beginDate:startDate,endDate,pageSize:20,fromListPageInfo:true,pageNumber,queryId,lookaheadPages:5};
 const r=await post(OPERATION_PATH,request);
 if(!Array.isArray(r?.logList)||!Number.isInteger(r.total)||r.total<0||r.totalOverThreshold!==false)throw Error('Operation schema/threshold cannot certify completeness');
 if(total!==null&&total!==r.total)throw Error('Operation total changed');total=r.total;
 const rows=r.logList.map(({operatorName,...row})=>({...row,operatorAlias:operatorName?createHash('sha256').update(identity.mallId+':'+operatorName).digest('hex').slice(0,16):null,operatorType:row.operatorType??null}));
 await savePage({request,response:{...r,logList:rows}});
 const before=unique.size;
 for(const row of rows){if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.operateTime)||row.operateTime.slice(0,10)<startDate||row.operateTime.slice(0,10)>endDate)throw Error('Operation time outside range/schema');const key=row.id??JSON.stringify(row);unique.set(String(key),row);}
 if(unique.size===total)return {identity,startDate,endDate,timezone:'Asia/Shanghai',source:OPERATION_PATH,count:unique.size,total,complete:true,pagesFetched:pageNumber,rows:[...unique.values()].sort((a,b)=>a.operateTime.localeCompare(b.operateTime)||String(a.id).localeCompare(String(b.id)))};
 if(unique.size>total||unique.size===before||!r.queryId)throw Error('Operation pagination stalled');queryId=r.queryId;
 if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
 }
 throw Error('Operation pagination safety limit');
}
export async function getOperationLogs(page,options,settings){return collectOperationLogs(options,async(path,body)=>{
 if(![DETAIL_PATH,OPERATION_PATH].includes(path))throw Error('Read-only endpoint denied');
 const r=await page.evaluate(async({path,body})=>{try{return {ok:true,value:location.hostname==='yingxiao.pinduoduo.com'?await window.$$ANQ_INSTANCE.service('Http').request({method:'post',url:path,data:body}):await window.__mms.fetch.post(path,body)}}catch(e){return {ok:false,message:e.errorMsg||e.message}}},{path,body});
 if(!r?.ok)throw Error(r?.message||'Operation request failed');return r.value;
},settings);}

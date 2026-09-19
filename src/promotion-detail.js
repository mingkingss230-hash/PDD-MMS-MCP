// Read-only request shapes captured from the promotion drawer, not inferred endpoints.
export { connectPromotionPage, withPromotionPage } from './promotion-page-cdp.js';

export async function getPromotionDetail(page,options){

 return collectPromotionDetail({...options,date:promotionDate(options.date)},(path,body)=>promotionPost(page,path,body));
}
function promotionDate(date){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const result=!date||date==='yesterday'?new Date(Date.parse(`${today}T00:00:00Z`)-86400000).toISOString().slice(0,10):date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result))||new Date(result).toISOString().slice(0,10)!==result)throw Error('Invalid calendar date');
 return result;
}
async function promotionPost(page,path,body){
 if(![DETAIL_PATH,HOURLY_PATH,CREATIVE_PATH,LIST_PATH].includes(path))throw Error('Read-only endpoint denied');
 const result=await page.evaluate(async({path,body})=>{try{const value=location.hostname==='yingxiao.pinduoduo.com'?await window.$$ANQ_INSTANCE.service('Http').request({method:'post',url:path,data:body}):await window.__mms.fetch.post(path,body);return {ok:true,value}}catch{return {ok:false}}},{path,body});
 if(!result?.ok)throw Error('Promotion read failed; check login/permissions');
 return result.value;
}
export const LIST_PATH='/mms-gateway/venus/api/goods/promotion/v3/list';
export async function getPromotionList(page,{date,expectedMallId}){
 if(!/^[1-9]\d*$/.test(String(expectedMallId||'')))throw Error('expectedMallId required');
 date=promotionDate(date);
 const result=await collectPromotionPages({clientType:1,blockType:3,withTagsInfo:true,beginDate:date,endDate:date,pageNumber:1,pageSize:50,sortBy:9999,orderBy:9999,filter:{},scenesMode:1,showGoodsPromotionHistoryReport:false},async body=>{
  const r=await promotionPost(page,LIST_PATH,body);
  if(!Array.isArray(r?.adInfos)||!r.adInfos.length)throw Error('Empty list cannot verify shop identity');
  if(r.adInfos.some(a=>String(a.mallId)!==String(expectedMallId)))throw Error('Shop list identity mismatch');
  return r;
 });
 return {date,timezone:'Asia/Shanghai',identity:{mallId:String(expectedMallId)},scope:'商品推广 scenesMode=1；全量平台返回单元',...result};
}
export const DETAIL_PATH='/mms-gateway/venus/api/goods/promotion/detail/query';
export const HOURLY_PATH='/mms-gateway/poseidon/api/report/queryHourlyRangeReport';
export const CREATIVE_PATH='/mms-gateway/goodsPromotionQuery/list/v3/creativeJoinReportRefined';
export async function collectPromotionDetail({adId,expectedMallId,date},post){
 for(const value of [adId,expectedMallId])if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw Error('Invalid identifier');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Invalid calendar date');
 const detail=await post(DETAIL_PATH,{adId:Number(adId),withTagsInfo:true,clientType:1});
 if(String(detail?.mallId)!==String(expectedMallId)||String(detail?.adId)!==String(adId)||!detail.goodsId)throw Error('Shop/ad identity mismatch');
 if(detail.scenesMode!==1)throw Error('unsupported: only scenesMode=1 captured and verified');
 const report=await post(HOURLY_PATH,buildHourlyRequest(adId,date,detail.scenesMode));
 if(!report?.dailyReport||!Array.isArray(report.hourlyReportList))throw Error('Report schema mismatch');
 const creative=await post(CREATIVE_PATH,{adId:Number(adId),startDate:date,endDate:date,orderBy:6,sortBy:0,clientType:1,blockType:4});
 if(String(creative?.mallId)!==String(expectedMallId)||!Array.isArray(creative.creativeListForDisplay))throw Error('Creative identity/schema mismatch');
 const hours=new Map();
 for(const r of report.hourlyReportList){if(r.date?.slice(0,10)!==date||!Number.isInteger(r.hour)||r.hour<0||r.hour>23)throw Error('Hourly date/hour schema mismatch');hours.set(r.hour,r);}
 const creatives=new Map();
 for(const r of creative.creativeListForDisplay){if(!r.creativeId)throw Error('Creative ID schema mismatch');creatives.set(String(r.creativeId),r);}
 return {date,timezone:'Asia/Shanghai',identity:{mallId:String(detail.mallId),adId:String(detail.adId),goodsId:String(detail.goodsId)},daily:report.dailyReport,hourly:{status:'available',complete:hours.size===24,rows:[...hours.values()].sort((a,b)=>a.hour-b.hour)},creativeDaily:{status:'available',receivedCount:creative.creativeListForDisplay.length,count:creatives.size,scope:'平台返回的未删除创意图片列表，无分页字段；reportInfo=null 为平台抑制展示，不是零',rows:[...creatives.values()],summary:creative.sumReportInfo},creativeHourly:{status:'unsupported',scope:'当前双店商品推广 scenesMode=1；已验证电器店报表导出白名单不含商品创意维度；不推论其他产品',reason:'已验证创意页只有日/日期区间聚合，未发现创意小时接口；不以单品小时或日均摊替代。'},reportLastUpdateTime:report.reportLastUpdateTime,creativeReportLastUpdateTime:creative.reportLastUpdateTime,metricNotes:'保留原始 value/unit/unitCode；YUAN=元，PERCENT的value为百分数；dailyReport与hourlyReportList分别保留，不将sumReport或小时累加冒充日报。',sources:{detail:DETAIL_PATH,report:HOURLY_PATH,creative:CREATIVE_PATH}};
}
export async function collectPromotionPages(template,fetchPage){
 const rows=new Map();let total=null;let first;
 for(let pageNumber=1;pageNumber<=100;pageNumber++){
  const r=await fetchPage({...template,pageNumber});
  if(!Array.isArray(r?.adInfos)||!Number.isInteger(r.totalAdNum)||r.totalAdNum<0)throw Error('Promotion pagination schema mismatch');
  if(total!==null&&total!==r.totalAdNum)throw Error('Promotion pagination total changed; retry');
  total=r.totalAdNum;first??=r;const before=rows.size;
  for(const a of r.adInfos){if(!a.adId||!a.goodsId)throw Error('Promotion pagination missing ID');rows.set(String(a.adId),a);}
  if(rows.size===total)return {...first,adInfos:[...rows.values()],complete:true,pagesFetched:pageNumber};
  if(rows.size>total||rows.size===before)throw Error('Promotion pagination incomplete/stalled');
 }
 throw Error('Promotion pagination limit reached');
}
export function buildHourlyRequest(adId,date,scenesMode){
 return {clientType:1,entityId:Number(adId),queryDimensionType:2,endDayHour:23,endDate:`${date} 00:00:00`,startDate:`${date} 00:00:00`,reportPromotionType:9,scenesModes:[scenesMode],blockTypes:[4],returnAnchorPoints:true,showGoodsPromotionHistoryReport:false};
}

export async function collectCreativeDaily({adId,goodsId,expectedMallId,date},post){
 for(const id of [adId,goodsId,expectedMallId])if(!/^[1-9]\d*$/.test(String(id))||!Number.isSafeInteger(Number(id)))throw Error('Invalid creative identity');
 date=promotionDate(date);
 const c=await post(CREATIVE_PATH,{adId:Number(adId),startDate:date,endDate:date,orderBy:6,sortBy:0,clientType:1,blockType:4});
 if(String(c?.mallId)!==String(expectedMallId)||!Array.isArray(c.creativeListForDisplay))throw Error('Creative identity/schema mismatch');
 const unique=new Map();for(const row of c.creativeListForDisplay){if(!row.creativeId)throw Error('Creative ID missing');unique.set(String(row.creativeId),row);}
 return {date,timezone:'Asia/Shanghai',identity:{mallId:String(expectedMallId),adId:String(adId),goodsId:String(goodsId)},creativeDaily:{count:unique.size,receivedCount:c.creativeListForDisplay.length,rows:[...unique.values()],summary:c.sumReportInfo,scope:'当前推广链接的未删除创意；null为平台抑制，不是零'},source:CREATIVE_PATH,reportLastUpdateTime:c.reportLastUpdateTime};
}
export async function getCreativeDaily(page,options){
 const list=await getPromotionList(page,options),ad=list.adInfos.find(a=>String(a.adId)===String(options.adId));
 if(!ad)throw Error('Creative ad absent from verified current promotion list');
 return collectCreativeDaily({...options,date:list.date,goodsId:String(ad.goodsId)},(p,b)=>promotionPost(page,p,b));
}
export async function collectPromotionBatch(list,getDetail,{previous,save=async()=>{},delayMs=300}={}){
 if(previous&&(previous.date!==list.date||previous.identity.mallId!==list.identity.mallId))throw Error('Batch resume identity/date mismatch');
 const ids=new Map(list.adInfos.map(a=>[String(a.adId),a]));
 if(!list.complete||ids.size!==list.totalAdNum)throw Error('Batch list incomplete');
 const state={date:list.date,timezone:'Asia/Shanghai',identity:list.identity,list,results:{},errors:{},total:ids.size,successCount:0,complete:false};
 const valid=(r,id)=>r?.date===list.date&&r.identity?.mallId===list.identity.mallId&&r.identity?.adId===id&&r.identity?.goodsId===String(ids.get(id).goodsId)&&r.hourly?.complete===true&&r.hourly.rows.length===24&&r.creativeDaily?.count===r.creativeDaily?.rows?.length;
 for(const [id,r] of Object.entries(previous?.results||{}))if(ids.has(id)&&valid(r,id))state.results[id]=r;
 const persist=async()=>{state.successCount=Object.entries(state.results).filter(([id,r])=>valid(r,id)).length;state.complete=state.successCount===state.total;await save(state);};
 await persist();
 for(const id of ids.keys()){
  if(valid(state.results[id],id))continue;
  try{const r=await getDetail(id);state.results[id]=r;if(!valid(r,id))state.errors[id]='Incomplete or identity/date/schema mismatch';else delete state.errors[id];}
  catch(e){state.errors[id]=e.message;}
  await persist();
  if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
 }
 return state;
}

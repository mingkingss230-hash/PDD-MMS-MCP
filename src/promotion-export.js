import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {getPromotionList,DETAIL_PATH} from './promotion-detail.js';
const ROOT='/mms-gateway/poseidon/report/';
const UNIT='/mms-gateway/apollo/api/report/';
export async function exportPost(page,endpoint,body){
 if(![DETAIL_PATH,...['queryWhiteListReportExportConfig','generateReportExportTask','queryReportExportTaskList'].map(x=>ROOT+x),...['exportHourlyReport','exportDailyReport'].map(x=>UNIT+x)].includes(endpoint))throw Error('Export endpoint denied');
 const r=await page.evaluate(async({endpoint,body})=>{try{return {ok:true,value:location.hostname==='yingxiao.pinduoduo.com'?await window.$$ANQ_INSTANCE.service('Http').request({method:'post',url:endpoint,data:body}):await window.__mms.fetch.post(endpoint,body)}}catch{return {ok:false}}},{endpoint,body});
 if(!r?.ok)throw Error('Native export request failed; check login/permissions');return r.value;
}
function validDate(d){if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('Invalid calendar date');return d;}
export async function getPromotionExport(page,options,deps={}){
 const {mode='shop-hourly',expectedMallId,adId}=options;
 if(!['shop-hourly','unit-hourly','unit-daily'].includes(mode))throw Error('Invalid export mode');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const start=validDate(!options.date||options.date==='yesterday'?new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10):options.date),end=validDate(options.endDate||start);
 if(end<start||(mode!=='unit-daily'&&end!==start))throw Error('Hourly export requires a single date');
 if(!/^[1-9]\d*$/.test(String(expectedMallId||'')))throw Error('expectedMallId required');
 const post=deps.post||((p,b)=>exportPost(page,p,b));
 const list=await (deps.getList||getPromotionList)(page,{date:start,expectedMallId});
 let identity={mallId:String(expectedMallId)};
 if(mode!=='shop-hourly'){
  if(!/^[1-9]\d*$/.test(String(adId||''))||!Number.isSafeInteger(Number(adId)))throw Error('Valid adId required');
  const detail=await post(DETAIL_PATH,{adId:Number(adId),withTagsInfo:true,clientType:1});
  if(String(detail?.mallId)!==String(expectedMallId)||String(detail.adId)!==adId||!detail.goodsId||detail.scenesMode!==1)throw Error('Unit identity/scope mismatch');
  identity={...identity,adId:String(adId),goodsId:String(detail.goodsId)};
 }
 const dir=path.resolve(options.outDir||path.join(fileURLToPath(new URL('../output/promotion-export/',import.meta.url)),String(expectedMallId),start,mode+(adId?'-'+adId:'')));
 fs.mkdirSync(dir,{recursive:true});const manifestPath=path.join(dir,'manifest.json');
 const save=x=>fs.writeFileSync(manifestPath,JSON.stringify(x,null,2));
 let old=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath)):null;
 if(old&&(old.date!==start||old.endDate!==end||old.mode!==mode||JSON.stringify(old.identity)!==JSON.stringify(identity)))throw Error('Export resume identity/date mismatch');
 const manifest={date:start,endDate:end,timezone:'Asia/Shanghai',mode,identity,scope:'商品推广报表；当前推广链接列表，不是全商品库。原生文件仅含有数据商品，可包含已删除商品。',status:'pending',taskId:options.taskId||old?.taskId||null,files:{manifest:manifestPath}};
 if(old?.status==='generation-uncertain'&&!manifest.taskId)throw Error('Prior generation uncertain; inspect native queue before retry');
 let url;
 if(mode==='shop-hourly'){
  if(!manifest.taskId){manifest.status='generation-uncertain';save(manifest);}
  const task=await resolveNativeExport({date:start,taskId:manifest.taskId},post,{maxPolls:options.maxPolls||60,onTask:async id=>{manifest.taskId=id;manifest.status='pending';save(manifest);}});
  manifest.taskId=task.id;manifest.taskStatus=task.taskStatus;url=task.downloadUrl;
 }else{
  save(manifest);url=await post(UNIT+(mode==='unit-hourly'?'exportHourlyReport':'exportDailyReport'),{entityId:Number(adId),queryDimensionType:2,reportPromotionType:9,clientType:1,blockTypes:[7],scenesModes:[1],...(mode==='unit-hourly'?{date:start}:{startDate:start,endDate:end})});
 }
 const download=deps.download|| (async url=>{
  let u;try{u=new URL(url)}catch{throw Error('Invalid native download URL')}
  if(u.protocol!=='https:'||!u.hostname.endsWith('.pinduoduo.com'))throw Error('Download host denied');
  try{const r=await fetch(u,{signal:AbortSignal.timeout(60000),redirect:'error'});if(!r.ok)throw Error();return Buffer.from(await r.arrayBuffer());}catch{throw Error('Native file download failed (URL withheld); resume existing task');}
 });
 const bytes=await download(url);const ext=bytes.subarray(0,2).toString()==='PK'?'.xlsx':bytes.subarray(0,4).toString('hex')==='d0cf11e0'?'.xls':null;
 if(!ext)throw Error('Native download is not XLS/XLSX');
 manifest.files.original=path.join(dir,'original'+ext);fs.writeFileSync(manifest.files.original,bytes);
 manifest.sha256=createHash('sha256').update(bytes).digest('hex');manifest.bytes=bytes.length;
 const parsed=spawnSync(process.env.PDD_EXPORT_PYTHON||'python',[fileURLToPath(new URL('./parse-promotion-export.py',import.meta.url)),manifest.files.original,mode,start,end],{encoding:'utf8',maxBuffer:64*1024*1024,timeout:60000});
 if(parsed.status!==0)throw Error('Native report parser failed: '+(parsed.stderr||parsed.error?.message||'unknown').slice(0,500));
 const data=JSON.parse(parsed.stdout);manifest.files.parsed=path.join(dir,'parsed.json');fs.writeFileSync(manifest.files.parsed,JSON.stringify(data,null,2));
 manifest.rowCount=data.rows.length;manifest.goodsCount=data.goodsCount;manifest.validation=data.validation;
 if(mode==='shop-hourly'){
  const ids=new Set(data.rows.map(r=>String(r['商品ID']))),current=new Set(list.adInfos.map(r=>String(r.goodsId)));
  manifest.coverage={listTotal:list.totalAdNum,exportGoodsCount:ids.size,missingCurrent:list.adInfos.filter(a=>!ids.has(String(a.goodsId))).map(a=>({adId:String(a.adId),goodsId:String(a.goodsId)})),extraGoods:[...ids].filter(id=>!current.has(id)),deletedGoods:[...new Set(data.rows.filter(r=>r['是否已删除']&&r['是否已删除']!=='否').map(r=>String(r['商品ID'])))]};
 }
 manifest.status='downloaded';manifest.completedAt=new Date().toISOString();save(manifest);return manifest;
}
export async function resolveNativeExport({date,taskId},post,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxPolls=60,onTask=async()=>{}}={}){
 const config=await post(ROOT+'queryWhiteListReportExportConfig',{});
 const dimension=config?.exportTypeConfigList?.find(x=>x.exportType.id===3)?.reportPromotionTypeConfigList?.find(x=>x.reportPromotionType.id===9)?.dimensionTypeList?.find(x=>x.dimensionType===2);
 if(!dimension)throw Error('Native goods hourly export not whitelisted');
 if(!taskId){
  const created=await post(ROOT+'generateReportExportTask',{exportType:3,startDate:date,endDate:date,exportList:[{reportPromotionType:9,dimensionList:[{name:dimension.name,dimensionType:2,id:dimension.id}]}]});
  if(created?.result?.length!==1||!created.result[0].id)throw Error('Export task generation ambiguous; do not regenerate automatically');
  taskId=created.result[0].id;await onTask(taskId);
 }
 for(let poll=0;poll<maxPolls;poll++){
  for(let pageNumber=1;pageNumber<=100;pageNumber++){
   const queue=await post(ROOT+'queryReportExportTaskList',{pageNumber,pageSize:10});
   if(!Array.isArray(queue?.result))throw Error('Export queue schema mismatch');
   const task=queue.result.find(x=>String(x.id)===String(taskId));
   if(task){
    if(task.exportType!==3||task.reportPromotionType!==9||!task.dimensionList?.some(x=>x.dimensionType===2)||!task.reportName.includes(date.replaceAll('-','')+'至'+date.replaceAll('-','')))throw Error('Exact export task scope/date mismatch');
    if(task.taskStatus===2&&task.downloadUrl)return task;
    if(task.taskStatus!==1)throw Error(`Export task ${taskId} failed status ${task.taskStatus}`);
    break;
   }
   if(pageNumber*10>=queue.total||!queue.result.length)break;
  }
  await sleep(2000);
 }
 throw Error(`Export task ${taskId} pending; resume with taskId, do not regenerate`);
}

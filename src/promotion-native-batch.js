export async function collectNativeDaily(list,exp,getCreative,{previous,save=async()=>{},delayMs=1000}={}){
 const ids=new Map(list.adInfos.map(a=>[String(a.adId),a]));
 if(!list.complete||ids.size!==list.totalAdNum||exp.date!==list.date||exp.identity.mallId!==list.identity.mallId)throw Error('Native batch identity/date/list mismatch');
 if(previous&&(previous.date!==list.date||previous.identity.mallId!==list.identity.mallId))throw Error('Resume identity/date mismatch');
 const valid=(r,id)=>r?.date===list.date&&r.identity?.mallId===list.identity.mallId&&r.identity?.adId===id&&r.identity?.goodsId===String(ids.get(id)?.goodsId)&&r.creativeDaily?.count===r.creativeDaily?.rows?.length&&!('hourly' in r);
 const state={date:list.date,timezone:'Asia/Shanghai',identity:list.identity,scope:'当前商品推广链接 scenesMode=1，不是全商品库；创意为平台返回的未删除图片',listTotal:list.totalAdNum,list,export:exp,hourlySource:'native-export-only',exportGoodsCount:exp.goodsCount,exportHourlyRows:exp.rowCount,missingCurrent:exp.coverage.missingCurrent,missingReason:'平台原生文件未导出；不补零，不另查小时',supplementaryHourlyCalls:0,supplementaryDetail:{status:'not-requested-by-user',success:0,failed:0},results:{},errors:{},creativeSuccess:0,creativeCount:0,creativeNullCount:0,complete:false};
 for(const [id,r]of Object.entries(previous?.results||{}))if(ids.has(id)&&valid(r,id))state.results[id]=r;
 const persist=async()=>{const r=Object.values(state.results);state.creativeSuccess=r.length;state.creativeFailed=Object.keys(state.errors).length;state.creativePending=ids.size-r.length;state.creativeCount=r.reduce((n,x)=>n+x.creativeDaily.count,0);state.creativeNullCount=r.reduce((n,x)=>n+x.creativeDaily.rows.filter(c=>c.reportInfo===null).length,0);state.complete=r.length===ids.size;await save(state);};
 await persist();
 for(const id of ids.keys()){
  if(valid(state.results[id],id))continue;
  try{const r=await getCreative(id);if(!valid(r,id))throw Error('Creative result identity/date/schema mismatch');state.results[id]=r;delete state.errors[id];}catch(e){state.errors[id]=e.message;}
  await persist();if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
 }
 return state;
}

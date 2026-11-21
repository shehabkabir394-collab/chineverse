import {upstream,rootData,itemsFrom,parseEncodedPath,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url),title=(u.searchParams.get("title")||"").trim(),se=Math.max(0,Number(u.searchParams.get("se"))||0),ep=Math.max(0,Number(u.searchParams.get("ep"))||0);
 let subjectId=(u.searchParams.get("subjectId")||"").trim(),detailPath=(u.searchParams.get("detailPath")||"").trim();
 if(!detailPath){const parsed=parseEncodedPath(u.searchParams.get("path"));detailPath=parsed.detailPath;subjectId=subjectId||parsed.subjectId;}
 if((!subjectId||!detailPath)&&title){
  try{const sr=await upstream("/wefeed-h5api-bff/subject/search",{method:"POST",body:{keyword:title,page:1,perPage:5,subjectType:0}});const item=itemsFrom(rootData(sr)).find(x=>String(x.title||"").toLowerCase()===title.toLowerCase())||itemsFrom(rootData(sr))[0];if(item){subjectId=subjectId||item.subjectId;detailPath=detailPath||item.detailPath;}}catch{}
 }
 if(!subjectId||!detailPath)return response({ok:false,error:"A valid subjectId and detailPath are required for playback."},400);
 try{const q=new URLSearchParams({subjectId,detailPath,se:String(se),ep:String(ep),streamSignType:"1"});
  const raw=await upstream("/wefeed-h5api-bff/subject/play?"+q.toString(),{referer:"https://movie-box.co/movies/"+detailPath+"?id="+subjectId,timeout:25000});
  const d=rootData(raw)||{},streams=Array.isArray(d.streams)?d.streams:Array.isArray(d.sources)?d.sources:[];
  return response({ok:true,...d,streams,subjectId,detailPath},200,"no-store");
 }catch(e){return response({ok:false,error:e.message||"Stream sources unavailable."},502);}
}
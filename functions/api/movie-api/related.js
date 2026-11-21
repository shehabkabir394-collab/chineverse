import {upstream,rootData,itemsFrom,parseEncodedPath,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url);let subjectId=(u.searchParams.get("subjectId")||"").trim(),title=(u.searchParams.get("title")||"").trim(),detailPath=(u.searchParams.get("detailPath")||"").trim();
 if(!subjectId&&u.searchParams.get("path")){const p=parseEncodedPath(u.searchParams.get("path"));subjectId=p.subjectId;detailPath=p.detailPath;}
 if(!subjectId&&title){try{const sr=await upstream("/wefeed-h5api-bff/subject/search",{method:"POST",body:{keyword:title,page:1,perPage:5,subjectType:0}});const item=itemsFrom(rootData(sr))[0];subjectId=item?.subjectId||"";}catch{}}
 if(!subjectId)return response({ok:false,error:"A subjectId is required for related titles."},400);
 try{const raw=await upstream("/wefeed-h5api-bff/subject/detail-rec?"+new URLSearchParams({subjectId,page:"1",perPage:"18"})),d=rootData(raw)||{};return response({ok:true,items:itemsFrom(d)},200,"public, max-age=300, s-maxage=420");}
 catch(e){return response({ok:false,error:e.message||"Related titles unavailable."},502);}
}
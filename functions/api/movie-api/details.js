import {upstream,rootData,itemsFrom,parseEncodedPath,normalizeDetail,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url),path=(u.searchParams.get("path")||"").trim(),title=(u.searchParams.get("title")||"").trim();
 let ids=parseEncodedPath(path);
 if(!ids.detailPath&&title){
  try{const sr=await upstream("/wefeed-h5api-bff/subject/search",{method:"POST",body:{keyword:title,page:1,perPage:5,subjectType:0}});const item=itemsFrom(rootData(sr))[0];if(item)ids={detailPath:item.detailPath,subjectId:item.subjectId};}catch{}
 }
 if(!ids.detailPath||!ids.subjectId)return response({ok:false,error:"A valid MovieBox detailPath and subjectId are required."},400);
 try{const raw=await upstream("/wefeed-h5api-bff/detail?"+new URLSearchParams({detailPath:ids.detailPath,subjectId:ids.subjectId}).toString());
  const out=normalizeDetail(raw,ids);return response(out,200,"public, max-age=120, s-maxage=180");
 }catch(e){return response({ok:false,error:e.message||"Movie details unavailable."},502);}
}
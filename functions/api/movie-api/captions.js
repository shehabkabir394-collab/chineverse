import {upstream,rootData,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url),id=(u.searchParams.get("id")||"").trim(),subjectId=(u.searchParams.get("subjectId")||"").trim(),detailPath=(u.searchParams.get("detailPath")||"").trim(),format=(u.searchParams.get("format")||"MP4").trim();
 if(!id||!subjectId||!detailPath)return response({ok:false,error:"Missing caption identifiers."},400);
 try{const raw=await upstream("/wefeed-h5api-bff/subject/caption?"+new URLSearchParams({format,id,subjectId,detailPath})),d=rootData(raw)||{};return response({ok:true,captions:d.captions||d.items||[]},200,"public, max-age=300");}
 catch(e){return response({ok:false,error:e.message||"Captions unavailable."},502);}
}
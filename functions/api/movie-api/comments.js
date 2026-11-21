import {upstream,rootData,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url),id=(u.searchParams.get("subjectId")||"").trim(),page=Math.max(0,Number(u.searchParams.get("page"))||0);
 if(!id)return response({ok:false,error:"Missing subjectId parameter."},400);
 try{const raw=await upstream("/wefeed-h5api-bff/post/list/subject?"+new URLSearchParams({id,page:String(page),perPage:"20"})),d=rootData(raw)||{};return response({ok:true,...d,comments:d.postList||d.items||[]});}
 catch(e){return response({ok:false,error:e.message||"Comments unavailable."},502);}
}
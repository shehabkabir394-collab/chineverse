import {upstream,rootData,itemsFrom,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url),q=(u.searchParams.get("q")||"").trim().slice(0,150),page=Math.max(1,Math.min(100,Number(u.searchParams.get("page"))||1));
 if(!q)return response({ok:false,error:"Search keyword is required."},400);
 try{
  const raw=await upstream("/wefeed-h5api-bff/subject/search",{method:"POST",body:{keyword:q,page,perPage:24,subjectType:0}});
  const d=rootData(raw)||{},items=itemsFrom(d);
  return response({ok:true,items,pager:d.pager||d.page||d.pagination||null},200,"public, max-age=45, s-maxage=60");
 }catch(e){return response({ok:false,error:e.message||"Search unavailable."},502);}
}
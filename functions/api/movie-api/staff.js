import {upstream,rootData,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url),staffId=(u.searchParams.get("staffId")||"").trim(),page=Math.max(1,Number(u.searchParams.get("page"))||1);
 if(!staffId)return response({ok:false,error:"Missing staffId parameter."},400);
 try{const [list,related]=await Promise.all([
  upstream("/wefeed-h5api-bff/staff/subject-list?"+new URLSearchParams({perPage:"24",page:String(page),staffId})),
  upstream("/wefeed-h5api-bff/staff/staff-related?"+new URLSearchParams({staffId})).catch(()=>null)
 ]);return response({ok:true,staff:rootData(related)||{},items:(rootData(list)?.items||rootData(list)?.subjectList||[])});}
 catch(e){return response({ok:false,error:e.message||"Staff details unavailable."},502);}
}
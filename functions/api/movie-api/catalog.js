import {upstream,rootData,itemsFrom,response} from "../../_shared/moviebox.js";
function channel(path){const p=String(path||"").toLowerCase();if(p.startsWith("mb-channel:"))return Number(p.split(":")[1])||1;if(/anime/.test(p))return 6;if(/short/.test(p))return 7;if(/series|drama|korean|chinese|japanese|ongoing/.test(p))return 2;return 1;}
export async function onRequestGet({request}){
 const u=new URL(request.url),path=(u.searchParams.get("path")||"").slice(0,300),page=Math.max(1,Math.min(100,Number(u.searchParams.get("page"))||1));
 if(!path)return response({ok:false,error:"Catalog category path is required."},400);
 if(/adult18plus|adult[-_/]?18/i.test(path))return response({ok:false,error:"This category is not available on CineVerse."},403);
 try{
  const body={page,perPage:24,channelId:channel(path),genre:u.searchParams.get("genre")||"",country:u.searchParams.get("country")||"",year:u.searchParams.get("year")||"",sort:u.searchParams.get("sort")||"Latest"};
  const raw=await upstream("/wefeed-h5api-bff/subject/filter",{method:"POST",body}),d=rootData(raw)||{};
  return response({ok:true,items:itemsFrom(d),pager:d.pager||d.page||d.pagination||null,categories:[]},200,"public, max-age=60, s-maxage=90");
 }catch(e){return response({ok:false,error:e.message||"Catalog unavailable."},502);}
}
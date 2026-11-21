import {upstream,rootData,itemsFrom,response} from "../../_shared/moviebox.js";
const aliases={"Prime Video":"PrimeVideo","Disney+":"Disney","Apple TV+":"AppleTV","Zee5":"Zee5","Hoichoi":"Hoichoi","Netflix":"Netflix","Hulu":"Hulu","Vivamax":"Vivamax","Viu":"Viu","Showmax":"Showmax"};
export async function onRequestGet({request}){
 const u=new URL(request.url),name=(u.searchParams.get("name")||"").trim(),page=Math.max(1,Number(u.searchParams.get("page"))||1);
 if(!name)return response({ok:false,error:"Missing platform name."},400);
 const platform=aliases[name]||name.replace(/[^A-Za-z0-9]/g,"");
 try{const raw=await upstream("/wefeed-h5api-bff/platform/play-list?"+new URLSearchParams({page:String(page),perPage:"6",platform})),d=rootData(raw)||{};
  const months=Array.isArray(d.monthList)?d.monthList:[],items=months.flatMap(m=>(Array.isArray(m.subjects)?m.subjects:[]).map(x=>({...x,_platformMonth:m.month})));
  return response({ok:true,items:itemsFrom({items}),monthList:months.map(m=>({month:m.month,count:Array.isArray(m.subjects)?m.subjects.length:0})),totalPages:Math.max(1,months.length)},200,"public, max-age=180, s-maxage=240");
 }catch(e){return response({ok:false,error:e.message||"Platform playlist unavailable."},502);}
}
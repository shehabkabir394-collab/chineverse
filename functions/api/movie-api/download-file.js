import {upstream,rootData,parseEncodedPath,response} from "../../_shared/moviebox.js";
export async function onRequestGet({request}){
 const u=new URL(request.url),subjectId=(u.searchParams.get("subjectId")||"").trim(),detailPath=(u.searchParams.get("detailPath")||"").trim(),title=(u.searchParams.get("title")||"").trim();
 const se=Math.max(0,Number(u.searchParams.get("se"))||0),ep=Math.max(0,Number(u.searchParams.get("ep"))||0),quality=String(u.searchParams.get("quality")||"best").replace(/[^0-9]/g,"");
 if(!subjectId||!detailPath)return response({ok:false,error:"Download requires a valid subjectId and detailPath."},400);
 try{
  const q=new URLSearchParams({subjectId,detailPath,se:String(se),ep:String(ep),streamSignType:"1"});
  const raw=await upstream("/wefeed-h5api-bff/subject/play?"+q.toString(),{referer:"https://movie-box.co/movies/"+detailPath+"?id="+subjectId,timeout:25000});
  const d=rootData(raw)||{},streams=Array.isArray(d.streams)?d.streams:[];
  const mp4=streams.filter(x=>/mp4/i.test(String(x.format||x.type||""))&&typeof x.url==="string");
  const selected=(quality?mp4.find(x=>String(x.resolutions||x.quality||"").includes(quality)):null)||mp4.sort((a,b)=>Number(b.resolutions||b.quality||0)-Number(a.resolutions||a.quality||0))[0];
  if(!selected?.url)return response({ok:false,error:"No MP4 download source was supplied for this episode."},404);
  const target=new URL(selected.url);
  if(target.protocol!=="https:"||!(target.hostname==="aoneroom.com"||target.hostname.endsWith(".aoneroom.com")))return response({ok:false,error:"The download source host is not in the approved MovieBox CDN allowlist."},502);
  const file=await fetch(target.toString(),{headers:{"Accept":"video/mp4,application/octet-stream,*/*","Referer":"https://movie-box.co/"},redirect:"follow",signal:AbortSignal.timeout(120000)});
  if(!file.ok||!file.body)return response({ok:false,error:"The source file returned HTTP "+file.status+"."},502);
  const ql=String(selected.resolutions||selected.quality||quality||"HD").replace(/[^0-9A-Za-z]/g,"").slice(0,12)||"HD";
  return new Response(file.body,{status:200,headers:{"Content-Type":file.headers.get("Content-Type")||"video/mp4","Content-Disposition":'attachment; filename="CineVerse-Episode-'+(ep+1)+'-'+ql+'.mp4"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){return response({ok:false,error:e?.name==="TimeoutError"?"Download timed out.":e.message||"Download unavailable."},502);}
}
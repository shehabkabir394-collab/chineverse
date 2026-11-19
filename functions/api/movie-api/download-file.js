const BASE="https://hd-w0l1.onrender.com/api/trial/stream";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const getItems=data=>[...(Array.isArray(data?.sources)?data.sources:[]),...(Array.isArray(data?.downloadButtons)?data.downloadButtons:[])];
const qualityOf=s=>String(s.quality||s.resolution||s.label||"").match(/\d{3,4}/)?.[0]||"";
export async function onRequestGet({request,env}){
 if(!env.MOVIE_API_KEY)return json({error:"Movie API key is not configured."},503);
 const u=new URL(request.url),subjectId=(u.searchParams.get("subjectId")||"").trim(),se=Math.max(0,Math.floor(Number(u.searchParams.get("se"))||0)),ep=Math.max(0,Math.floor(Number(u.searchParams.get("ep"))||0)),quality=String(u.searchParams.get("quality")||"").replace(/[^0-9]/g,"");
 if(!/^[a-zA-Z0-9_-]{1,160}$/.test(subjectId)||!/^\d{3,4}$/.test(quality))return json({error:"Invalid episode or quality."},400);
 const api=new URL(BASE);api.searchParams.set("subjectId",subjectId);api.searchParams.set("se",String(se));api.searchParams.set("ep",String(ep));api.searchParams.set("apiKey",env.MOVIE_API_KEY);
 try{
  const r=await fetch(api,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)});if(!r.ok)return json({error:"Stream API returned HTTP "+r.status},502);
  const data=await r.json(),item=getItems(data).find(s=>qualityOf(s)===quality);
  const fileUrl=item?.downloadUrl||item?.url;
  if(!fileUrl)return json({error:"Requested MP4 quality was not returned."},404);
  const target=new URL(fileUrl);
  if(target.protocol!=="https:"||["localhost","127.0.0.1","0.0.0.0"].includes(target.hostname))return json({error:"Unsafe download source."},502);
  const file=await fetch(target,{headers:{Accept:"video/mp4,application/octet-stream,*/*"},redirect:"follow",signal:AbortSignal.timeout(120000)});
  if(!file.ok||!file.body)return json({error:"Source file returned HTTP "+file.status},502);
  const filename="MovieStreamBD-Episode-"+(ep+1)+"-"+quality+"p.mp4";
  return new Response(file.body,{status:200,headers:{"Content-Type":file.headers.get("Content-Type")||"application/octet-stream","Content-Disposition":'attachment; filename="'+filename+'"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch(e){return json({error:e?.name==="TimeoutError"?"Download source timed out.":"Could not fetch episode file."},502);}
}
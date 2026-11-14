const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const isPlayable=s=>{if(!s||typeof s.url!=="string"||!/^https:\/\//i.test(s.url))return false;const mime=String(s.mime_type||"").toLowerCase();return /\.(m3u8|mp4|webm|mov)(?:$|[?#])/i.test(s.url)||mime==="application/vnd.apple.mpegurl"||mime.startsWith("video/");};
export async function onRequestGet({request,env}){
 const api=env.PLAYBACK_SOURCE_API_URL,key=env.PLAYBACK_SOURCE_API_KEY;
 if(!api)return json({error:"Direct playback source provider is not configured yet. Add PLAYBACK_SOURCE_API_URL and PLAYBACK_SOURCE_API_KEY in Cloudflare Pages secrets."},503);
 const q=new URL(request.url).searchParams;
 const title=(q.get("title")||"").trim(),tmdbId=(q.get("tmdb_id")||"").trim(),season=Number(q.get("season")),episode=Number(q.get("episode"));
 if(!title||!Number.isInteger(season)||!Number.isInteger(episode)||season<0||episode<0)return json({error:"A title, season and episode are required."},400);
 let target;try{target=new URL(api)}catch{return json({error:"PLAYBACK_SOURCE_API_URL must be a valid HTTPS URL."},503)}
 if(target.protocol!=="https:")return json({error:"Playback source API must use HTTPS."},503);
 target.searchParams.set("title",title);target.searchParams.set("tmdb_id",tmdbId);target.searchParams.set("season",String(season));target.searchParams.set("episode",String(episode));target.searchParams.set("region",q.get("region")||"BD");
 try{
  const response=await fetch(target.toString(),{headers:{Accept:"application/json",...(key?{Authorization:"Bearer "+key,"X-API-Key":key}:{})},signal:AbortSignal.timeout(12000)});
  if(!response.ok)return json({error:"Playback source provider returned HTTP "+response.status+"."},502);
  const payload=await response.json(),items=Array.isArray(payload)?payload:payload.sources;
  if(!Array.isArray(items))return json({error:"Source API response must contain a sources array."},502);
  // Never publish unverified or provider-page links as playable media.
  const sources=items.filter(s=>s&&s.rights_verified===true&&isPlayable(s)).map(s=>({url:s.url,quality:String(s.quality||"Auto"),mime_type:s.mime_type||"",provider:String(s.provider||"Licensed source").slice(0,100)})).slice(0,8);
  return json({sources});
 }catch(e){return json({error:e.name==="TimeoutError"?"Playback source search timed out.":"Could not reach the playback source provider."},502)}
}

const BASE = "https://hd-w0l1.onrender.com/api/trial/stream";
const json = (data, status = 200) => new Response(JSON.stringify(data), {status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function onRequestGet({request,env}) {
 if(!env.MOVIE_API_KEY) return json({error:"Movie API key is not configured."},503);
 const incoming=new URL(request.url),subjectId=(incoming.searchParams.get("subjectId")||"").trim();
 const se=Math.max(0,Math.floor(Number(incoming.searchParams.get("se"))||0));
 const ep=Math.max(0,Math.floor(Number(incoming.searchParams.get("ep"))||0));
 if(!/^[a-zA-Z0-9_-]{1,160}$/.test(subjectId)) return json({error:"Invalid subjectId."},400);
 const upstream=new URL(BASE);
 upstream.searchParams.set("subjectId",subjectId);upstream.searchParams.set("se",String(se));upstream.searchParams.set("ep",String(ep));upstream.searchParams.set("apiKey",env.MOVIE_API_KEY);
 try {
  const response=await fetch(upstream.toString(),{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)});
  const body=await response.text();
  let data;try{data=JSON.parse(body)}catch{return json({error:"Stream API returned invalid JSON."},502)}
  if(!response.ok)return json({error:"Stream API returned HTTP "+response.status,details:data?.message||data?.error||null},502);
  delete data.apiKey;delete data.trial;
  return json(data);
 } catch {return json({error:"Could not load stream download sources."},502);}
}
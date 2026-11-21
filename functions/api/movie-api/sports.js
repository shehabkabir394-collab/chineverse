const BASE="https://hd-hcfs.onrender.com/api/trial/sports";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function onRequestGet({env}){
 const key=env.MOVIEBOX_API_KEY||env.MOVIE_API_KEY||env.MOVIE_API_KOY;
 if(!key)return json({error:"Sports API key is not configured. Add MOVIEBOX_API_KEY as a Cloudflare Pages secret."},503);
 try{
  const url=new URL(BASE);
  // Sports API documentation/example uses apiKey query parameter.
  url.searchParams.set("apiKey",key);
  const response=await fetch(url.toString(),{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(25000)});
  const body=await response.text();let data;
  try{data=JSON.parse(body)}catch{return json({error:"Sports API returned non-JSON response.",upstreamStatus:response.status},502)}
  if(!response.ok)return json({error:"Sports API returned HTTP "+response.status,details:data?.message||data?.error||null},502);
  if(!data||typeof data!=="object")return json({error:"Invalid Sports API response."},502);
  delete data.apiKey;delete data.trial;
  return json(data);
 }catch{return json({error:"Could not connect to Live Sports API."},502)}
}
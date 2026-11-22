const HOST = "okay-891h.onrender.com";
const ALLOWED = new Set(["/api/mb-stream.mp4", "/api/mb-ep-stream.mp4"]);
function json(data,status=400){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequest({request,env}){
 if(request.method!=="GET"&&request.method!=="HEAD")return json({ok:false,error:"Method not allowed"},405);
 if(!env.CINEPULSE_API_KEY)return json({ok:false,error:"CinePulse API secret is not configured"},503);
 const incoming=new URL(request.url),route=incoming.searchParams.get("route")==="mb-stream.mp4"?"/api/mb-stream.mp4":incoming.searchParams.get("route")==="mb-ep-stream.mp4"?"/api/mb-ep-stream.mp4":"";
 if(!ALLOWED.has(route))return json({ok:false,error:"Invalid media route"},400);
 const upstream=new URL("https://"+HOST+route);
 for(const [k,v] of incoming.searchParams){if(k!=="route"&&k.toLowerCase()!=="api_key")upstream.searchParams.append(k,v);}
 upstream.searchParams.set("api_key",env.CINEPULSE_API_KEY);
 try{
  const headers=new Headers();const range=request.headers.get("range");if(range)headers.set("range",range);
  headers.set("referer","https://movie-box.co/");
  const response=await fetch(upstream.toString(),{method:request.method,headers,redirect:"follow",signal:AbortSignal.timeout(60000)});
  const out=new Headers();for(const h of ["content-type","content-length","content-range","accept-ranges","last-modified","etag"]) {const v=response.headers.get(h);if(v)out.set(h,v);}
  out.set("cache-control","private, no-store");out.set("access-control-allow-origin","*");out.set("x-content-type-options","nosniff");
  return new Response(request.method==="HEAD"?null:response.body,{status:response.status,headers:out});
 }catch(e){return json({ok:false,error:"CinePulse media source unavailable"},502);}
}

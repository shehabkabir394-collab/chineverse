const API="https://api.themoviedb.org/3";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const norm=s=>(s||"").toLowerCase().normalize("NFKD").replace(/[’']/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const img=(p,size)=>p&&p.startsWith("/")?"https://image.tmdb.org/t/p/"+size+p:null;
function parseName(filename){
 const base=filename.split("/").pop().replace(/\.[^.]+$/,"");
 const cleaned=base.replace(/[._]+/g," ").replace(/\b(480p|720p|1080p|2160p|4k|uhd|web[ .-]?dl|webrip|bluray|brrip|hdtv|x264|x265|h264|h265|hevc|aac|dts|proper|repack)\b/ig," ").replace(/\s+/g," ").trim();
 const yearMatch=cleaned.match(/\b(19\d{2}|20\d{2})\b/);
 const title=(yearMatch?cleaned.slice(0,yearMatch.index):cleaned).replace(/[()\[\]-]+$/g,"").trim();
 return {title,year:yearMatch?Number(yearMatch[1]):null};
}
export async function onRequestPost({request,env}){
 const secret=env.SERVER_IMPORT_SECRET;
 if(!secret||request.headers.get("authorization")!=="Bearer "+secret)return json({error:"Unauthorized"},401);
 if(!env.TMDB_API_READ_ACCESS_TOKEN||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.VIDEO_SERVER_BASE_URL)return json({error:"Server import is not configured"},503);
 let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400)}
 const filename=String(body.filename||"").slice(0,500),relative=String(body.relative_path||"").replace(/\\/g,"/");
 if(!filename||!relative||relative.startsWith("/")||relative.split("/").some(x=>!x||x==="."||x===".."))return json({error:"Invalid file path"},400);
 if(!/^\.(mp4|mkv|webm|mov|m4v)$/i.test(filename.slice(filename.lastIndexOf("."))))return json({error:"Unsupported video format"},415);
 const {title,year}=parseName(filename);if(!title)return json({error:"Could not read movie title from filename"},422);
 const headers={Authorization:"Bearer "+env.TMDB_API_READ_ACCESS_TOKEN,accept:"application/json"};
 try{
  const searchUrl=API+"/search/movie?include_adult=false&language=en-US&page=1&query="+encodeURIComponent(title);
  const sr=await fetch(searchUrl,{headers});if(!sr.ok)return json({error:"TMDB search failed"},502);
  const results=(await sr.json()).results||[];
  const exact=results.filter(x=>[norm(x.title),norm(x.original_title)].includes(norm(title)));
  const chosen=(year?exact.find(x=>(x.release_date||"").startsWith(String(year))):null)||exact[0];
  if(!chosen)return json({error:"No confident TMDB title match",parsed_title:title,parsed_year:year},422);
  const id=chosen.id;
  const [dr,cr,vr]=await Promise.all(["/movie/"+id+"?language=en-US","/movie/"+id+"/credits?language=en-US","/movie/"+id+"/videos?language=en-US"].map(p=>fetch(API+p,{headers})));
  if(!dr.ok)return json({error:"TMDB details unavailable"},502);
  const [m,c,v]=await Promise.all([dr.json(),cr.ok?cr.json():{},vr.ok?vr.json():{}]);
  const trailer=(v.results||[]).find(x=>x.site==="YouTube"&&x.type==="Trailer");
  const videoUrl=env.VIDEO_SERVER_BASE_URL.replace(/\/$/,"")+"/"+relative.split("/").map(encodeURIComponent).join("/");
  const sourceKey=String(body.source_key||"").slice(0,128);if(!sourceKey)return json({error:"Missing source key"},400);
  const movie={title:m.title||title,release_year:(m.release_date||"").slice(0,4)?Number((m.release_date||"").slice(0,4)):year,genre:(m.genres||[]).map(x=>x.name).join(", "),language:(m.original_language||"").toUpperCase(),quality:"1080p",description:m.overview||"",poster_url:img(m.poster_path,"w500"),backdrop_url:img(m.backdrop_path,"w1280"),trailer_url:trailer?"https://www.youtube.com/embed/"+trailer.key:null,rating:m.vote_average||null,runtime_minutes:m.runtime||null,cast_members:(c.cast||[]).slice(0,12).map(x=>x.name).join(", "),tmdb_id:id,media_type:"movie",video_url:videoUrl,watch_url:videoUrl,download_url:videoUrl,published:true,content_status:m.status||"Released"};
  const supa=env.SUPABASE_URL.replace(/\/$/,"");
  const resp=await fetch(supa+"/rest/v1/rpc/cineverse_import_server_movie",{method:"POST",headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,"Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({p_source_key:sourceKey,p_movie:movie})});
  const result=await resp.json().catch(()=>null);if(!resp.ok)return json({error:"Supabase import failed",details:result},502);
  return json({ok:true,...result,title:movie.title,tmdb_id:id,video_url:videoUrl});
 }catch{return json({error:"Unexpected import error"},502)}
}

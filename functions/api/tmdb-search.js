const API="https://api.themoviedb.org/3";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=300, s-maxage=300"}});
const lang=c=>({bn:"Bangla",en:"English",hi:"Hindi",ja:"Japanese",ko:"Korean",ta:"Tamil",te:"Telugu",ml:"Malayalam",fr:"French",es:"Spanish",de:"German",zh:"Chinese"}[c]||String(c||"").toUpperCase());
const img=(p,size)=>typeof p==="string"&&p.startsWith("/")?"https://image.tmdb.org/t/p/"+size+p:null;
export async function onRequestGet({request,env}){
 const u=new URL(request.url),q=(u.searchParams.get("q")||"").trim().slice(0,100),page=Number(u.searchParams.get("page")||1);
 if(q.length<2)return json({error:"Enter at least two characters."},400);
 if(!Number.isInteger(page)||page<1||page>500)return json({error:"Invalid page."},400);
 const token=env.TMDB_API_READ_ACCESS_TOKEN;if(!token)return json({error:"TMDB is not configured. Add TMDB_API_READ_ACCESS_TOKEN in Cloudflare Pages → Settings → Variables and Secrets."},503);
 try{
  const r=await fetch(API+"/search/movie?include_adult=false&language=en-US&page="+page+"&query="+encodeURIComponent(q),{headers:{Authorization:"Bearer "+token,accept:"application/json"},signal:AbortSignal.timeout(10000)});
  if(!r.ok)return json({error:"TMDB search failed (HTTP "+r.status+")."},502);
  const d=await r.json(),movies=(d.results||[]).filter(m=>m&&!m.adult&&m.title).map(m=>({id:"tmdb-"+m.id,tmdb_id:Number(m.id),source:"tmdb",title:String(m.title).slice(0,180),media_type:"movie",release_year:(String(m.release_date||"").match(/^(\d{4})/)||[])[1]?Number(String(m.release_date).slice(0,4)):null,genre:"",language:lang(m.original_language),quality:"HD",rating:Number.isFinite(Number(m.vote_average))?Math.round(Number(m.vote_average)*10)/10:null,description:String(m.overview||"").slice(0,3000),poster_url:img(m.poster_path,"w500"),backdrop_url:img(m.backdrop_path,"w1280"),created_at:m.release_date||""}));
  return json({query:q,page,total_pages:Math.min(Number(d.total_pages||1),500),total_results:Number(d.total_results||0),movies});
 }catch(e){return json({error:e?.name==="TimeoutError"?"Search timed out. Please try again.":"Could not search TMDB."},502)}
}
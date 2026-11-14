const API="https://api.themoviedb.org/3";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=1800, s-maxage=1800"}});
const img=(p,size)=>p&&p.startsWith("/")?"https://image.tmdb.org/t/p/"+size+p:null;
const norm=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g," ").trim();
const score=(q,name)=>{const a=norm(q),b=norm(name);if(!a||!b)return 0;if(a===b)return 100;if(b.includes(a)||a.includes(b))return 85;const aa=new Set(a.split(" ")),bb=new Set(b.split(" "));let hit=0;for(const x of aa)if(bb.has(x))hit++;return hit/Math.max(aa.size,bb.size)*70};
const genres={10759:"Action & Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",18:"Drama",10751:"Family",10762:"Kids",9648:"Mystery",10763:"News",10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics",37:"Western"};
export async function onRequestGet({request,env}){
 const u=new URL(request.url),q=(u.searchParams.get("q")||"").trim().slice(0,100),id=u.searchParams.get("id");
 const token=env.TMDB_API_READ_ACCESS_TOKEN;
 if(!token)return json({error:"TMDB is not configured. Add TMDB_API_READ_ACCESS_TOKEN in Cloudflare Pages → Settings → Variables and Secrets."},503);
 const headers={Authorization:"Bearer "+token,accept:"application/json"};
 try{
  if(id){
   if(!/^[0-9]{1,12}$/.test(id))return json({error:"Invalid TV ID."},400);
   const r=await fetch(API+"/tv/"+id+"?language=en-US",{headers,signal:AbortSignal.timeout(10000)});
   if(!r.ok)return json({error:"TV details unavailable."},r.status===404?404:502);
   const m=await r.json();
   return json({id:Number(m.id),title:m.name||"",overview:m.overview||"",year:(m.first_air_date||"").slice(0,4),rating:Number.isFinite(Number(m.vote_average))?Math.round(Number(m.vote_average)*10)/10:null,poster:img(m.poster_path,"w500"),backdrop:img(m.backdrop_path,"w1280"),genres:(m.genres||[]).map(x=>x.name),status:m.status||"",seasons:(m.seasons||[]).filter(x=>x.season_number>0).map(x=>({number:x.season_number,name:x.name,episodes:x.episode_count,poster:img(x.poster_path,"w300")}))});
  }
  if(q.length<2)return json({error:"Enter a title."},400);
  const r=await fetch(API+"/search/tv?include_adult=false&language=en-US&page=1&query="+encodeURIComponent(q),{headers,signal:AbortSignal.timeout(10000)});
  if(!r.ok)return json({error:"TMDB TV search failed."},502);
  const d=await r.json(),ranked=(d.results||[]).filter(x=>x&&!x.adult&&x.name).map(x=>({...x,_score:score(q,x.name)})).sort((a,b)=>b._score-a._score||b.popularity-a.popularity),m=ranked[0];
  if(!m||m._score<35)return json({match:null});
  return json({match:{id:Number(m.id),title:m.name,overview:m.overview||"",year:(m.first_air_date||"").slice(0,4),rating:Number.isFinite(Number(m.vote_average))?Math.round(Number(m.vote_average)*10)/10:null,poster:img(m.poster_path,"w500"),backdrop:img(m.backdrop_path,"w1280"),genres:(m.genre_ids||[]).map(x=>genres[x]).filter(Boolean)}});
 }catch(e){return json({error:e?.name==="TimeoutError"?"TMDB request timed out.":"Could not load TMDB TV data."},502)}
}
const SUPABASE_URL="https://bqvlkprluentrsovfpcy.supabase.co";
const SUPABASE_PUBLIC_KEY="sb_publishable_7Kna5pXHrSnKiO_s8Wr3bA_T5AAj4me";
const TMDB_API="https://api.themoviedb.org/3";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function requireAdmin(request){
 const authorization=request.headers.get("Authorization")||"";
 if(!/^Bearer\s+\S+$/i.test(authorization))throw Error("Sign in as an approved administrator first.");
 const u=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:{apikey:SUPABASE_PUBLIC_KEY,Authorization:authorization},signal:AbortSignal.timeout(8000)});
 if(!u.ok)throw Error("Your admin session expired. Sign in again.");
 const user=await u.json();if(!user?.id)throw Error("Admin sign-in required.");
 const m=await fetch(SUPABASE_URL+"/rest/v1/admin_users?user_id=eq."+encodeURIComponent(user.id)+"&select=user_id&limit=1",{headers:{apikey:SUPABASE_PUBLIC_KEY,Authorization:authorization},signal:AbortSignal.timeout(8000)});
 if(!m.ok)throw Error("Could not verify admin permission.");
 const rows=await m.json();if(!Array.isArray(rows)||rows.length!==1)throw Error("Only approved administrators can import dramas.");
}
const lang={ko:"Korean",zh:"Chinese",ja:"Japanese",th:"Thai"};
const countries={Korean:"KR",Chinese:"CN",Japanese:"JP",Thai:"TH"};
const genresMap=(items)=>new Map((items||[]).map(x=>[x.id,x.name]));
const image=(p,size)=>typeof p==="string"&&/^\/[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(p)?"https://image.tmdb.org/t/p/"+size+p:null;
async function pool(items,limit,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;out[i]=await fn(items[i]);}}));return out;}
export async function onRequestPost({request,env}){
 try{
  await requireAdmin(request);
  const body=await request.json(),country=body?.country,pages=Number(body?.pages||1),category=body?.category||"popular",region=String(body?.region||"BD").toUpperCase();
  if(!countries[country])return json({error:"Choose Korean, Chinese, Japanese or Thai drama."},400);
  if(!Number.isInteger(pages)||pages<1||pages>5)return json({error:"Choose 1 to 5 pages."},400);
  if(!["popular","top_rated","airing_today","on_the_air"].includes(category))return json({error:"Unsupported drama list."},400);
  if(!/^[A-Z]{2}$/.test(region))return json({error:"Invalid region."},400);
  const token=env.TMDB_API_READ_ACCESS_TOKEN;if(!token)return json({error:"TMDB is not configured. Add TMDB_API_READ_ACCESS_TOKEN in Cloudflare Pages → Settings → Variables and Secrets."},503);
  const headers={Authorization:"Bearer "+token,accept:"application/json"};
  const requests=Array.from({length:pages},(_,i)=>fetch(TMDB_API+"/discover/tv?include_adult=false&language=en-US&sort_by="+(category==="popular"?"popularity.desc":category==="top_rated"?"vote_average.desc&vote_count.gte=10":category==="airing_today"?"popularity.desc&air_date.gte="+new Date().toISOString().slice(0,10):"popularity.desc")+"&with_origin_country="+countries[country]+"&page="+(i+1),{headers,signal:AbortSignal.timeout(12000)}));
  const [responses,genreResponse]=await Promise.all([Promise.all(requests),fetch(TMDB_API+"/genre/tv/list?language=en-US",{headers,signal:AbortSignal.timeout(10000)})]);
  const failed=responses.find(x=>!x.ok);if(failed)return json({error:"TMDB drama list failed (HTTP "+failed.status+")."},502);
  if(!genreResponse.ok)return json({error:"TMDB TV genres could not be loaded."},502);
  const [bodies,genreBody]=await Promise.all([Promise.all(responses.map(x=>x.json())),genreResponse.json()]);
  const genres=genresMap(genreBody.genres),all=bodies.flatMap(x=>x.results||[]).filter(x=>x&&x.name&&x.origin_country?.includes(countries[country]));
  const unique=[...new Map(all.map(x=>[x.id,x])).values()];
  const dramas=await pool(unique,4,async item=>{
   try{
    const r=await fetch(TMDB_API+"/tv/"+item.id+"/watch/providers",{headers,signal:AbortSignal.timeout(9000)});
    if(!r.ok)return null;const d=await r.json(),market=d.results?.[region];if(!market)return null;
    const free=[...(market.free||[]),...(market.ads||[])];if(!free.length||!market.link)return null;
    const providers=[...new Set(free.map(x=>x.provider_name).filter(Boolean))];
    const year=String(item.first_air_date||"").slice(0,4);
    return {tmdb_id:Number(item.id),title:String(item.name).slice(0,180),media_type:"series",release_year:/^\d{4}$/.test(year)?Number(year):null,genre:(item.genre_ids||[]).map(id=>genres.get(id)).filter(Boolean).join(", "),language:lang[item.original_language]||item.original_language||country,quality:"Other",rating:Number.isFinite(Number(item.vote_average))?Math.round(Number(item.vote_average)*10)/10:null,description:String(item.overview||"").slice(0,5000),poster_url:image(item.poster_path,"w500"),backdrop_url:image(item.backdrop_path,"w1280"),trailer_url:null,watch_url:market.link,video_url:null,download_url:null,download_links:[],cast_members:"",runtime_minutes:null,content_status:item.status||"Released",seasons:item.number_of_seasons||null,episodes:item.number_of_episodes||null,tags:"Country: "+country+", Free providers: "+providers.join(", "),published:false,free_providers:providers,provider_region:region}; 
   }catch{return null;}
  });
  const results=dramas.filter(Boolean);
  return json({country,region,category,pages,count:results.length,checked:unique.length,without_free_link:unique.length-results.length,dramas:results});
 }catch(e){return json({error:e?.name==="TimeoutError"?"TMDB took too long to respond. Try fewer pages.":e?.message||"Could not load dramas."},400);}
}

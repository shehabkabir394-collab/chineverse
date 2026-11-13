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
  const body=await request.json(),country=body?.country,pages=Number(body?.pages||1),category=body?.category||"popular";
  if(!countries[country])return json({error:"Choose Korean, Chinese, Japanese or Thai drama."},400);
  if(!Number.isInteger(pages)||pages<1||pages>5)return json({error:"Choose 1 to 5 pages."},400);
  if(!["popular","top_rated"].includes(category))return json({error:"Unsupported drama list."},400);
  const token=env.TMDB_API_READ_ACCESS_TOKEN;if(!token)return json({error:"TMDB is not configured. Add TMDB_API_READ_ACCESS_TOKEN in Cloudflare Pages → Settings → Variables and Secrets."},503);
  const headers={Authorization:"Bearer "+token,accept:"application/json"};
  const requests=Array.from({length:pages},(_,i)=>fetch(TMDB_API+"/discover/tv?include_adult=false&language=en-US&sort_by="+(category==="popular"?"popularity.desc":"vote_average.desc&vote_count.gte=10")+"&with_origin_country="+countries[country]+"&page="+(i+1),{headers,signal:AbortSignal.timeout(12000)}));
  const [responses,genreResponse]=await Promise.all([Promise.all(requests),fetch(TMDB_API+"/genre/tv/list?language=en-US",{headers,signal:AbortSignal.timeout(10000)})]);
  const failed=responses.find(x=>!x.ok);if(failed)return json({error:"TMDB drama list failed (HTTP "+failed.status+")."},502);
  if(!genreResponse.ok)return json({error:"TMDB TV genres could not be loaded."},502);
  const [bodies,genreBody]=await Promise.all([Promise.all(responses.map(x=>x.json())),genreResponse.json()]);
  const genres=genresMap(genreBody.genres),all=bodies.flatMap(x=>x.results||[]).filter(x=>x&&x.name&&x.origin_country?.includes(countries[country]));
  const unique=[...new Map(all.map(x=>[x.id,x])).values()];
  const watchmodeKey=env.WATCHMODE_API_KEY;
  if(!watchmodeKey)return json({error:"Watchmode is not configured. Add WATCHMODE_API_KEY in Cloudflare Pages → Settings → Variables and Secrets."},503);
  const sourceRegions=["IN","JP","TH"];
  const dramas=await pool(unique,4,async item=>{
   try{
    const wmUrl=new URL("https://api.watchmode.com/v1/title/tv-"+item.id+"/sources/");
    wmUrl.searchParams.set("apiKey",watchmodeKey);wmUrl.searchParams.set("regions",sourceRegions.join(","));
    const wr=await fetch(wmUrl,{signal:AbortSignal.timeout(10000)});
    let sources=[];
    if(wr.ok){
     const raw=await wr.json();
     sources=(Array.isArray(raw)?raw:raw?.sources||[]).filter(x=>sourceRegions.includes(String(x.region||"").toUpperCase())&&/^https:\/\//i.test(x.web_url||"")).map(x=>({name:String(x.name||"Streaming service").slice(0,100),type:String(x.type||"sub").toLowerCase(),region:String(x.region).toUpperCase(),web_url:x.web_url}));
    }
    const typeRank={free:0,sub:1,tve:2,rent:3,buy:4};
    sources.sort((a,b)=>(sourceRegions.indexOf(a.region)-sourceRegions.indexOf(b.region))||((typeRank[a.type]??9)-(typeRank[b.type]??9)));
    const primary=sources[0]||null,year=String(item.first_air_date||"").slice(0,4);
    const sourceTag=sources.length?", Watchmode Sources: "+encodeURIComponent(JSON.stringify(sources)):"";
    return {tmdb_id:Number(item.id),title:String(item.name).slice(0,180),media_type:"series",release_year:/^\d{4}$/.test(year)?Number(year):null,genre:(item.genre_ids||[]).map(id=>genres.get(id)).filter(Boolean).join(", "),language:lang[item.original_language]||item.original_language||country,quality:"Other",rating:Number.isFinite(Number(item.vote_average))?Math.round(Number(item.vote_average)*10)/10:null,description:String(item.overview||"").slice(0,5000),poster_url:image(item.poster_path,"w500"),backdrop_url:image(item.backdrop_path,"w1280"),trailer_url:null,watch_url:primary?.web_url||null,video_url:null,download_url:null,download_links:[],cast_members:"",runtime_minutes:null,content_status:item.status||"Released",seasons:item.number_of_seasons||null,episodes:item.number_of_episodes||null,tags:"Country: "+country+", Audio: Hindi dubbing unverified"+sourceTag,published:false,watch_sources:sources,provider_region:primary?.region||null,audio_status:"unverified"};
   }catch{return null;}
  });
  const results=dramas.filter(Boolean);
  return json({country,regions:sourceRegions,category,pages,count:results.length,checked:unique.length,with_watch_link:results.filter(x=>x.watch_url).length,without_watch_link:results.filter(x=>!x.watch_url).length,dramas:results});
 }catch(e){return json({error:e?.name==="TimeoutError"?"TMDB took too long to respond. Try fewer pages.":e?.message||"Could not load dramas."},400);}
}

const TMDB_API="https://api.themoviedb.org/3";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=900, s-maxage=900"}});
function languageName(code){const names={bn:"Bangla",zh:"Chinese",en:"English",fr:"French",de:"German",hi:"Hindi",id:"Indonesian",ja:"Japanese",ko:"Korean",ml:"Malayalam",mr:"Marathi",pt:"Portuguese",ru:"Russian",es:"Spanish",ta:"Tamil",te:"Telugu"};return names[code]||String(code||"").toUpperCase()}
function imageUrl(path,size){return typeof path==="string"&&/^\/[\w.-]+\.(?:jpg|jpeg|png|webp)$/i.test(path)?"https://image.tmdb.org/t/p/"+size+path:null}
export async function onRequestGet({request,env}){
 const url=new URL(request.url),allowed=new Set(["popular","now_playing","upcoming","top_rated"]),category=url.searchParams.get("category")||"popular",page=Number(url.searchParams.get("page")||1);
 if(!allowed.has(category))return json({error:"Unsupported movie category."},400);
 if(!Number.isInteger(page)||page<1||page>500)return json({error:"Invalid page."},400);
 const token=env.TMDB_API_READ_ACCESS_TOKEN;if(!token)return json({error:"TMDB is not configured. Add TMDB_API_READ_ACCESS_TOKEN in Cloudflare Pages → Settings → Variables and Secrets."},503);
 try{
  const headers={Authorization:"Bearer "+token,accept:"application/json"};
  const [response,genreResponse]=await Promise.all([fetch(TMDB_API+"/"+category+"?include_adult=false&language=en-US&page="+page,{headers,signal:AbortSignal.timeout(10000)}),fetch(TMDB_API+"/genre/movie/list?language=en-US",{headers,signal:AbortSignal.timeout(10000)})]);
  if(!response.ok)return json({error:"TMDB could not load the movie list (HTTP "+response.status+")."},502);
  if(!genreResponse.ok)return json({error:"TMDB genres could not be loaded."},502);
  const [body,genreBody]=await Promise.all([response.json(),genreResponse.json()]),genres=new Map((genreBody.genres||[]).map(g=>[g.id,g.name]));
  const movies=(body.results||[]).filter(m=>m&&m.adult!==true&&m.title).map(m=>({id:"tmdb-"+m.id,tmdb_id:Number(m.id),source:"tmdb",title:String(m.title).slice(0,180),media_type:"movie",release_year:(String(m.release_date||"").match(/^(\d{4})/)||[])[1]?Number(String(m.release_date).slice(0,4)):null,genre:(m.genre_ids||[]).map(id=>genres.get(id)).filter(Boolean).join(", "),language:languageName(m.original_language),quality:"HD",rating:Number.isFinite(Number(m.vote_average))?Math.round(Number(m.vote_average)*10)/10:null,description:String(m.overview||"").slice(0,3000),poster_url:imageUrl(m.poster_path,"w500"),backdrop_url:imageUrl(m.backdrop_path,"w1280"),created_at:m.release_date||""}));
  return json({category,page,total_pages:Math.min(Number(body.total_pages||1),500),total_results:Number(body.total_results||0),count:movies.length,movies});
 }catch(e){return json({error:e?.name==="TimeoutError"?"TMDB took too long to respond. Please try again.":"Could not load the TMDB movie list."},502)}
}
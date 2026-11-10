const API="https://api.themoviedb.org/3";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=1800"}});
const img=(p,size)=>p&&p.startsWith("/")?"https://image.tmdb.org/t/p/"+size+p:null;
export async function onRequestGet({request,env}){
 const id=new URL(request.url).searchParams.get("id");
 if(!id||!/^[0-9]{1,12}$/.test(id))return json({error:"Invalid movie ID"},400);
 const token=env.TMDB_API_READ_ACCESS_TOKEN;if(!token)return json({error:"TMDB is not configured"},503);
 const headers={Authorization:"Bearer "+token,accept:"application/json"};
 try{
  const paths=["/movie/"+id+"?language=en-US","/movie/"+id+"/images","/movie/"+id+"/credits?language=en-US","/movie/"+id+"/videos?language=en-US"];
  const rs=await Promise.all(paths.map(p=>fetch(API+p,{headers})));
  if(!rs[0].ok)return json({error:"Movie details unavailable"},rs[0].status===404?404:502);
  const d=await Promise.all(rs.map((r,i)=>i===0||r.ok?r.json():Promise.resolve({})));
  const m=d[0],v=(d[3].results||[]).find(x=>x.site==="YouTube"&&x.type==="Trailer");
  return json({id:Number(m.id),title:m.title||"",overview:m.overview||"",year:(m.release_date||"").slice(0,4),rating:m.vote_average,runtime:m.runtime,genres:(m.genres||[]).map(x=>x.name),poster:img(m.poster_path,"w500"),backdrop:img(m.backdrop_path,"w1280"),screenshots:(d[1].backdrops||[]).slice(0,12).map(x=>img(x.file_path,"w1280")),cast:(d[2].cast||[]).slice(0,12).map(x=>({name:x.name,role:x.character,photo:img(x.profile_path,"w185")})),trailer:v?"https://www.youtube.com/embed/"+v.key:null,providers:"https://www.themoviedb.org/movie/"+id+"/watch"});
 }catch{return json({error:"Could not load movie details"},502)}
}
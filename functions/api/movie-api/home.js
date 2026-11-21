import {upstream,rootData,normalizeHome,response} from "../../_shared/moviebox.js";
export async function onRequestGet(){
 try{
  const [home,trend]=await Promise.all([
   upstream("/wefeed-h5api-bff/home?host=movie-box.co"),
   upstream("/wefeed-h5api-bff/subject/trending?page=1&perPage=28").catch(()=>null)
  ]);
  return response(normalizeHome(home,trend),200,"public, max-age=60, s-maxage=120, stale-while-revalidate=300");
 }catch(e){return response({ok:false,error:e.message||"MovieBox home feed unavailable."},502);}
}
import {upstream,rootData,response} from "../../_shared/moviebox.js";
export async function onRequestGet(){
 try{const raw=await upstream("/wefeed-h5api-bff/filter"),d=rootData(raw)||{};
  return response({ok:true,genres:d.genres||d.genreList||[],countries:d.countries||d.countryList||[],years:d.years||d.yearList||[],channelList:d.channelList||[],languages:d.languages||d.languageList||[],types:["Movie","Series","Anime","Short Drama"]},200,"public, max-age=600, s-maxage=900");
 }catch(e){return response({ok:false,error:e.message||"Filter options unavailable."},502);}
}
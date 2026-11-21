import {upstream,rootData,response} from "../../_shared/moviebox.js";
export async function onRequestGet(){try{const [matches,leagues]=await Promise.all([
 upstream("/wefeed-h5api-bff/live/match-list-v5",{host:"https://h5-sport-api.aoneroom.com"}),
 upstream("/wefeed-h5api-bff/live/league-tab",{host:"https://h5-sport-api.aoneroom.com"}).catch(()=>null)
 ]);return response({ok:true,matches:rootData(matches),leagues:rootData(leagues),sports:rootData(matches)},200,"public, max-age=30, s-maxage=45");}
 catch(e){return response({ok:false,error:e.message||"Live Sports feed unavailable."},502);}}
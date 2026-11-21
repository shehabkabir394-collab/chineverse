import {response} from "../../_shared/moviebox.js";
// Playback is intentionally not proxied until the content provider's distribution rights
// and permission to redistribute its streams are confirmed.
export async function onRequestGet(){
 return response({ok:false,error:"Playback is disabled until the MovieBox content and stream redistribution rights are confirmed. Use authorized watch sources in the meantime."},403);
}
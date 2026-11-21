import {response} from "../../_shared/moviebox.js";
// The public MovieBox catalog API does not expose a personal trial/account endpoint.
// Return a safe informational response rather than calling the retired proxy service.
export async function onRequestGet(){
 return response({ok:true,me:{name:"MovieBox Public Catalog API",status:"Connected",plan:"Public catalog feed",note:"The upstream provider does not expose personal quota or account details."}},200,"no-store");
}
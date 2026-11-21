import {response} from "../../_shared/moviebox.js";
// Downloading third-party movie files requires explicit distribution authorization.
export async function onRequestGet(){
 return response({ok:false,error:"Downloads are disabled until the content and file redistribution rights are confirmed."},403);
}
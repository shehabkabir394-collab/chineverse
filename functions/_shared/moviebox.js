// CineVerse MovieBox upstream adapter.
// All upstream requests stay server-side; no provider credentials are exposed to browsers.
const MAIN = "https://h5-api.aoneroom.com";
const SPORT = "https://h5-sport-api.aoneroom.com";
const REFERER = "https://moviebox.ph/";
const PROVIDER_HOST = "moviebox.ph";
let guestToken = "";
let guestTokenAt = 0;
let tokenPromise = null;
const jsonHeaders = { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" };

function md5(input) {
  const bytes = Array.from(String(input), c => c.charCodeAt(0) & 255);
  const words = [];
  for (let i = 0; i < bytes.length; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
  words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | (0x80 << ((bytes.length % 4) * 8));
  const bitLength = bytes.length * 8, block = ((bytes.length + 8) >> 6) + 1;
  words[block * 16 - 2] = bitLength;
  words[block * 16 - 1] = Math.floor(bitLength / 0x100000000);
  let a0=0x67452301|0,b0=0xefcdab89|0,c0=0x98badcfe|0,d0=0x10325476|0;
  const shifts=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296)|0);
  const rot=(x,n)=>(x<<n)|(x>>>(32-n));
  for(let offset=0;offset<block*16;offset+=16){
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++){
      let f,g;
      if(i<16){f=(b&c)|(~b&d);g=i;}
      else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}
      else if(i<48){f=b^c^d;g=(3*i+5)%16;}
      else{f=c^(b|~d);g=(7*i)%16;}
      const x=(a+f+K[i]+(words[offset+g]||0))|0;
      const next=(b+rot(x,shifts[i]))|0;
      a=d;d=c;c=b;b=next;
    }
    a0=(a0+a)|0;b0=(b0+b)|0;c0=(c0+c)|0;d0=(d0+d)|0;
  }
  return [a0,b0,c0,d0].map(n=>Array.from({length:4},(_,i)=>((n>>>(i*8))&255).toString(16).padStart(2,"0")).join("")).join("");
}
function clientToken() {
  const ts = Math.floor(Date.now()/1000);
  return ts + "," + md5(String(ts).split("").reverse().join(""));
}
export function response(data,status=200,cache="no-store"){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":cache,"X-Content-Type-Options":"nosniff"}});
}
function headers(extra={}) {
  return {...jsonHeaders,"Origin":"https://moviebox01.com","Referer":REFERER,"X-Client-Info":JSON.stringify({timezone:"Asia/Dhaka"}),"X-Request-Lang":"en","X-Client-Token":clientToken(),...extra};
}
export async function upstream(path,{method="GET",body,host=MAIN,referer=REFERER,timeout=18000}={}) {
  const url=host+path;
  const h=headers({"Referer":referer});
  const init={method,headers:h,signal:AbortSignal.timeout(timeout)};
  if(body!==undefined)init.body=JSON.stringify(body);
  const res=await fetch(url,init);
  const raw=await res.text();
  let data;try{data=JSON.parse(raw);}catch{throw new Error("MovieBox API returned non-JSON (HTTP "+res.status+").");}
  if(!res.ok)throw new Error("MovieBox API HTTP "+res.status+": "+String(data?.message||data?.error||"upstream request failed").slice(0,180));
  if(data?.success===false||data?.code&&Number(data.code)>=400)throw new Error(String(data.message||data.error||"MovieBox API rejected the request").slice(0,180));
  return data;
}
export const rootData=d=>d?.data??d?.result??d;
export function pickArray(obj,keys){
  for(const key of keys){const value=obj?.[key];if(Array.isArray(value))return value;}
  return [];
}
function slugOf(x){
  return String(x?.detailPath||x?.detail_path||x?.path||x?.slug||x?.urlPath||x?.url_path||"").replace(/^\/+|\/+$/g,"");
}
export function normalizeItem(item){
  if(!item||typeof item!=="object")return item;
  const id=item.subjectId??item.subject_id??item.contentId??item.content_id??item.id??item._id??"";
  const detailPath=slugOf(item);
  const poster=item.poster||item.cover||item.coverUrl||item.cover_url||item.image||item.imageUrl||item.image_url||item.thumbnail||item.posterUrl||item.poster_url||item.verticalCover||item.vertical_cover||item.horizontalCover||item.horizontal_cover||"";
  const path=detailPath?"/mb/"+detailPath+(id?"~"+String(id):""):"";
  const langs=pickArray(item,["dubs","dubList","audioList","languages","audioLanguages"]);
  const language=item.language||item.originalLanguage||item.original_language||item.lang||"";
  return {...item,id:String(id||""),subjectId:String(id||""),detailPath,poster,previewImage:item.previewImage||poster,path,language,
    audioLanguages:item.audioLanguages||item.audio_languages||langs,
    title:item.title||item.name||item.subjectName||item.subject_name||"Untitled",
    year:item.year||item.releaseYear||item.release_year||"",
    quality:item.quality||item.resolution||"HD"};
}
export function itemsFrom(data){
  const root=rootData(data);
  const direct=pickArray(root,["items","subjectList","subjects","list","results","records","contentList","videoList"]);
  if(direct.length)return direct.map(normalizeItem);
  return [];
}
export function cleanResponse(data){
  const d=rootData(data);
  if(!d||typeof d!=="object")return {};
  const out={...d};delete out.trial;delete out.apiKey;delete out.token;
  return out;
}
export function normalizeHome(data,trendingData){
  const d=rootData(data)||{};
  const operating=pickArray(d,["operatingList","operating_list","sections","list"]);
  const sections=operating.map((s,i)=>{
    const arr=pickArray(s,["subjects","items","subjectList","subject_list","list","contentList","contents"]);
    return {title:s.title||s.name||s.label||s.moduleName||s.module_name||("Collection "+(i+1)),
      badge:s.subtitle||s.description||s.badge||"",categoryPath:s.detailPath||s.path||s.categoryPath||"",
      items:arr.map(normalizeItem)};
  }).filter(s=>s.items.length);
  const trendRoot=rootData(trendingData)||{};
  const trending=pickArray(trendRoot,["subjectList","items","subjects","list"]).map(normalizeItem);
  const banners=pickArray(d,["bannerList","banners","banner","bannerSubjects"]).map(normalizeItem);
  const platformList=pickArray(d,["platformList","platform_list"]);
  const categories=operating.map((s,i)=>({label:s.title||s.name||s.label||("Category "+(i+1)),name:s.title||s.name||s.label||("Category "+(i+1)),path:s.detailPath||s.path||s.categoryPath||"/type/movies"}));
  const filterCats=pickArray(d,["channelList","channels"]);
  filterCats.forEach(c=>categories.push({label:c.name||c.title||c.label||"Category",name:c.name||c.title||c.label||"Category",path:"mb-channel:"+String(c.channelId??c.id??"1"),channelId:c.channelId??c.id}));
  return {ok:true,categories,sections,trending,banners,platformList,upcoming:pickArray(d,["upcomingList","upcoming","upcomingSubjects"]).map(normalizeItem),
    collections:sections.filter(s=>/collection/i.test(s.title)),allOfficialSections:sections};
}
export function parseEncodedPath(value){
  const raw=String(value||"").trim();
  if(!raw.startsWith("/mb/"))return {detailPath:"",subjectId:""};
  const token=raw.slice(4),cut=token.lastIndexOf("~");
  if(cut>0)return {detailPath:token.slice(0,cut),subjectId:token.slice(cut+1)};
  return {detailPath:token,subjectId:""};
}
export function normalizeDetail(data,ids){
  const root=rootData(data)||{};
  const subject=root.subject||root.detail||root;
  const resource=root.resource||subject.resource||{};
  const seasons=pickArray(resource,["seasons"]).length?pickArray(resource,["seasons"]):pickArray(subject,["seasons"]);
  const episodes=[];
  seasons.forEach((season,si)=>{
    const eps=pickArray(season,["episodes","episodeList","episode_list","items","resources"]);
    eps.forEach((ep,ei)=>episodes.push({...ep,seasonNumber:Number(ep.seasonNumber??ep.se??season.seasonNumber??season.season??si)||0,
      number:Number(ep.episodeNumber??ep.episode??ep.ep??ei+1)||ei+1,
      title:ep.title||ep.name||ep.episodeName||("Episode "+(ei+1))}));
  });
  const stars=pickArray(root,["stars","staff","casts"]).length?pickArray(root,["stars","staff","casts"]):pickArray(subject,["stars","staff","casts"]);
  const dubs=pickArray(root,["dubs","dubList","audioLanguages"]).length?pickArray(root,["dubs","dubList","audioLanguages"]):pickArray(subject,["dubs","dubList","audioLanguages"]);
  const id=String(subject.subjectId??subject.subject_id??ids.subjectId??"");
  const path=ids.detailPath||slugOf(subject);
  return {ok:true,detail:{...subject,subjectId:id,id,path:"/mb/"+path+(id?"~"+id:""),detailPath:path,episodes,seasons,stars,dubs,
    title:subject.title||subject.name||"Untitled",poster:subject.poster||subject.cover||subject.coverUrl||subject.cover_url||subject.image||""}};
}
export function normalizedItemsResponse(data){
  const root=rootData(data)||{};
  return {ok:true,items:itemsFrom(root),pager:root.pager||root.page||root.pagination||null,...cleanResponse(root)};
}

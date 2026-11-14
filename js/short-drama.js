(()=>{
const $=s=>document.querySelector(s);
const platforms=[
["ShortMax","shortmax","api/v1/popular?lang={lang}&page=1"],["BlinkDrama","blinkdrama","api/v1/popular?lang={lang}&page=1"],["VibeShort","vibeshort","api/v1/popular?lang={lang}&page=1"],["StoryReel","storyreel","api/v1/popular?lang={lang}&page=1"],["DramaRush","dramarush","api/v1/popular?lang={lang}&page=1"],
["DramaWave","dramawave","api/home?lang=in"],["DramaBox","dramabox","api/dramabox/latest?lang=en"],["NetShort","netshort","api/home/1?lang=in"],["FlexTV","flextv","api/drama/popular?page=1&lang={lang}"],["FlickReels","flickreels","api/home?lang=6&page=1"],["ReelShort","reelshort","trending?lang=en"],["StardustTV","stardusttv","video/hot-list?lang=id_ID"],["DramaBite","dramabite","home?lang=id"],["StarShort","starshort","api/starshort/content/trending?locale=id"],["MicroDrama","microdrama","api/microdrama/list?lang=id&page=1&limit=20"],["Melolo","melolo","api/home?lang=id&offset=0"],["ShortWave","shortwave","api/all?page=1&size=24&lang=in"],["CubeTV","cubetv","api/home?lang=en&page=1"],["PineDrama","pinedrama","home?scene=1&count=15&page=1"],["RaptDrama","raptdrama","api/public/browse?page=1&limit=20"],["GoodShort","goodshort","home?lang=in&channel=-1&page=1&size=20"],["JoyReels","joyreels","dramas/browse?page=1&per_page=10&lang=id"],["Vigloo","vigloo","api/browse/programs?sortType=POPULAR&limit=30&lang=id"]
];
const $platform=$("#platform"),grid=$("#shortGrid"),status=$("#shortStatus"),dialog=$("#shortDialog");
let active=platforms[0],page=1,lastItems=[],loading=false,searchMode=false;
$platform.innerHTML=platforms.map(p=>'<option value="'+p[1]+'">'+p[0]+'</option>').join("");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function findArray(o,depth=0){if(depth>5||!o||typeof o!=="object")return[];if(Array.isArray(o)){if(o.some(x=>x&&typeof x==="object"))return o;return[]}for(const k of ["data","list","items","dramas","books","videos","results","records","content","feeds","recommendList","bookList"]){if(o[k]){const a=findArray(o[k],depth+1);if(a.length)return a}}for(const v of Object.values(o)){if(v&&typeof v==="object"){const a=findArray(v,depth+1);if(a.length)return a}}return[]}
function pick(o,keys){for(const k of keys){if(o?.[k]!=null&&typeof o[k]!=="object")return o[k]}return""}
function normalize(o){return{raw:o,id:pick(o,["id","bookId","book_id","dramaId","drama_id","vid","videoId","seriesId","programId","contentId"]),title:pick(o,["title","name","bookName","book_name","dramaName","videoName","seriesName","showName","contentName"])||"Untitled drama",poster:pick(o,["cover","coverUrl","cover_url","poster","posterUrl","thumb","thumbnail","image","verticalCover","bookCover"]),desc:pick(o,["description","intro","summary","desc"]),episodes:pick(o,["episodeCount","episodes","totalEpisodes","chapterCount","total_episode"]),lang:pick(o,["language","lang","audioLanguage"])}}
async function api(path){const r=await fetch("/api/apishort/"+active[1]+"/"+path);let d;try{d=await r.json()}catch{throw Error("APIShort returned an invalid response.")}if(!r.ok)throw Error(d.error||"API request failed ("+r.status+")");return d}
function route(){let p=active[2].replaceAll("{lang}",encodeURIComponent($("#apiLang").value));if(searchMode){const q=$("#query").value.trim();if(!q)return p;const map={shortmax:"api/v1/search?lang={lang}&q={q}",blinkdrama:"api/v1/search?lang={lang}&q={q}",vibeshort:"api/v1/search?lang={lang}&q={q}",storyreel:"api/v1/search?lang={lang}&q={q}",dramarush:"api/v1/search?lang={lang}&q={q}",dramabox:"api/dramabox/search?query={q}&lang=en",netshort:"api/search?lang=in&q={q}&page=1",flextv:"api/drama/search?keyword={q}&page=1&lang=id",flickreels:"search?q={q}&lang=6",reelshort:"search?q={q}&lang=en",stardusttv:"video/search?keyword={q}&lang=id_ID",dramabite:"search?q={q}&lang=id",starshort:"api/starshort/search?keyword={q}&locale=id",microdrama:"api/microdrama/search?q={q}&lang=id",melolo:"api/search?lang=id&q={q}",shortwave:"api/search?q={q}&lang=in",cubetv:"api/search?lang=en&q={q}&page=1",pinedrama:"search?q={q}&count=15&page=1&lang=en",raptdrama:"api/public/search?q={q}&page=1",goodshort:"search?lang=in&q={q}&page=1&size=15",joyreels:"search?q={q}&lang=en&page=1",vigloo:"api/search?keyword={q}&lang=id&limit=20"};p=(map[active[1]]||active[2]).replaceAll("{q}",encodeURIComponent(q)).replaceAll("{lang}",encodeURIComponent($("#apiLang").value))}return p}
function render(items){lastItems=items.map(normalize).filter(x=>x.title);grid.innerHTML=lastItems.map((m,i)=>'<article class="short-card" data-index="'+i+'"><div class="short-poster">'+(m.poster?'<img loading="lazy" src="'+esc(m.poster)+'" alt="'+esc(m.title)+'">':'<span>OD</span>')+'</div><h3>'+esc(m.title)+'</h3><p>'+esc(m.episodes?m.episodes+" episodes":"Short drama")+(m.lang?" · "+esc(m.lang):"")+'</p></article>').join("");grid.querySelectorAll(".short-card").forEach(c=>c.onclick=()=>showDetail(Number(c.dataset.index)));$("#moreBtn").hidden=true}
async function load(){if(loading)return;loading=true;status.textContent="Loading "+active[0]+"…";grid.innerHTML="";try{const data=await api(route());const items=findArray(data);if(!items.length){status.textContent="No drama list found in this response. Check this platform's API format.";grid.innerHTML='<pre class="short-error">'+esc(JSON.stringify(data,null,2).slice(0,4500))+'</pre>'}else{render(items);status.textContent=active[0]+" · "+items.length+" results"+(searchMode?" · Search":" · Popular / Browse")}}catch(e){status.innerHTML='<span class="short-error">'+esc(e.message)+'</span>'}finally{loading=false}}
async function showDetail(i){
 const m=lastItems[i];if(!m)return;
 const body=$("#shortDialogBody");
 body.innerHTML='<div class="short-detail"><span class="short-badge">'+esc(active[0])+'</span><h2>'+esc(m.title)+'</h2><p>'+esc(m.desc||"")+'</p><p>Drama ID: '+esc(m.id||"Not detected")+'</p><p>Loading episodes…</p></div>';
 dialog.showModal();
 if(active[1]!=="melolo"){body.querySelector(".short-detail").lastElementChild.textContent="Episode list is not yet mapped for this platform.";return}
 if(!m.id){body.querySelector(".short-detail").lastElementChild.textContent="Drama ID was not detected in the catalog response.";return}
 try{
  const lang=$("#apiLang").value||"id";
  const detail=await api("api/detail/"+encodeURIComponent(m.id)+"?lang="+encodeURIComponent(lang));
  const root=detail?.data||detail?.result||detail?.book||detail;
  const episodeKeys=["episodes","episode_list","episodeList","video_list","videoList","chapters","chapterList","videos","episode"];
  let episodes=[];
  const scan=(o,d=0)=>{if(!o||typeof o!=="object"||d>5||episodes.length)return;if(Array.isArray(o)){if(o.length&&o.some(x=>x&&typeof x==="object"&&(x.vid||x.video_id||x.videoId||x.episode_id||x.chapter_id||x.id)))episodes=o;else o.forEach(x=>scan(x,d+1));return}for(const k of episodeKeys){if(Array.isArray(o[k])&&o[k].length){episodes=o[k];return}}for(const v of Object.values(o))scan(v,d+1)};
  scan(root);
  const title=pick(root,["title","name","bookName","book_name"])||m.title;
  const head='<span class="short-badge">Melolo</span><h2>'+esc(title)+'</h2><p>'+esc(pick(root,["description","intro","summary","desc"])||m.desc||"")+'</p><p>Drama ID: '+esc(m.id)+'</p>';
  if(!episodes.length){body.innerHTML='<div class="short-detail">'+head+'<p class="short-error">Detail response পাওয়া গেছে, কিন্তু episode list শনাক্ত করা যায়নি। API response format যাচাই করতে হবে।</p></div>';return}
  body.innerHTML='<div class="short-detail">'+head+'<h3>Episodes ('+episodes.length+')</h3><div class="melolo-episodes">'+episodes.map((ep,n)=>{const no=pick(ep,["episode","episode_no","episodeNo","ep","index","number","chapter","chapterNo"])||n+1;const vid=pick(ep,["vid","video_id","videoId","episode_id","episodeId","chapter_id","chapterId","id"]);return '<button class="melolo-episode" data-vid="'+esc(vid)+'" data-ep="'+esc(no)+'">Episode '+esc(no)+(pick(ep,["title","name"])?" · "+esc(pick(ep,["title","name"])):"")+'</button>'}).join("")+'</div><div id="meloloPlaybackStatus" aria-live="polite"></div></div>';
  body.querySelectorAll(".melolo-episode").forEach(btn=>btn.addEventListener("click",()=>loadMeloloEpisode(btn.dataset.vid,btn.dataset.ep,m.id)));
 }catch(e){body.innerHTML='<div class="short-detail"><span class="short-badge">Melolo</span><h2>'+esc(m.title)+'</h2><p class="short-error">Episode load failed: '+esc(e.message)+'</p></div>'}
}
async function loadMeloloEpisode(videoId,episodeNo,dramaId){
 const box=$("#meloloPlaybackStatus");if(!box)return;
 if(!videoId){box.textContent="এই episode-এর video ID পাওয়া যায়নি।";return}
 box.textContent="Checking episode source…";
 try{
  const data=await api("api/video?id="+encodeURIComponent(videoId)+"&ep="+encodeURIComponent(episodeNo));
  const root=data?.data||data?.result||data;
  const verified=data?.rights_verified===true||root?.rights_verified===true;
  const streams=root?.streams||root?.stream||root?.videos||[];
  const stream=Array.isArray(streams)?streams.find(x=>x&&x.url):((streams&&streams.url)?streams:null);
  const url=stream?.url||pick(root,["play_url","playUrl","video_url","videoUrl","url"]);
  if(!verified||!url){box.innerHTML='<p class="short-error">Episode source পাওয়া গেছে কি না তা যাচাই করা যায়নি, অথবা streaming/embedding rights নিশ্চিত নয়। তাই এখানে ভিডিও চালানো হচ্ছে না।</p>';return}
  box.innerHTML='<video id="meloloPlayer" controls playsinline preload="metadata" style="width:100%;max-height:65vh;background:#000;border-radius:12px"></video>';
  const player=$("#meloloPlayer");
  if(/\.m3u8($|\?)/i.test(url)){
   if(player.canPlayType("application/vnd.apple.mpegurl"))player.src=url;
   else{
    if(!window.Hls){await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js";s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})}
    if(window.Hls&&Hls.isSupported()){const hls=new Hls();hls.loadSource(url);hls.attachMedia(player)}else{box.textContent="এই ব্রাউজারে HLS playback support নেই।"}
   }
  }else player.src=url;
 }catch(e){box.textContent="Episode source load failed: "+e.message}
}
$("#dialogClose").onclick=()=>dialog.close();
$platform.onchange=()=>{active=platforms.find(p=>p[1]===$platform.value)||platforms[0];searchMode=false;$("#query").value="";load()};
$("#searchBtn").onclick=()=>{searchMode=!!$("#query").value.trim();load()};
$("#query").addEventListener("keydown",e=>{if(e.key==="Enter"){$("#searchBtn").click()}});
load();
})();
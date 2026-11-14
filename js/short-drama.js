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
 dialog.showModal();
 body.innerHTML='<div class="short-detail"><span class="short-badge">'+esc(active[0])+'</span><h2>'+esc(m.title)+'</h2><p>'+esc(m.desc||"")+'</p><p>Drama ID: '+esc(m.id||"Not detected")+'</p><p>Loading episode information…</p></div>';
 if(active[1]!=="melolo"){
  body.innerHTML='<div class="short-detail"><span class="short-badge">'+esc(active[0])+'</span><h2>'+esc(m.title)+'</h2><p>'+esc(m.desc||"")+'</p><p>Drama ID: '+esc(m.id||"Not detected")+'</p><p>এই প্ল্যাটফর্মের episode-detail endpoint এখনো যাচাই করা হয়নি।</p></div>';
  return;
 }
 if(!m.id){body.querySelector(".short-detail").insertAdjacentHTML("beforeend","<p>Drama ID পাওয়া যায়নি।</p>");return}
 try{
  const payload=await api("api/detail/"+encodeURIComponent(m.id)+"?lang="+encodeURIComponent($("#apiLang").value||"id"));
  const d=payload?.data||payload?.result||payload;
  const videos=Array.isArray(d?.videos)?d.videos:(Array.isArray(d?.data?.videos)?d.data.videos:[]);
  const title=d?.title||d?.bookName||m.title;
  const total=d?.episodes||d?.totalEpisodes||videos.length;
  body.innerHTML='<div class="short-detail"><span class="short-badge">MELOLO · '+esc(total||videos.length)+' EPISODES</span><h2>'+esc(title)+'</h2><p>'+esc(d?.description||d?.intro||m.desc||"")+'</p><div class="short-player-shell"><div class="short-player-screen"><span>▶</span><strong>ভিডিও প্লেয়ার</strong><small>অনুমোদিত playback source যুক্ত হলে এখানে চলবে</small></div><p class="short-playback-note">Episode তালিকা দেখা যাবে। Melolo-এর ভিডিও সরাসরি এমবেড করার অনুমতি নিশ্চিত না হওয়ায় এখানে API-এর signed video URL চালু করা হয়নি।</p></div><h3>Episodes</h3><div class="short-episodes">'+(videos.length?videos.map((ep,n)=>'<button type="button" class="short-episode" data-ep="'+esc(ep.episode||n+1)+'"><span>Episode '+esc(ep.episode||n+1)+'</span><small>'+(ep.duration?esc(Math.floor(Number(ep.duration)/60))+' min':'')+'</small></button>').join(""):'<p>কোনো Episode পাওয়া যায়নি।</p>')+'</div></div>';
  body.querySelectorAll(".short-episode").forEach(btn=>btn.addEventListener("click",()=>{
   const selected=btn.dataset.ep;
   body.querySelectorAll(".short-episode").forEach(x=>x.classList.toggle("active",x===btn));
   const note=body.querySelector(".short-playback-note");
   if(note)note.textContent="Episode "+selected+" নির্বাচন করা হয়েছে। ভিডিও চালাতে কনটেন্ট মালিকের অনুমোদিত embed/playback source প্রয়োজন।";
  }));
 }catch(e){
  body.innerHTML='<div class="short-detail"><h2>'+esc(m.title)+'</h2><p class="short-error">Episode তথ্য লোড হয়নি: '+esc(e.message)+'</p></div>';
 }
}
$("#dialogClose").onclick=()=>dialog.close();
$platform.onchange=()=>{active=platforms.find(p=>p[1]===$platform.value)||platforms[0];searchMode=false;$("#query").value="";load()};
$("#searchBtn").onclick=()=>{searchMode=!!$("#query").value.trim();load()};
$("#query").addEventListener("keydown",e=>{if(e.key==="Enter"){$("#searchBtn").click()}});
load();
})();
(()=> {
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function mount({video,sources=[],storageKey="cv-player",subtitles=[]}){
  if(!video||!sources.length)return;
  const wrap=document.createElement("div");wrap.className="cv-player";video.parentNode.insertBefore(wrap,video);wrap.appendChild(video);video.controls=false;video.playsInline=true;
  const ordered=[...sources].filter(x=>x&&x.url).sort((a,b)=>Number(a.quality.replace(/p/i,""))-Number(b.quality.replace(/p/i,"")));
  const best=()=>{const c=navigator.connection||{};const q=(c.effectiveType==="2g"||c.effectiveType==="slow-2g"||Number(c.downlink)<1.5)?"420p":(c.effectiveType==="3g"||Number(c.downlink)<4)?"720p":"1080p";return ordered.find(x=>x.quality===q)||ordered[ordered.length-1]};
  const initial=best(),saved=Number(localStorage.getItem(storageKey)||0);
  const controls=document.createElement("div");controls.className="cv-controls";
  const qualityOptions=['<option value="auto">Auto</option>',...ordered.map(x=>'<option value="'+esc(x.quality)+'">'+esc(x.quality)+'</option>')].join("");
  controls.innerHTML='<div class="cv-progress"><input class="cv-seek" type="range" min="0" max="1000" value="0" aria-label="Seek"></div><div class="cv-control-row"><button type="button" class="cv-play" aria-label="Play">▶</button><button type="button" class="cv-back" aria-label="Back 10 seconds">↶10</button><button type="button" class="cv-forward" aria-label="Forward 10 seconds">10↷</button><span class="cv-time">0:00 / 0:00</span><input class="cv-volume" type="range" min="0" max="1" step=".05" value="1" aria-label="Volume"><select class="cv-quality" aria-label="Quality">'+qualityOptions+'</select><select class="cv-speed" aria-label="Playback speed"><option>0.25</option><option>0.5</option><option>0.75</option><option selected>1</option><option>1.25</option><option>1.5</option><option>1.75</option><option>2</option></select><select class="cv-subtitles" aria-label="Subtitles"><option value="-1">Subtitles Off</option></select><button type="button" class="cv-pip" title="Picture in Picture">▣</button><button type="button" class="cv-full" title="Fullscreen">⛶</button></div><div class="cv-buffer" hidden>Buffering…</div>';
  wrap.appendChild(controls);
  const $=s=>controls.querySelector(s),play=$(".cv-play"),seek=$(".cv-seek"),time=$(".cv-time"),quality=$(".cv-quality"),subs=$(".cv-subtitles");
  const fmt=t=>{if(!Number.isFinite(t))return"0:00";const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60);return h?h+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"):m+":"+String(s).padStart(2,"0")};
  function setSource(src,keep=true){const t=keep?video.currentTime:0,was=!video.paused;video.src=src.url;video.load();video.addEventListener("loadedmetadata",()=>{if(t>0)video.currentTime=Math.min(t,Math.max(0,video.duration-2));if(was)video.play().catch(()=>{});},{once:true});quality.value=src.quality;}
  setSource(initial,false);quality.value="auto";
  quality.addEventListener("change",()=>{const src=quality.value==="auto"?best():ordered.find(x=>x.quality===quality.value);if(src)setSource(src)});
  play.addEventListener("click",()=>video.paused?video.play().catch(()=>{}):video.pause());
  video.addEventListener("play",()=>play.textContent="Ⅱ");video.addEventListener("pause",()=>play.textContent="▶");
  $(".cv-back").addEventListener("click",()=>video.currentTime=Math.max(0,video.currentTime-10));
  $(".cv-forward").addEventListener("click",()=>video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10));
  video.addEventListener("timeupdate",()=>{if(video.duration){seek.value=Math.round(video.currentTime/video.duration*1000);time.textContent=fmt(video.currentTime)+" / "+fmt(video.duration);}});
  seek.addEventListener("input",()=>{if(video.duration)video.currentTime=Number(seek.value)/1000*video.duration});
  $(".cv-volume").addEventListener("input",e=>video.volume=Number(e.target.value));
  $(".cv-speed").addEventListener("change",e=>video.playbackRate=Number(e.target.value));
  $(".cv-full").addEventListener("click",()=>{if(document.fullscreenElement)document.exitFullscreen?.();else wrap.requestFullscreen?.()});
  $(".cv-pip").addEventListener("click",async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await video.requestPictureInPicture()}catch{}});
  const trackList=[...video.querySelectorAll("track")];trackList.forEach((t,i)=>{const o=document.createElement("option");o.value=String(i);o.textContent=t.label||t.srclang||"Subtitle "+(i+1);subs.appendChild(o);});
  (subtitles||[]).forEach((t,i)=>{if(!t.url)return;const el=document.createElement("track");el.kind="subtitles";el.label=t.label||t.language||"Subtitle "+(i+1);el.srclang=t.language||"en";el.src=t.url;video.appendChild(el);const o=document.createElement("option");o.value=String(video.querySelectorAll("track").length-1);o.textContent=el.label;subs.appendChild(o);});
  subs.addEventListener("change",()=>{[...video.textTracks].forEach((t,i)=>t.mode=String(i)===subs.value?"showing":"disabled")});
  video.addEventListener("waiting",()=>$(".cv-buffer").hidden=false);video.addEventListener("playing",()=>$(".cv-buffer").hidden=true);video.addEventListener("canplay",()=>$(".cv-buffer").hidden=true);
  video.addEventListener("loadedmetadata",()=>{if(saved>15&&saved<video.duration-20){const resume=document.createElement("button");resume.className="cv-resume";resume.textContent="▶ Resume from "+fmt(saved);wrap.appendChild(resume);resume.addEventListener("click",()=>{video.currentTime=saved;resume.remove();video.play().catch(()=>{})},{once:true});}});
  let saveAt=0;video.addEventListener("timeupdate",()=>{if(video.currentTime-saveAt>8){saveAt=video.currentTime;localStorage.setItem(storageKey,String(Math.floor(saveAt)))}});video.addEventListener("ended",()=>localStorage.removeItem(storageKey));
  wrap.tabIndex=0;wrap.addEventListener("keydown",e=>{if(["INPUT","SELECT","BUTTON"].includes(e.target.tagName))return;if(e.code==="Space"){e.preventDefault();video.paused?video.play():video.pause()}else if(e.key==="ArrowRight")video.currentTime+=10;else if(e.key==="ArrowLeft")video.currentTime-=10;else if(e.key.toLowerCase()==="f")$(".cv-full").click()});
  let tap=0;video.addEventListener("touchend",e=>{const x=e.changedTouches[0].clientX,r=video.getBoundingClientRect();if(Math.abs(x-(r.left+r.width/2))<r.width*.12)return;const now=Date.now();if(now-tap<320){video.currentTime+=x<r.left+r.width/2?-10:10;tap=0}else tap=now},{passive:true});
  return {video,wrap,setSource};
 }
 window.CineVersePlayer={mount};
})();
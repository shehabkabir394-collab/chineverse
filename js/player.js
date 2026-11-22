(()=> {
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function mount({video,sources=[],storageKey="cv-player",subtitles=[],title="Now Playing",backUrl="./"}){
  if(!video||!sources.length)return;
  const wrap=document.createElement("div");wrap.className="cv-player";video.parentNode.insertBefore(wrap,video);wrap.appendChild(video);video.controls=false;video.playsInline=true;video.muted=false;
  const qualityNumber=x=>Number(String(x?.quality||"").match(/\d+/)?.[0]||0);
 let ordered=[...sources].filter(x=>x&&x.url).map(x=>({...x,quality:String(x.quality||"Auto"),mime:String(x.mime||x.type||"")})).sort((a,b)=>qualityNumber(a)-qualityNumber(b));
  const best=()=>{const c=navigator.connection||{};const down=Number(c.downlink)||0;const verySlow=!!c.saveData||/2g|slow-2g/i.test(c.effectiveType||"")||(down>0&&down<1.5);const q=verySlow?"low":((!c.effectiveType&&!down)||(down>=4)||c.effectiveType==="4g"?"1080p":"720p");return (verySlow?ordered[0]:null)||ordered.find(x=>x.quality===q)||ordered.find(x=>x.quality==="720p")||ordered[0]};
  const initial=best(),saved=Number(localStorage.getItem(storageKey)||0),savedVolume=Number(localStorage.getItem("cv-player-volume")||1);
  video.volume=Math.max(0,Math.min(1,savedVolume));
  const topbar=document.createElement("div");topbar.className="cv-topbar";topbar.innerHTML='<a class="cv-back-link" href="'+esc(backUrl)+'" aria-label="Back">‹</a><strong class="cv-title">'+esc(title)+'</strong><div class="cv-top-right"></div>';wrap.appendChild(topbar);
  const controls=document.createElement("div");controls.className="cv-controls";
  const qualityOptions=['<option value="auto">Auto</option>',...ordered.map(x=>'<option value="'+esc(x.quality)+'">'+esc(x.quality)+'</option>')].join("");
  controls.innerHTML='<div class="cv-progress"><input class="cv-seek" type="range" min="0" max="1000" value="0" aria-label="Seek"></div><div class="cv-control-row"><button type="button" class="cv-play" aria-label="Play">▶</button><button type="button" class="cv-back" aria-label="Back 10 seconds">↶10</button><button type="button" class="cv-forward" aria-label="Forward 10 seconds">10↷</button><span class="cv-time">0:00 / 0:00</span><button type="button" class="cv-mute" aria-label="Mute sound" title="Mute / Unmute">🔊</button><input class="cv-volume" type="range" min="0" max="1" step=".05" value="1" aria-label="Volume"><select class="cv-quality" aria-label="Quality">'+qualityOptions+'</select><select class="cv-speed" aria-label="Playback speed"><option>0.25</option><option>0.5</option><option>0.75</option><option selected>1</option><option>1.25</option><option>1.5</option><option>1.75</option><option>2</option></select><select class="cv-subtitles" aria-label="Subtitles"><option value="-1">Subtitles Off</option></select><button type="button" class="cv-pip" title="Picture in Picture">▣</button><button type="button" class="cv-full" title="Fullscreen">⛶</button></div><div class="cv-buffer" hidden>Buffering…</div>';
  wrap.appendChild(controls);
  const topRight=topbar.querySelector(".cv-top-right");
  const lockButton=document.createElement("button");lockButton.type="button";lockButton.className="cv-lock";lockButton.textContent="🔒";lockButton.setAttribute("aria-label","Lock controls");wrap.appendChild(lockButton);
  const settingsButton=document.createElement("button");settingsButton.type="button";settingsButton.className="cv-settings";settingsButton.textContent="⚙";settingsButton.setAttribute("aria-label","Settings");wrap.appendChild(settingsButton);
  const settingsPanel=document.createElement("div");settingsPanel.className="cv-settings-panel";settingsPanel.innerHTML='<span>Playback speed</span>';settingsPanel.appendChild(controls.querySelector(".cv-speed"));wrap.appendChild(settingsPanel);
  settingsButton.addEventListener("click",()=>settingsPanel.classList.toggle("open"));
  let locked=false;lockButton.addEventListener("click",()=>{locked=!locked;wrap.classList.toggle("cv-locked",locked);lockButton.textContent=locked?"🔓":"🔒";lockButton.setAttribute("aria-label",locked?"Unlock controls":"Lock controls");if(!locked)revealControls();});
  const centerPlay=document.createElement("button");centerPlay.type="button";centerPlay.className="cv-center-play";centerPlay.setAttribute("aria-label","Play video");centerPlay.innerHTML="<span>▶</span>";wrap.appendChild(centerPlay);
  const skipHint=document.createElement("div");skipHint.className="cv-skip-hint";skipHint.setAttribute("aria-live","polite");wrap.appendChild(skipHint);
  const skipControls=document.createElement("div");skipControls.className="cv-mid-skip";skipControls.innerHTML='<button type="button" class="cv-mid-back" aria-label="Rewind 10 seconds"><span>↶</span><small>10</small></button><button type="button" class="cv-mid-forward" aria-label="Forward 10 seconds"><span>↷</span><small>10</small></button>';wrap.appendChild(skipControls);
  const $=s=>controls.querySelector(s),play=$(".cv-play"),seek=$(".cv-seek"),time=$(".cv-time"),quality=controls.querySelector(".cv-quality"),subs=controls.querySelector(".cv-subtitles"),volume=$(".cv-volume"),mute=$(".cv-mute");
  volume.value=String(video.volume);
  function syncSound(){const silent=video.muted||video.volume===0;mute.textContent=silent?"🔇":"🔊";mute.setAttribute("aria-label",silent?"Turn sound on":"Mute sound");mute.title=silent?"Turn sound on":"Mute sound";}
  syncSound();
  topRight.append(quality,subs);
  let hideTimer=0;
  function revealControls(){wrap.classList.add("cv-ui-visible");clearTimeout(hideTimer);if(!video.paused&&!video.ended)hideTimer=setTimeout(()=>wrap.classList.remove("cv-ui-visible"),2800);}
  function showSkip(delta){skipHint.textContent=delta<0?"−10 seconds":"＋10 seconds";skipHint.classList.add("show");clearTimeout(showSkip.timer);showSkip.timer=setTimeout(()=>skipHint.classList.remove("show"),650);}
  const fmt=t=>{if(!Number.isFinite(t))return"0:00";const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60);return h?h+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"):m+":"+String(s).padStart(2,"0")};
  let activeHls=null,sourceToken=0,activeSource=null,failedSources=new Set(),retriedUrls=new Set();
  const errorNotice=document.createElement("div");errorNotice.className="cv-player-error";errorNotice.hidden=true;errorNotice.setAttribute("role","status");errorNotice.style.cssText="position:absolute;z-index:16;left:8%;right:8%;top:50%;transform:translateY(-50%);padding:14px 18px;border-radius:12px;background:rgba(12,18,30,.95);border:1px solid rgba(255,255,255,.16);color:#fff;text-align:center;font:600 14px/1.5 system-ui;";wrap.appendChild(errorNotice);
  async function handleMediaError(){
   const failed=activeSource,token=sourceToken;
   if(!failed||!video.getAttribute("src"))return;
   const code=video.error?.code||0,message=video.error?.message||"";
   let probeInfo=null;
   try{
    const pr=await fetch(failed.url,{headers:{Range:"bytes=0-1023"},credentials:"same-origin",cache:"no-store"});
    if(token!==sourceToken)return;
    probeInfo={status:pr.status,contentType:pr.headers.get("content-type")||"",redirected:pr.redirected};
    if((pr.status>=500||pr.status===429)&&!retriedUrls.has(failed.url)){
     retriedUrls.add(failed.url);
     const sep=failed.url.includes("?")?"&":"?";
     const retrySrc={...failed,url:failed.url+sep+"_r="+Date.now()};
     setTimeout(()=>{if(token===sourceToken)setSource(retrySrc,false,true);},600);
     return;
    }
   }catch(e){
    probeInfo={fetchError:e?.message||"network error"};
   }
   if(token!==sourceToken)return;
   failedSources.add(failed.url);
   const remaining=ordered.filter(x=>x&&x.url&&!failedSources.has(x.url));
   const next=remaining.find(x=>x.quality==="720p")||remaining.find(x=>x.quality==="480p")||remaining[remaining.length-1]||remaining[0];
   if(next){console.warn("Video source failed; trying another source",{quality:failed.quality,code,probeInfo});setSource(next,false,true);return;}
   const isHtmlAuth=probeInfo&&/text\/html/i.test(String(probeInfo.contentType||""));
   const msg=isHtmlAuth
    ?"ব্রাউজার সেশন বা কুকি অনুমোদনের কারণে ভিডিও স্ট্রিম লোড হয়নি। পেজটি রিলোড করুন বা নতুন ট্যাবে ওপেন করুন।"
    :(code===4?"এই ভিডিওটি বর্তমানে লোড করা যায়নি। নিচের Retry বাটনে ক্লিক করে আবার চেষ্টা করুন।":"ভিডিও লোড করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
   errorNotice.innerHTML="<div>"+esc(msg)+'</div><button type="button" style="margin-top:10px;padding:7px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:#e50914;color:#fff;font-weight:700;cursor:pointer">↻ Retry Stream</button>';
   errorNotice.querySelector("button")?.addEventListener("click",()=>{failedSources.clear();retriedUrls.clear();setSource(best()||ordered[0],false,true);});
   errorNotice.hidden=false;
   console.error("All video sources failed",{code,message,networkState:video.networkState,readyState:video.readyState,probeInfo});
  }
  video.addEventListener("error",()=>{handleMediaError();});
  function loadHlsLibrary(){if(window.Hls)return Promise.resolve(window.Hls);if(window.__odHlsPromise)return window.__odHlsPromise;window.__odHlsPromise=new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js";script.onload=()=>resolve(window.Hls);script.onerror=reject;document.head.appendChild(script);});return window.__odHlsPromise;}
  async function setSource(src,keep=true,autoplay=false){const token=++sourceToken,t=keep?video.currentTime:0,was=!video.paused;errorNotice.hidden=true;if(activeHls){activeHls.destroy();activeHls=null;}video.pause();activeSource=src;quality.value=src.quality||"auto";
   const isHls=/\.m3u8(?:$|[?#])/i.test(src.url)||/mpegurl|m3u8|hls/i.test(String(src.mime||src.type||""));
   const ready=()=>{if(token!==sourceToken)return;if(t>0&&Number.isFinite(video.duration))video.currentTime=Math.min(t,Math.max(0,video.duration-2));if(was||autoplay)video.play().catch(()=>{});};
   if(isHls){
    // Prefer hls.js on Chromium/Android. Some Chromium builds report native HLS
    // support but still fail to decode the playlist; Safari keeps native playback.
    const ua=navigator.userAgent||"",isSafari=/Safari/i.test(ua)&&!/Chrome|Chromium|CriOS|Edg|Android/i.test(ua);
    if(!isSafari){
     try{
      const Hls=await loadHlsLibrary();if(token!==sourceToken)return;
      if(Hls&&Hls.isSupported()){
       activeHls=new Hls({enableWorker:true,lowLatencyMode:false,backBufferLength:90});
       activeHls.on(Hls.Events.MEDIA_ATTACHED,()=>{if(token===sourceToken)activeHls.loadSource(src.url);});
       activeHls.on(Hls.Events.MANIFEST_PARSED,ready);
       activeHls.on(Hls.Events.ERROR,(_,data)=>{
        if(data.fatal&&token===sourceToken){
         console.warn("Fatal HLS playback error; trying next source",data);
         $(".cv-buffer").hidden=true;
         video.dispatchEvent(new Event("error"));
        }
       });
       activeHls.attachMedia(video);return;
      }
     }catch(e){console.warn("hls.js unavailable; trying native HLS",e);}
    }
   }
   video.preload="metadata";
   video.src=src.url;
   video.addEventListener("loadedmetadata",ready,{once:true});
  }
  setSource(initial,false,true);quality.value=initial?.quality||"720p";
  quality.addEventListener("change",()=>{const src=quality.value==="auto"?best():ordered.find(x=>x.quality===quality.value);if(src)setSource(src)});
  play.addEventListener("click",()=>video.paused?video.play().catch(()=>{}):video.pause());
  centerPlay.addEventListener("click",()=>video.paused?video.play().catch(()=>{}):video.pause());
  video.addEventListener("click",()=>{if(video.paused)video.play().catch(()=>{});else revealControls();});
  video.addEventListener("play",()=>{wrap.classList.remove("cv-ended");play.textContent="Ⅱ";centerPlay.classList.remove("visible");wrap.classList.add("cv-playing");revealControls();});
  video.addEventListener("pause",()=>{play.textContent="▶";centerPlay.classList.add("visible");wrap.classList.remove("cv-playing");revealControls();});
  ["pointermove","pointerdown","touchstart"].forEach(evt=>wrap.addEventListener(evt,revealControls,{passive:true}));
  wrap.addEventListener("mouseleave",()=>{if(!video.paused)wrap.classList.remove("cv-ui-visible")});
  video.addEventListener("ended",()=>{centerPlay.classList.add("visible");wrap.classList.add("cv-ui-visible");wrap.classList.add("cv-ended")});
  const jump=delta=>{video.currentTime=Math.max(0,Math.min(video.duration||Infinity,video.currentTime+delta));showSkip(delta);revealControls();};
  $(".cv-back").addEventListener("click",()=>jump(-10));
  $(".cv-forward").addEventListener("click",()=>jump(10));
  skipControls.querySelector(".cv-mid-back").addEventListener("click",()=>jump(-10));
  skipControls.querySelector(".cv-mid-forward").addEventListener("click",()=>jump(10));
  video.addEventListener("timeupdate",()=>{if(video.duration){seek.value=Math.round(video.currentTime/video.duration*1000);time.textContent=fmt(video.currentTime)+" / "+fmt(video.duration);}});
  seek.addEventListener("input",()=>{if(video.duration)video.currentTime=Number(seek.value)/1000*video.duration});
  volume.addEventListener("input",e=>{video.volume=Number(e.target.value);video.muted=false;localStorage.setItem("cv-player-volume",String(video.volume));syncSound();});
  mute.addEventListener("click",()=>{if(video.muted||video.volume===0){video.muted=false;if(video.volume===0){video.volume=Math.max(.5,Number(localStorage.getItem("cv-player-volume")||1));volume.value=String(video.volume);}}else{video.muted=true;}syncSound();revealControls();});
  video.addEventListener("volumechange",syncSound);
  settingsPanel.querySelector(".cv-speed").addEventListener("change",e=>video.playbackRate=Number(e.target.value));
  async function enterFullscreen(){
   try{
    if(!document.fullscreenElement){
     if(wrap.requestFullscreen)await wrap.requestFullscreen();
     else if(video.webkitEnterFullscreen){video.webkitEnterFullscreen();return;}
    }
    if(screen.orientation?.lock){try{await screen.orientation.lock("landscape");}catch(e){/* Orientation lock is browser/device dependent. */}}
   }catch(e){console.warn("Fullscreen unavailable",e);}
  }
  async function exitFullscreen(){
   try{if(document.fullscreenElement)await document.exitFullscreen();}catch(e){}
   try{screen.orientation?.unlock?.();}catch(e){}
  }
  $(".cv-full").addEventListener("click",()=>document.fullscreenElement?exitFullscreen():enterFullscreen());
  document.addEventListener("fullscreenchange",()=>{
   if(document.fullscreenElement===wrap){if(screen.orientation?.lock)screen.orientation.lock("landscape").catch(()=>{});}
   else{try{screen.orientation?.unlock?.();}catch(e){}}
  });
  $(".cv-pip").addEventListener("click",async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await video.requestPictureInPicture()}catch{}});
  let baseTrackCount=video.querySelectorAll("track").length;
  function srtToVtt(text){
   const body=String(text||"").replace(/^\uFEFF/,"").replace(/\r/g,"").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g,"$1.$2").trim();
   return "WEBVTT\n\n"+body.replace(/^\d+\s*$/gm,"");
  }
  async function setSubtitles(list=[]){
   video.querySelectorAll("track[data-cv-dynamic-subtitle]").forEach(t=>t.remove());
   subs.innerHTML='<option value="-1">Subtitles Off</option>';
   const tracks=[...video.querySelectorAll("track")];
   const valid=(Array.isArray(list)?list:[]).filter(t=>t?.url&&/\.(?:vtt|srt)(?:$|[?#])/i.test(t.url));
   await Promise.all(valid.map(async(t,i)=>{
    let src=t.url;
    if(/\.srt(?:$|[?#])/i.test(src)){
     try{const r=await fetch(src,{mode:"cors",credentials:"omit",cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);src=URL.createObjectURL(new Blob([srtToVtt(await r.text())],{type:"text/vtt"}));}
     catch(e){console.warn("SRT subtitle fetch/conversion failed:",t.url,e);return;}
    }
    const el=document.createElement("track");el.kind="subtitles";el.label=t.label||t.language||"Subtitle "+(i+1);el.srclang=(t.language||"und").slice(0,2);el.src=src;el.dataset.cvDynamicSubtitle="1";video.appendChild(el);tracks.push(el);
    el.addEventListener("error",()=>console.warn("Subtitle track failed:",el.src));
   }));
   tracks.forEach((el,i)=>{const o=document.createElement("option");o.value=String(i);o.textContent=el.label||el.srclang||"Subtitle "+(i+1);subs.appendChild(o);});
   [...video.textTracks].forEach(t=>t.mode="disabled");subs.value="-1";
  }
  setSubtitles(subtitles);
  subs.addEventListener("change",()=>{
   const chosen=Number(subs.value);
   [...video.textTracks].forEach((track,i)=>track.mode=i===chosen?"showing":"disabled");
   if(chosen>=0&&video.textTracks[chosen]){const track=video.textTracks[chosen];track.mode="hidden";const show=()=>track.mode="showing";track.addEventListener("cuechange",show,{once:true});setTimeout(show,500);}
  });
  video.addEventListener("waiting",()=>$(".cv-buffer").hidden=false);video.addEventListener("playing",()=>$(".cv-buffer").hidden=true);video.addEventListener("canplay",()=>$(".cv-buffer").hidden=true);
  video.addEventListener("loadedmetadata",()=>{if(saved>15&&saved<video.duration-20){const resume=document.createElement("button");resume.className="cv-resume";resume.textContent="▶ Resume from "+fmt(saved);wrap.appendChild(resume);resume.addEventListener("click",()=>{video.currentTime=saved;resume.remove();video.play().catch(()=>{})},{once:true});}});
  let saveAt=0;video.addEventListener("timeupdate",()=>{if(video.currentTime-saveAt>8){saveAt=video.currentTime;localStorage.setItem(storageKey,String(Math.floor(saveAt)))}});video.addEventListener("ended",()=>localStorage.removeItem(storageKey));
  wrap.tabIndex=0;wrap.addEventListener("keydown",e=>{if(["INPUT","SELECT","BUTTON"].includes(e.target.tagName))return;if(e.code==="Space"){e.preventDefault();video.paused?video.play():video.pause()}else if(e.key==="ArrowRight")video.currentTime+=10;else if(e.key==="ArrowLeft")video.currentTime-=10;else if(e.key.toLowerCase()==="f")$(".cv-full").click()});
  let tap=0,lastTapX=0;video.addEventListener("touchend",e=>{const x=e.changedTouches[0].clientX,r=video.getBoundingClientRect();if(Math.abs(x-(r.left+r.width/2))<r.width*.12){tap=0;return;}const now=Date.now();if(now-tap<320&&Math.abs(x-lastTapX)<70){const delta=x<r.left+r.width/2?-10:10;video.currentTime=Math.max(0,Math.min(video.duration||Infinity,video.currentTime+delta));showSkip(delta);tap=0;revealControls();}else{tap=now;lastTapX=x;}},{passive:true});
  function setSuggestions(markup){
   let panel=wrap.querySelector(".cv-end-suggestions");
   if(!markup){panel?.remove();return;}
   if(!panel){panel=document.createElement("div");panel.className="cv-end-suggestions";wrap.appendChild(panel);}
   panel.innerHTML='<div class="cv-end-heading">Up Next · Suggested for you</div><div class="cv-end-grid">'+markup+'</div><button type="button" class="cv-end-replay">↻ Replay</button>';
   panel.querySelector(".cv-end-replay").addEventListener("click",()=>{video.currentTime=0;video.play().catch(()=>{});});
   if(video.ended)wrap.classList.add("cv-ended");
  }
  function setSources(next){ordered=[...next].filter(x=>x&&x.url).map(x=>({...x,quality:String(x.quality||"Auto"),mime:String(x.mime||x.type||"")})).sort((a,b)=>qualityNumber(a)-qualityNumber(b));failedSources.clear();retriedUrls.clear();activeSource=null;errorNotice.hidden=true;quality.innerHTML="<option value=\"auto\">Auto</option>"+ordered.map(x=>"<option value=\""+esc(x.quality)+"\">"+esc(x.quality)+"</option>").join("");if(ordered.length){const preferred=best()||ordered[0];setSource(preferred,false,true);quality.value=preferred.quality;}}return {video,wrap,setSource,setSources,setSubtitles,setSuggestions};
 }
 window.CineVersePlayer={mount};
})();
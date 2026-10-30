(() => {
 const $ = id => document.getElementById(id);
 let selectedImage = null, healthModel = null, diseaseModel = null, plantDetector = null, cameraStream = null, facing = "environment", currentWeather = null, lastPlantResult = null;
 let guideMessages = [], guideBusy = false;
 let liveScanTimer = null, liveScanBusy = false, lastLiveSignature = "", lastLiveShownAt = 0;
 const confThreshold = 0.70;
 const modelStatus = (s) => $("modelStatus").textContent = s;
 function logActivity(title, detail){const log=$("activityLog");if(!log)return;const row=document.createElement("div");row.className="advice";row.innerHTML="<div class='advice-icon'>✓</div><p><b>"+escapeHtml(title)+"</b><small>"+escapeHtml(detail)+"</small></p>";if(log.firstElementChild?.textContent.includes("Dashboard started"))log.innerHTML="";log.prepend(row);while(log.children.length>5)log.lastElementChild.remove();}
 function syncDashboard(){if($("dashPlant"))$("dashPlant").textContent=$("statPlant").textContent;if($("dashWeather"))$("dashWeather").textContent=$("statWeather").textContent;if($("dashMoisture"))$("dashMoisture").textContent=$("moisture").value+"%";if($("dashCrop"))$("dashCrop").textContent=$("crop").value||"Not set";if($("statMoisture"))$("statMoisture").textContent=$("moisture").value+"%";}

 // Navigation
 document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));
 document.querySelectorAll("[data-goto]").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.goto)));
 function showPage(page){const target=$("page-"+page);if(!target)return;document.querySelectorAll(".section").forEach(s=>s.classList.remove("active"));target.classList.add("active");document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));$("pageTitle").textContent=({dashboard:"Saathi Dashboard",advisory:"Crop Advisory & Plant Health",weather:"Local Weather",irrigation:"Smart Irrigation Planner",guide:"Saathi Farmer AI Guide"})[page]||"Saathi Dashboard";if(page==="guide")refreshGuideContext();window.scrollTo({top:0,behavior:"smooth"});}
 // Image selection
 $("chooseImage").onclick=()=>$("leafInput").click();
 $("leafInput").addEventListener("change",e=>{const file=e.target.files?.[0];if(file) setImageFile(file);});
 function setImageFile(file){
   if(!file.type.startsWith("image/")){alert("Please select an image file.");return;}
   if(selectedImage?.url) URL.revokeObjectURL(selectedImage.url);
   const url=URL.createObjectURL(file);selectedImage={url,file};
   $("leafPreview").src=url;$("leafPreview").hidden=false;$("uploadPrompt").hidden=true;
   $("diseaseResult").innerHTML="<h3>Image ready</h3><p class='sub'>Analyzing automatically…</p>";
   if(healthModel && diseaseModel) imgFromUrl(url).then(img=>analyzeSource(img)).catch(()=>{});
 }
 $("dropZone").addEventListener("dragover",e=>{e.preventDefault();$("dropZone").style.borderColor="#16a765";});
 $("dropZone").addEventListener("dragleave",()=>{$("dropZone").style.borderColor="#8ad0a8";});
 $("dropZone").addEventListener("drop",e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f)setImageFile(f);});
 // Camera and automatic live scanner
 $("openCamera").onclick=async()=>{ $("cameraModal").classList.add("open"); await startCamera(); };
 async function startCamera(){
   stopCamera(); if(!navigator.mediaDevices?.getUserMedia){$("cameraStatus").textContent="This browser does not support webcam access.";return;}
   try{
     cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing},audio:false});
     const video=$("cameraVideo");video.srcObject=cameraStream;await video.play();
     $("cameraStatus").textContent=healthModel&&diseaseModel&&plantDetector?"Camera ready. Waiting to verify a plant in frame…":"Camera ready. Waiting for AI models to finish loading…";
     $("cameraLiveResult").innerHTML="<h3>🌿 Live plant verification</h3><p class='sub'>Show the plant and pot. Saathi will ignore frames where it cannot confirm a plant.</p>";
     beginLiveScan();
   }catch(err){$("cameraStatus").textContent="Could not access camera. Allow camera permission and use localhost or HTTPS. "+err.message;}
 }
 function stopCamera(){
   if(liveScanTimer){clearInterval(liveScanTimer);liveScanTimer=null;}
   liveScanBusy=false;
   if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}
   const video=$("cameraVideo");if(video)video.srcObject=null;
 }
 $("closeCamera").onclick=()=>{$("cameraModal").classList.remove("open");stopCamera();};
 $("cameraModal").addEventListener("click",e=>{if(e.target===$("cameraModal")){$("cameraModal").classList.remove("open");stopCamera();}});
 $("switchCamera").onclick=()=>{facing=facing==="environment"?"user":"environment";startCamera();};
 $("capturePhoto").onclick=()=>{
   const v=$("cameraVideo");if(!v.videoWidth){$("cameraStatus").textContent="Camera is not ready yet.";return;}
   const c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);
   c.toBlob(blob=>{if(blob){setImageFile(new File([blob],"leaf-capture.jpg",{type:"image/jpeg"}));}$("cameraModal").classList.remove("open");stopCamera();},"image/jpeg",.92);
 };

 // Load the two built-in Teachable Machine models automatically at startup.
 function normalizeUrl(url){url=url.trim();if(url&&!url.endsWith("/"))url+="/";return url;}
 $("loadModels").onclick=loadModels;
 let loadingModelsPromise=null;
 async function loadModels(){
   if(healthModel&&diseaseModel&&plantDetector)return true;
   if(loadingModelsPromise)return loadingModelsPromise;
   loadingModelsPromise=(async()=>{
     const u1=normalizeUrl($("healthUrl").value),u2=normalizeUrl($("diseaseUrl").value);
     if(!u1||!u2){setModelMessage("The built-in model URL is missing. Check the project files.",false);loadingModelsPromise=null;return false;}
     if(!window.tmImage){setModelMessage("The model library did not load. Check internet access and reload the page.",false);loadingModelsPromise=null;return false;}
     setModelMessage("Loading trained plant models automatically…",false);
     try{
       healthModel=await tmImage.load(u1+"model.json",u1+"metadata.json");
       diseaseModel=await tmImage.load(u2+"model.json",u2+"metadata.json");
       if(!window.cocoSsd)throw new Error("Plant object detector did not load");
       plantDetector=await cocoSsd.load({base:"lite_mobilenet_v2"});
       setModelMessage("Plant detector and disease models are ready. Webcam scanning is automatic.",true);
       if($("dashModelStatus"))$("dashModelStatus").textContent="Plant verifier and both trained disease models loaded and ready.";
       logActivity("AI models loaded","Saathi loaded both built-in plant models automatically.");
       if(cameraStream){$("cameraStatus").textContent="All AI models ready. Show the plant and pot for verification.";beginLiveScan();}
       if(selectedImage) imgFromUrl(selectedImage.url).then(img=>analyzeSource(img)).catch(()=>{});
       return true;
     }catch(e){
       healthModel=null;diseaseModel=null;plantDetector=null;
       setModelMessage("Could not load the plant models. Check internet access and that both Teachable Machine links are still public, then reload Saathi.",false);
       if($("dashModelStatus"))$("dashModelStatus").textContent="Model loading failed. Check internet and public model links.";
       if($("cameraLiveResult"))$("cameraLiveResult").innerHTML="<h3>Models unavailable</h3><p class='sub'>Check internet and reload Saathi.</p>";
       return false;
     }finally{loadingModelsPromise=null;}
   })();
   return loadingModelsPromise;
 }
 function setModelMessage(message,ready){
   if($("modelStatus"))$("modelStatus").textContent=message;
   if($("setupStatus"))$("setupStatus").textContent=message;
   if(!ready&&$("dashModelStatus"))$("dashModelStatus").textContent=message;
 }
 function predict(model,img){return model.predict(img).then(p=>p.sort((a,b)=>b.probability-a.probability));}
 function inferHealthLabels(predictions){
   const labels=predictions.map(p=>p.className.trim());
   let healthy=labels.find(n=>/healthy|normal|no disease|disease[-_ ]?free/i.test(n)&&!/unhealthy|not healthy|diseased|infected/i.test(n));
   let unhealthy=labels.find(n=>/unhealthy|not healthy|diseased|infected|sick|disease|blight|spot|mildew|rot/i.test(n));
   if(!healthy&&unhealthy) healthy=labels.find(n=>n!==unhealthy);
   if(!unhealthy&&healthy) unhealthy=labels.find(n=>n!==healthy);
   return {healthy,unhealthy};
 }
 async function classifyImage(img){
   if(!healthModel||!diseaseModel)throw new Error("AI models are still loading.");
   const p1=await predict(healthModel,img),top=p1[0],classes=inferHealthLabels(p1);
   if(top.probability<confThreshold)return {kind:"uncertain",p1,top,classes};
   if(classes.healthy&&top.className.trim()===classes.healthy)return {kind:"healthy",p1,top,classes};
   if(classes.unhealthy&&top.className.trim()===classes.unhealthy){const p2=await predict(diseaseModel,img);return {kind:"disease",p1,p2,top:p2[0],healthTop:top,classes};}
   return {kind:"unrecognized",p1,top,classes};
 }
 function classificationHtml(r, live=false){
   const prefix=live?"Live scan":"Image analysis";
   if(r.kind==="uncertain")return "<h3>⚠️ Not confident yet</h3><p class='sub'>Keep one leaf centered, closer to the camera, and in good light.</p>"+predictionRows(r.p1,"Model 1 · health");
   if(r.kind==="healthy")return "<h3>🌿 Likely healthy</h3><p class='sub'>"+escapeHtml(prefix)+" · Model 1 classified this as "+escapeHtml(r.top.className)+". Model 2 was not needed.</p>"+predictionRows(r.p1,"Model 1 · health");
   if(r.kind==="disease")return "<h3>🔎 Possible disease: "+escapeHtml(r.top.className)+"</h3><p class='sub'>Model 1 marked the leaf as "+escapeHtml(r.healthTop.className)+"; Model 2 predicted this possible category.</p>"+predictionRows(r.p1,"Model 1 · health")+predictionRows(r.p2,"Model 2 · disease")+"<div class='notice'>This is an AI image prediction, not a confirmed diagnosis. Verify with an agricultural expert before choosing treatment.</div>";
   return "<h3>⚠️ Could not map health classes</h3><p class='sub'>Model 1's class labels do not clearly identify healthy versus unhealthy. Its highest class was "+escapeHtml(r.top.className)+". Check that Model 1 was trained with meaningful healthy/unhealthy class names.</p>"+predictionRows(r.p1,"Model 1 · health");
 }
 async function analyzeSource(img){
   if(!healthModel||!diseaseModel){$("diseaseResult").innerHTML="<h3>Loading models…</h3><p class='sub'>Saathi is starting the AI models automatically. Try again in a moment.</p>";return;}
   $("analyzeBtn").disabled=true;$("diseaseResult").innerHTML="<h3>Analyzing…</h3><p class='sub'>Running both models as needed.</p>";
   try{
     const r=await classifyImage(img);$("diseaseResult").innerHTML=classificationHtml(r,false);
     const label=r.kind==="disease"?r.top.className:(r.kind==="healthy"?r.top.className:r.top.className+" (uncertain)");
     $("statPlant").textContent=label;lastPlantResult={label,kind:r.kind,source:"uploaded image",at:new Date().toLocaleTimeString()};syncDashboard();refreshGuideContext();logActivity("Leaf image analyzed",label);
   }catch(e){$("diseaseResult").innerHTML="<h3>Prediction error</h3><p class='sub'>"+escapeHtml(e.message||"Could not analyze this image. Check model links and internet connection.")+"</p>";}
   finally{$("analyzeBtn").disabled=false;}
 }
 $("analyzeBtn").onclick=async()=>{
   if(!selectedImage){$("diseaseResult").innerHTML="<h3>No image selected</h3><p class='sub'>Choose an image or open the webcam scanner.</p>";return;}
   try{const img=await imgFromUrl(selectedImage.url);await analyzeSource(img);}catch(e){$("diseaseResult").innerHTML="<h3>Image error</h3><p class='sub'>Could not read this image. Try another photo.</p>";}
 };
 function imgFromUrl(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});}
 async function detectPlantRegion(source){
   if(!plantDetector) return {ok:false,reason:"The plant-verification model is still loading."};
   const detections=await plantDetector.detect(source,10,0.25);
   const plants=detections.filter(d=>d.class==="potted plant"&&d.score>=0.25).sort((a,b)=>b.score-a.score);
   if(!plants.length){
     const person=detections.some(d=>d.class==="person"&&d.score>=0.35);
     const other=detections.find(d=>d.score>=0.35&&d.class!=="person");
     return {ok:false,reason:person?"Person detected, but no potted plant verified. Keep the person out of the frame and show the plant/pot.":(other?"An object was detected, but not a plant. Show a potted plant clearly.":"No plant verified yet. Move a potted plant into view; close-up leaves may not be detected.")};
   }
   const chosen=plants[0], box=chosen.bbox;
   const sourceW=source.videoWidth||source.naturalWidth||source.width;
   const sourceH=source.videoHeight||source.naturalHeight||source.height;
   if(!sourceW||!sourceH)return {ok:false,reason:"Camera image is not ready."};
   const padX=box[2]*0.07,padY=box[3]*0.07;
   const x=Math.max(0,Math.floor(box[0]-padX)), y=Math.max(0,Math.floor(box[1]-padY));
   const w=Math.min(sourceW-x,Math.ceil(box[2]+padX*2)), h=Math.min(sourceH-y,Math.ceil(box[3]+padY*2));
   if(w<30||h<30)return {ok:false,reason:"Plant region is too small. Move the plant closer."};
   const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
   canvas.getContext("2d").drawImage(source,x,y,w,h,0,0,w,h);
   return {ok:true,canvas,score:chosen.score};
 }
 function beginLiveScan(){
   if(liveScanTimer)clearInterval(liveScanTimer);
   if(!cameraStream)return;
   liveScanTimer=setInterval(async()=>{
     const video=$("cameraVideo");if(!cameraStream||!healthModel||!diseaseModel||!plantDetector||liveScanBusy||!video.videoWidth||video.readyState<2)return;
     liveScanBusy=true;
     try{
       const gate=await detectPlantRegion(video);
       if(!gate.ok){
         const signature="not-plant:"+gate.reason;
         const now=Date.now();
         if(signature!==lastLiveSignature||now-lastLiveShownAt>4500){
           $("cameraLiveResult").innerHTML="<h3>⏸️ Waiting for a plant</h3><p class='sub'>"+escapeHtml(gate.reason)+" Disease models were not run for this frame.</p>";
           lastLiveSignature=signature;lastLiveShownAt=now;
         }
         $("cameraStatus").textContent="Plant verification active · no disease prediction until a plant is detected.";
         return;
       }
       const r=await classifyImage(gate.canvas);
       const label=r.kind==="disease"?"Possible disease: "+r.top.className:(r.kind==="healthy"?"Likely healthy":(r.kind==="uncertain"?"Uncertain":"Class label check needed"));
       const signature=r.kind+":"+r.top.className;
       const now=Date.now();
       if(signature!==lastLiveSignature||now-lastLiveShownAt>5500){
         $("cameraLiveResult").innerHTML=classificationHtml(r,true)+"<p class='sub'>Plant verification confidence: "+Math.round(gate.score*100)+"%</p>";
         $("statPlant").textContent=label;lastPlantResult={label,kind:r.kind,source:"verified webcam plant",at:new Date().toLocaleTimeString()};syncDashboard();refreshGuideContext();
         if(signature!==lastLiveSignature)logActivity("Verified plant scan",label);
         lastLiveSignature=signature;lastLiveShownAt=now;
       }
       $("cameraStatus").textContent="Plant verified · scanning its detected region · "+new Date().toLocaleTimeString();
     }catch(e){$("cameraStatus").textContent="Plant scan issue: "+(e.message||"retrying");}
     finally{liveScanBusy=false;}
   },1500);
 }

 function predictionRows(ps,title){let h=title?"<div class='result-line'><b>"+escapeHtml(title)+"</b><span>Confidence</span></div>":"";ps.slice(0,Math.min(4,ps.length)).forEach(p=>{const pct=(p.probability*100);h+="<div class='result-line'><span>"+escapeHtml(p.className)+"</span><b>"+pct.toFixed(1)+"%</b></div><div class='meter'><span style='width:"+Math.max(0,Math.min(100,pct))+"%'></span></div>";});return h;}
 function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
 // Weather is fetched automatically using browser geolocation; the API key stays on Flask.
 $("getWeather").onclick=()=>fetchWeatherByCity();
 function fetchWeatherAtLocation(){
   if(!navigator.geolocation){
     $("locationStatus").textContent="This browser does not support geolocation. Enter a town below.";
     $("weatherStatus").textContent="Automatic location is unavailable; use the town field as a fallback.";
     return;
   }
   $("locationStatus").textContent="Requesting device location permission…";
   navigator.geolocation.getCurrentPosition(
     position=>fetchWeather({lat:position.coords.latitude,lon:position.coords.longitude}),
     error=>{
       const message=error.code===1?"Location permission denied.":(error.code===2?"Device location is unavailable.":"Location request timed out.");
       $("locationStatus").textContent=message+" Enter a town below to fetch weather manually.";
       $("weatherStatus").textContent=message+" Saathi needs permission to fetch weather for your current location.";
     },
     {enableHighAccuracy:false,timeout:12000,maximumAge:300000}
   );
 }
 async function fetchWeatherByCity(){
   const city=$("city").value.trim();
   if(!city){$("weatherStatus").textContent="Allow location access or enter a town in the manual fallback field.";return;}
   await fetchWeather({city});
 }
 async function fetchWeather(location){
   const button=$("getWeather");button.disabled=true;
   $("weatherStatus").textContent=location.lat!==undefined?"Fetching weather for your current device location…":"Fetching weather for "+location.city+"…";
   try{
     const query=location.lat!==undefined?`lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}`:`city=${encodeURIComponent(location.city)}`;
     const response=await fetch("/api/weather?"+query,{cache:"no-store"});
     const data=await response.json();
     if(!response.ok)throw new Error(data.error||"Weather request failed");
     currentWeather=data;renderWeather(data);refreshGuideContext();
     const place=data.location.name+(data.location.country?", "+data.location.country:"");
     $("weatherStatus").textContent="Updated from OpenWeather for "+place+" • "+(data.current.observed_at||"current conditions");
     $("locationStatus").textContent=location.lat!==undefined?"Location detected: "+place:"Weather loaded for manually entered town: "+place;
     if($("city")&&location.lat!==undefined)$("city").value=data.location.name||"";
     $("statWeather").textContent=Math.round(data.current.temp)+"°C";
     $("statLocation").textContent=place;
     $("irrigationRain").value=Number(data.rain_next_24h_mm||0).toFixed(1);
     $("rain").value=Number(data.rain_1h_mm||0).toFixed(1);
     $("temp").value=data.current.temp;
     $("getAdvice").click();$("irrigateBtn").click();
     if($("dashApiStatus"))$("dashApiStatus").textContent="Connected; weather loaded for "+place+".";
     syncDashboard();logActivity("Weather updated",place+": "+Math.round(data.current.temp)+"°C");
   }catch(e){
     $("weatherStatus").textContent="Weather unavailable: "+e.message+" Check location permission, Flask, the API key and internet.";
     if($("dashApiStatus"))$("dashApiStatus").textContent="Weather service unavailable. Check Flask server and OpenWeather key.";
     if(location.lat!==undefined)$("locationStatus").textContent="Location was detected, but weather could not be fetched. You can retry or enter a town manually.";
   }finally{button.disabled=false;}
 }
 function weatherDescription(text){return text||"Current conditions";}
 function renderWeather(d){
   const c=d.current;
   $("weatherDisplay").innerHTML="<div class='weather-row'><div><div class='sub'>"+escapeHtml(d.location.name+(d.location.country?", "+d.location.country:""))+"</div><div class='weather-temp'>"+Math.round(c.temp)+"°C</div><div class='sub'>"+escapeHtml(weatherDescription(c.description))+"</div></div><div style='font-size:42px'>"+escapeHtml(c.icon_emoji||"🌦️")+"</div></div><div class='weather-metrics'><div class='weather-metric'><small>Humidity</small><b>"+c.humidity+"%</b></div><div class='weather-metric'><small>Rain (last hour)</small><b>"+Number(d.rain_1h_mm||0).toFixed(1)+" mm</b></div><div class='weather-metric'><small>Wind</small><b>"+Number(c.wind_speed_kmh||0).toFixed(1)+" km/h</b></div><div class='weather-metric'><small>Forecast rain (next 24h)</small><b>"+Number(d.rain_next_24h_mm||0).toFixed(1)+" mm</b></div><div class='weather-metric'><small>Weather source</small><b>OpenWeather</b></div><div class='weather-metric'><small>Updated</small><b>"+escapeHtml(c.observed_at||"Now")+"</b></div></div>";
 }
 // Rule-based crop advice: always give useful general actions until a crop is selected.
 function generateCropAdvice(recordActivity=false){
   const crop=$("crop").value,soil=$("soil").value,tempRaw=$("temp").value,rainRaw=$("rain").value;
   const temp=Number(tempRaw),rain=Number(rainRaw);
   if(tempRaw===""||rainRaw===""||!Number.isFinite(temp)||!Number.isFinite(rain)||temp < -10||temp>60||rain<0||rain>1000){
     $("cropAdvice").innerHTML="<div class='advice'><div class='advice-icon'>⚠️</div><p><b>Check your inputs</b><small>Enter a temperature from -10 to 60°C and recent rainfall from 0 to 1,000 mm.</small></p></div>";
     return;
   }
   const a=[];
   if(!crop){
     a.push(["🌱","Choose a crop to personalize this plan","Until a crop is selected, Saathi will give general field checks rather than assume a crop."]);
     a.push(["🔎","Inspect leaves and stems","Check several plants for spots, yellowing, wilting, pests or unusual growth. Photograph symptoms in good light."]);
     a.push(["💧","Check soil below the surface","Use a finger or small trowel to check root-zone moisture before watering; surface appearance alone can mislead."]);
   }else{
     a.push(["🌾",crop+" field check","Inspect several plants at different points in the field and note crop stage, leaf colour, growth and any unusual symptoms."]);
     a.push(["🌱",soil.charAt(0).toUpperCase()+soil.slice(1)+" soil",""+({loamy:"Loamy soil can balance drainage and water retention; check actual root-zone moisture.",clay:"Clay can retain water and drain slowly; check for standing water and compacted areas.",sandy:"Sandy soil may dry quickly; check moisture more often, especially near the root zone.",silty:"Silty soil may hold water; check drainage and avoid traffic on wet soil.",unknown:"Observe drainage and soil texture; consider a local soil test if possible."})[soil]]);
   }
   if(temp>=35)a.push(["🌡️","Heat-stress check","At this temperature, inspect for midday wilting or leaf scorch. Avoid unnecessary disturbance during the hottest hours and follow crop-specific local advice."]);
   else if(temp<=10)a.push(["🧣","Cold-stress check","Check for cold injury and consult local crop guidance if low temperatures are unusual for the crop."]);
   else a.push(["🌤️","Temperature check","Compare this reading with the crop's local growing requirements; it does not establish that conditions are optimal."]);
   if(rain>=20)a.push(["🌧️","Drainage check","Recent rainfall is high in this scenario. Check for standing water, blocked drains and saturated soil before irrigating."]);
   else if(rain<=2)a.push(["💧","Low-rainfall check","With little recent rain entered, inspect root-zone moisture rather than watering by calendar alone."]);
   else a.push(["🌦️","After-rain check","Check the field and root-zone moisture before the next watering decision."]);
   $("cropAdvice").innerHTML=a.map(x=>"<div class='advice'><div class='advice-icon'>"+x[0]+"</div><p><b>"+escapeHtml(x[1])+"</b><small>"+escapeHtml(x[2])+"</small></p></div>").join("");
   $("statCrop").textContent=crop||"Not set";syncDashboard();refreshGuideContext();
   if(recordActivity){logActivity("Crop advice generated",crop?crop+" · "+soil+" soil · "+temp+"°C · "+rain.toFixed(1)+" mm recent rain.":"General field checks generated; no crop selected.");}
   const adviceButton=$("getAdvice"); if(adviceButton){adviceButton.textContent="✓ Crop Advice Generated";window.setTimeout(()=>{if(adviceButton.isConnected)adviceButton.textContent="Generate Crop Advice";},1800);}
 }
 $("getAdvice").onclick=()=>generateCropAdvice(true);
 ["crop","soil","temp","rain"].forEach(id=>$(id).addEventListener("change",()=>generateCropAdvice(false)));

 // Irrigation simulator: recommendations update whenever the scenario changes.
 function renderIrrigationAdvice(recordActivity=false){
   const m=Number($("moisture").value),rainRaw=$("irrigationRain").value,rain=Number(rainRaw),stage=$("stage").value;let title,body,icon;
   if(rainRaw===""||!Number.isFinite(rain)||rain<0||rain>500){$("irrigationResult").innerHTML="<h3>⚠️ Check forecast input</h3><p>Enter a forecast rainfall value between 0 and 500 mm.</p>";return;}
   if(rain>=10){title="Check before irrigating";body="The entered forecast suggests meaningful rainfall. Verify the local forecast and root-zone soil moisture before deciding to water.";icon="🌧️";}
   else if(m<30){title="Inspect for water stress";body="This simulated value is low. Check moisture near the roots and look for early-morning wilting before deciding whether irrigation is needed.";icon="💧";}
   else if(m<60){title="Monitor and recheck";body="This simulated value is in a middle range. Check actual root-zone moisture and crop condition; the right decision depends on crop, soil and weather.";icon="🌱";}
   else{title="Watering may not be needed now";body="The simulated value is relatively high. Check drainage and actual root-zone moisture before adding water.";icon="✅";}
   const stageAdvice={seedling:"Seedlings can have shallow roots; check the soil close to the young root zone.",growth:"During vegetative growth, consider crop demand and root-zone moisture rather than the calendar alone.",flowering:"Flowering or fruiting can be a sensitive stage for some crops; avoid water stress and follow crop-specific local advice.",mature:"Near maturity, irrigation needs vary by crop and harvest timing; check local guidance before changing watering."};
   body+=" "+(stageAdvice[stage]||"");
   $("irrigationResult").innerHTML="<h3>"+icon+" "+escapeHtml(title)+"</h3><p>"+escapeHtml(body)+"</p><p class='sub'>Scenario: "+m+"% simulated moisture · "+rain.toFixed(1)+" mm forecast rain · "+escapeHtml(stage)+" stage.</p>";
   syncDashboard();refreshGuideContext();
   if(recordActivity)logActivity("Irrigation plan updated",title);
 }
 $("moisture").addEventListener("input",()=>{$("moistureLabel").textContent=$("moisture").value+"%";$("statMoisture").textContent=$("moisture").value+"%";renderIrrigationAdvice(false);syncDashboard();});
 $("irrigationRain").addEventListener("input",()=>renderIrrigationAdvice(false));
 $("stage").addEventListener("change",()=>renderIrrigationAdvice(false));
 $("irrigateBtn").onclick=()=>renderIrrigationAdvice(true);

 // Reset every editable/demo input and its dependent outputs while preserving the fetched live weather.
 $("resetAll").onclick=()=>{
   if(cameraStream){$("cameraModal").classList.remove("open");stopCamera();}
   $("crop").value="";$("soil").value="loamy";$("temp").value="28";$("rain").value="0";
   $("moisture").value="50";$("moistureLabel").textContent="50%";$("statMoisture").textContent="50%";
   $("irrigationRain").value=currentWeather?Number(currentWeather.rain_next_24h_mm||0).toFixed(1):"0";
   $("stage").value="growth";$("city").value="";
   if(selectedImage?.url)URL.revokeObjectURL(selectedImage.url);selectedImage=null;$("leafInput").value="";$("leafPreview").removeAttribute("src");$("leafPreview").hidden=true;$("uploadPrompt").hidden=false;
   lastPlantResult=null;$("statPlant").textContent="Not analyzed";
   $("diseaseResult").innerHTML="<h3>Plant scan result</h3><p class='sub'>Choose an image or start the webcam to screen a plant.</p>";
   $("diseaseAiResult").textContent="Scan a plant first, then request practical follow-up steps.";
   $("cropAiResult").textContent="Your crop-care plan will appear here.";$("weatherAiResult").textContent="Load the local weather first, then create a field plan.";$("irrigationAiResult").textContent="Change the moisture and crop stage above, then request a tailored checklist.";$("dashboardAiResult").textContent="Your personalized action plan will appear here when you request it.";
   generateCropAdvice(false);renderIrrigationAdvice(false);syncDashboard();refreshGuideContext();logActivity("Inputs reset","Demo inputs and dependent results were reset.");
 };
 async function checkBackend(){
   try{
     const r=await fetch("/api/health");const d=await r.json();
     if($("dashApiStatus"))$("dashApiStatus").textContent=d.weather_key_configured?"Weather service is configured; live data is checked when requested.":"Live weather is currently unavailable.";
     if(!d.weather_key_configured&&$("weatherStatus"))$("weatherStatus").textContent="Live weather is not available right now. Check the connection and try again later.";
   }catch(e){if($("dashApiStatus"))$("dashApiStatus").textContent="Cannot reach Flask. Start app.py and open Saathi through http://127.0.0.1:5000.";}
 }
 // Local Ollama / Qwen farmer-guide feature.
 function buildGuideContext(){
   const current=currentWeather&&currentWeather.current?currentWeather.current:null;
   const toNumber=(id)=>{const el=$(id);if(!el||el.value==="")return null;const value=Number(el.value);return Number.isFinite(value)?value:null;};
   return {
     crop:$("crop")?.value||"Not set",
     soil:$("soil")?.value||null,
     temperature_c:toNumber("temp"),
     recent_rain_mm:toNumber("rain"),
     forecast_rain_mm:toNumber("irrigationRain") ?? (currentWeather?Number(currentWeather.rain_next_24h_mm||0):null),
     current_weather:current?`${current.description||"Current conditions"}, ${Math.round(Number(current.temp))}°C`:null,
     humidity_percent:current?current.humidity:null,
     wind_kmh:current?current.wind_speed_kmh:null,
     soil_moisture_percent:toNumber("moisture"),
     crop_stage:$("stage")?.value||null,
     last_plant_result:lastPlantResult?`${lastPlantResult.label} (${lastPlantResult.kind}; ${lastPlantResult.source}; analyzed ${lastPlantResult.at||"recently"})`:null,
     location:currentWeather?.location?`${currentWeather.location.name||"Unknown location"}${currentWeather.location.country?", "+currentWeather.location.country:""}`:null,
     note:"Soil moisture is simulated by the demo unless measured externally; a plant scan is a model prediction, not a diagnosis."
   };
 }
 function refreshGuideContext(){
   const holder=$("guideContextPreview");if(!holder)return;
   const context=buildGuideContext();
   const labels={crop:"Selected crop",soil:"Soil type",temperature_c:"Temperature",recent_rain_mm:"Recent rain",forecast_rain_mm:"Forecast rain (next 24h)",current_weather:"Current weather",humidity_percent:"Humidity",wind_kmh:"Wind",soil_moisture_percent:"Simulated soil moisture",crop_stage:"Crop stage",last_plant_result:"Last plant scan",location:"Weather location"};
   holder.innerHTML=Object.entries(labels).map(([key,label])=>{
     let value=context[key];
     if(value===null||value===undefined||value==="")value="Not available";
     else if(key==="temperature_c")value=Number(value).toFixed(1)+" °C";
     else if(key==="recent_rain_mm"||key==="forecast_rain_mm")value=Number(value).toFixed(1)+" mm";
     else if(key==="humidity_percent")value=value+"%";
     else if(key==="wind_kmh")value=Number(value).toFixed(1)+" km/h";
     else if(key==="soil_moisture_percent")value=value+"% (simulated)";
     return `<div class="context-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></div>`;
   }).join("")+`<p class="sub">${escapeHtml(context.note)}</p>`;
 }
 function addGuideMessage(role,content,meta=""){
   const log=$("guideChat");if(!log)return null;
   const bubble=document.createElement("div");bubble.className="guide-message "+(role==="user"?"user":"assistant");
   const title=document.createElement("b");title.textContent=role==="user"?"You":"Saathi · Qwen3";
   const body=document.createElement("p");body.textContent=content;
   bubble.append(title,body);
   if(meta){const small=document.createElement("small");small.textContent=meta;bubble.appendChild(small);}
   log.appendChild(bubble);log.scrollTop=log.scrollHeight;return bubble;
 }
 async function checkOllamaStatus(){
   const dot=$("ollamaStatusDot"),title=$("ollamaStatusTitle"),detail=$("ollamaStatusText"),dash=$("dashOllamaStatus");
   if(title)title.textContent="Checking Farmer AI…";
   if(detail)detail.textContent="Checking whether contextual farming advice is available.";
   try{
     const response=await fetch("/api/ollama/status",{cache:"no-store"});
     const data=await response.json();
     if(dot)dot.className="ai-status-dot "+(data.ok?"ready":"error");
     if(title)title.textContent=data.ok?"Farmer AI is ready":"Farmer AI is unavailable";
     if(detail)detail.textContent=data.message||"Farmer AI status checked.";
     if(dash)dash.textContent=data.message||"Ollama status checked.";
     return Boolean(data.ok);
   }catch(error){
     if(dot)dot.className="ai-status-dot error";
     if(title)title.textContent="Farmer AI status unavailable";
     if(detail)detail.textContent="Farmer AI is not available right now. Other Saathi tools can still be used.";
     if(dash)dash.textContent="Farmer AI availability could not be checked.";
     return false;
   }
 }
 async function sendGuideQuestion(override){
   if(guideBusy)return;
   const input=$("guideQuestion");
   const question=String(override||input.value||"").trim();
   if(!question)return;
   guideBusy=true;
   const send=$("guideSend");if(send){send.disabled=true;send.textContent="Thinking…";}
   if(input)input.value="";
   addGuideMessage("user",question);
   const history=guideMessages.slice(-8);
   guideMessages.push({role:"user",content:question});
   const pending=addGuideMessage("assistant","Saathi is considering the farm context…");
   const context=buildGuideContext();refreshGuideContext();
   try{
     const response=await fetch("/api/farmer-guide",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question,context,history})});
     const data=await response.json();
     if(!response.ok)throw new Error(data.error||"Farmer guide request failed.");
     if(pending)pending.remove();
     addGuideMessage("assistant",data.answer||"No answer was returned.",`${data.model||"Local model"} · Generated locally by Ollama`);
     guideMessages.push({role:"assistant",content:String(data.answer||"").slice(0,1200)});
     if(guideMessages.length>16)guideMessages=guideMessages.slice(-16);
     logActivity("Farmer AI question answered",question.slice(0,72));
     checkOllamaStatus();
   }catch(error){
     if(pending)pending.remove();
     addGuideMessage("assistant","I could not generate a response right now. "+(error.message||"The Farmer AI service is unavailable."),"No AI answer was generated. Check the service status and retry.");
     checkOllamaStatus();
   }finally{
     guideBusy=false;if(send){send.disabled=false;send.textContent="Ask Saathi ↗";}
   }
 }
 async function runInlineAI(button){
   const target=$(button.dataset.aiTarget);
   if(!target)return;
   if(button.dataset.busy==="1")return;
   button.dataset.busy="1";const original=button.textContent;button.disabled=true;button.textContent="Preparing advice…";
   target.classList.add("is-working");target.textContent="Saathi is reviewing the current farm context…";
   const question=String(button.dataset.aiPrompt||"Review my current farm context and suggest safe next steps.").trim();
   try{
     const response=await fetch("/api/farmer-guide",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question,context:buildGuideContext(),history:[]})});
     const data=await response.json();
     if(!response.ok)throw new Error(data.error||"Farmer AI could not answer this action.");
     target.textContent=data.answer||"No response was returned.";
     target.dataset.model=data.model||"Local Farmer AI";
     logActivity("AI action completed",question.slice(0,68));
     refreshGuideContext();
   }catch(error){
     target.textContent="Farmer AI is unavailable right now. "+(error.message||"Please check its status in the Farmer AI Guide and retry.");
   }finally{
     target.classList.remove("is-working");button.disabled=false;button.textContent=original;delete button.dataset.busy;
   }
 }
 document.querySelectorAll("[data-ai-action]").forEach(button=>button.addEventListener("click",()=>runInlineAI(button)));
 $("guideForm")?.addEventListener("submit",event=>{event.preventDefault();sendGuideQuestion();});
 // Enter sends a question; Shift+Enter inserts a newline for longer prompts.
 $("guideQuestion")?.addEventListener("keydown",event=>{
   if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(String(event.currentTarget.value||"").trim())sendGuideQuestion();}
 });
 document.querySelectorAll("[data-guide-prompt]").forEach(button=>button.addEventListener("click",()=>{showPage("guide");const q=button.dataset.guidePrompt||"";if($("guideQuestion"))$("guideQuestion").value=q;sendGuideQuestion(q);}));
 $("refreshOllama")?.addEventListener("click",checkOllamaStatus);
 $("refreshGuideContext")?.addEventListener("click",refreshGuideContext);
 ["crop","soil","temp","rain","moisture","irrigationRain","stage"].forEach(id=>{const el=$(id);if(el){el.addEventListener("input",refreshGuideContext);el.addEventListener("change",refreshGuideContext);}});

 // Initialize useful default advice without logging a false user action.
 generateCropAdvice(false);renderIrrigationAdvice(false);syncDashboard();showPage("dashboard");
 checkBackend();checkOllamaStatus();refreshGuideContext();loadModels();fetchWeatherAtLocation();
})();

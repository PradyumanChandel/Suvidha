const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
/* Directory data: [group, color, glyph, [name, keywords]...] */
const DIR=[
["Home & Kitchen Appliances","var(--teal)","❄",[["AC Repair","ac air conditioner cooling"],["TV Repair","tv television screen"],["Washing Machine Repair","washing machine laundry"],["Refrigerator Repair","fridge refrigerator"],["Microwave Repair","microwave oven"],["Laptop Repair","laptop computer"],["Kitchen Chimney","chimney exhaust"],["Gas Stove & Hob","gas stove hob cooking"],["RO & Water Purifier","ro water purifier filter"],["Geyser","geyser water heater"]]],
["Insta Help & Staffing","var(--brass)","⚒",[["Carpenter","carpenter furniture wood"],["Electrician","electrician electrical"],["Plumber","plumber pipes"],["Cook","cook chef"],["House Help","house help domestic"],["Driver","driver car"],["Nanny / Babysitter","nanny babysitter childcare"],["Gardener","gardener garden plants"]]],
["Beauty & Grooming","var(--plum)","✂",[["Men's Grooming","mens grooming beard"],["Women's Salon","womens salon beauty"],["Haircut & Styling","haircut hair"],["Facial & Cleanup","facial skincare"],["Mani & Pedi","manicure pedicure nails"],["Waxing & Threading","waxing threading"]]],
["Home Care & Painting","var(--green)","⌂",[["Full Home Clean","full home cleaning house"],["Kitchen Cleaning","kitchen cleaning"],["Bath & Kitchen","bathroom cleaning"],["Weekly Cleaning","weekly regular cleaning"],["Sofa & Carpet","sofa carpet upholstery"],["Home Painting","home painting paint"],["Painting Services","painter painting"],["Wall Panels","wall panels interior decor"],["Wall Beauty","wall decoration decor"],["Few Rooms","few rooms painting"],["Painting Consult","painting consultation advice"]]],
["Real Estate & Construction","var(--ink)","▦",[["Rent Property","rent rental apartment"],["Buy Property","buy property apartment"],["Sell Property","sell property apartment"],["Home Constructor","construction builder"]]]];
const ICON={"AC Repair":"❄️","TV Repair":"📺","Washing Machine Repair":"🧺","Refrigerator Repair":"🧊","Microwave Repair":"🍽️","Laptop Repair":"💻","Kitchen Chimney":"🌬️","Gas Stove & Hob":"🔥","RO & Water Purifier":"💧","Geyser":"🚿","Carpenter":"🪚","Electrician":"⚡","Plumber":"🔧","Cook":"🧑‍🍳","House Help":"🧹","Driver":"🚗","Nanny / Babysitter":"🧸","Gardener":"🌱","Men's Grooming":"🧔","Women's Salon":"💇‍♀️","Haircut & Styling":"✂️","Facial & Cleanup":"🧖","Mani & Pedi":"💅","Waxing & Threading":"🌸","Full Home Clean":"🏠","Kitchen Cleaning":"🧽","Bath & Kitchen":"🛁","Weekly Cleaning":"📅","Sofa & Carpet":"🛋️","Home Painting":"🎨","Painting Services":"🖌️","Wall Panels":"🧱","Wall Beauty":"✨","Few Rooms":"🚪","Painting Consult":"💬","Rent Property":"🔑","Buy Property":"🏡","Sell Property":"🏷️","Home Constructor":"🏗️"};
const dir=$("#dir");
dir.innerHTML=DIR.map(([g,c,i,items])=>`<div class="grp rv"><h3 class="gtitle" style="--c:${c}">${g.replace("&","&amp;")}</h3><div class="grid">${items.map(([n,k])=>`<a href="#contact" class="cat" style="--c:${c}" data-k="${n.toLowerCase()} ${k}"><b>${ICON[n]||i}</b>${n.replace("&","&amp;")}</a>`).join("")}</div></div>`).join("");
/* Search */
function filter(){const v=$("#q").value.trim().toLowerCase();let t=0;
$$(".grp").forEach(g=>{let m=0;g.querySelectorAll(".cat").forEach(c=>{const ok=c.dataset.k.includes(v);c.style.display=ok?"flex":"none";if(ok){m++;t++}});g.style.display=m?"block":"none"});
$("#none").style.display=t?"none":"block";$("#none").textContent=t?"":"No matching services found. Try a different search."}
$("#q").addEventListener("input",filter);
$("#form").addEventListener("submit",e=>{e.preventDefault();filter();$("#categories").scrollIntoView({behavior:"smooth"})});
/* Mobile menu */
$("#menu").onclick=()=>{const o=$("#links").classList.toggle("open");$("#menu").setAttribute("aria-expanded",o);$("#menu").textContent=o?"×":"☰"};
$$("#links a").forEach(a=>a.onclick=()=>{$("#links").classList.remove("open");$("#menu").textContent="☰"});
/* Scroll-reveal */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.12});
$$(".rv").forEach(el=>io.observe(el));
/* Count-up numbers */
const co=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;co.unobserve(e.target);
const el=e.target,end=+el.dataset.count,suf=el.dataset.suffix||"";if(reduce){return}
const t0=performance.now();(function f(t){const p=Math.min((t-t0)/1400,1);el.textContent=Math.round(end*(1-Math.pow(1-p,3)))+suf;if(p<1)requestAnimationFrame(f)})(t0)}),{threshold:.6});
$$("[data-count]").forEach(el=>co.observe(el));
/* Word-by-word statement */
const st=$("#stmt");st.innerHTML=st.textContent.split(" ").map(w=>`<span class="w">${w}</span>`).join(" ");
const words=$$(".w"),steps=$$(".step"),panes=$$(".pane");
/* One scroll handler drives everything */
let tick=false;
function onScroll(){tick=false;
const y=scrollY,h=document.documentElement.scrollHeight-innerHeight;
$("#bar").style.transform=`scaleX(${h?y/h:0})`;
$("#nav").classList.toggle("stuck",y>8);
if(reduce)return;
/* hero parallax: photo drifts, chips float at different speeds */
const hs=$(".stage").getBoundingClientRect();
if(hs.bottom>0){$("#heroimg").style.transform=`translateY(${-y*.08}px)`;$$(".chip").forEach(c=>c.style.transform=`translateY(${y*c.dataset.f/400}px)`)}
/* statement words light up as you read */
const sr=st.getBoundingClientRect(),sp=Math.min(Math.max((innerHeight*.85-sr.top)/(innerHeight*.6+sr.height*.5),0),1);
words.forEach((w,i)=>w.classList.toggle("on",i<sp*words.length));
/* journey: pinned section advances step by step */
const j=$("#journey").getBoundingClientRect(),jp=Math.min(Math.max(-j.top/(j.height-innerHeight),0),1);
$("#rail").style.transform=`scaleY(${jp})`;
const idx=Math.min(2,Math.floor(jp*3));
steps.forEach((s,i)=>s.classList.toggle("on",i===idx));panes.forEach((p,i)=>p.classList.toggle("on",i===idx))}
addEventListener("scroll",()=>{if(!tick){tick=true;requestAnimationFrame(onScroll)}},{passive:true});
addEventListener("resize",onScroll);onScroll();
/* Reuse embedded illustrations (no duplicate image data) */
$("#imgStory").src=$(".pimg").src;
/* Hero video: autoplays muted; sound button toggles audio */
const hv=$("#heroimg"),snd=$("#snd");
snd.onclick=()=>{hv.muted=!hv.muted;snd.textContent=hv.muted?"🔇":"🔊";snd.setAttribute("aria-label",hv.muted?"Turn sound on":"Turn sound off");if(hv.paused)hv.play()};
const pb=$("#pb");
function tryPlay(){const p=hv.play();if(p&&p.catch)p.catch(()=>{pb.hidden=false})}
pb.onclick=()=>{pb.hidden=true;hv.muted=true;const p=hv.play();if(p&&p.catch)p.catch(()=>{hv.controls=true})};
hv.addEventListener("playing",()=>{pb.hidden=true});
hv.addEventListener("error",()=>{pb.hidden=false;pb.textContent="▶ Tap to play video"});
if(reduce){hv.removeAttribute("autoplay");hv.pause();hv.controls=true}
else{hv.muted=true;tryPlay();addEventListener("pointerdown",()=>{if(hv.paused)tryPlay()},{once:true})}

/* Repair image: gently zooms out as it scrolls into view */
const fi=$("#fimg");
function fz(){const r=fi.parentNode.getBoundingClientRect();const q=Math.min(Math.max((innerHeight-r.top)/(innerHeight+r.height),0),1);fi.style.transform=`scale(${1.1-q*.1})`}
if(!reduce){addEventListener("scroll",fz,{passive:true});fz()}
/* Enquiry form: opens WhatsApp or email with the details filled in */
const dl=document.createElement("datalist");dl.id="svcs";dl.innerHTML=Object.keys(ICON).map(k=>`<option value="${k}">`).join("");document.body.appendChild(dl);
const F=$("#eform");
function enq(){const d=Object.fromEntries(new FormData(F));return `New enquiry (Suvidha website)\nName: ${d.name}\nPhone: ${d.phone}\nService: ${d.service}\nAddress: ${d.address}\nDate: ${d.date} (${d.slot})\nDetails: ${d.note||"-"}`}
const T0=Date.now();
const newRid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(16)+Math.random().toString(16).slice(2);let RID=newRid();
{const n=new Date(),p=x=>String(x).padStart(2,"0");$("#bdate").min=n.getFullYear()+"-"+p(n.getMonth()+1)+"-"+p(n.getDate())}
F.addEventListener("submit",async e=>{e.preventDefault();
const b=F.querySelector("[type=submit]"),m=$("#fmsg"),d=Object.fromEntries(new FormData(F));d.t=Date.now()-T0;d.rid=RID;d.consent=F.consent.checked;
b.disabled=true;m.className="";m.textContent="Sending...";
try{const H={method:"POST",headers:{"Content-Type":"application/json"}};let r=await fetch("/api/booking",{...H,body:JSON.stringify(d)});if(r.status===404){r=await fetch("/api/enquiry",{...H,body:JSON.stringify({...d,area:d.address+" | "+d.date+" "+d.slot})})}const j=await r.json();
if(!r.ok||!j.ok)throw new Error(j.error||"failed");F.reset();RID=newRid();m.textContent="";$("#pinnote").textContent="";$("#doneRef").textContent=j.ref||"We will confirm by phone";F.hidden=true;$("#done").hidden=false;$("#done").scrollIntoView({behavior:"smooth",block:"center"})}
catch(err){m.className="bad";m.textContent="Could not send right now. Please chat on WhatsApp or call 6230427455."}
b.disabled=false});
$("#again").onclick=()=>{$("#done").hidden=true;F.hidden=false};
const pin=F.pincode,pnote=$("#pinnote");
pin.addEventListener("input",()=>{const v=pin.value.replace(/\D/g,"");pin.value=v;pnote.textContent=v.length<6?"":v.startsWith("211")?"This looks like a Prayagraj pincode. We will confirm availability when we call.":"We currently serve Prayagraj. You can still send your request and we will tell you if we can reach you."});
$("#viaWa").onclick=()=>{if(!F.reportValidity())return;open("https://wa.me/916230427455?text="+encodeURIComponent(enq()),"_blank","noopener")};
$$(".cat").forEach(c=>c.addEventListener("click",()=>{F.service.value=c.lastChild.textContent.trim()}));
/* Service card buttons pre-fill the booking form */
const SMAP={"AC Service & Repair":"AC Repair","Home Cleaning":"Full Home Clean","Electrical Services":"Electrician","Washing Machine Repair":"Washing Machine Repair","Refrigerator Repair":"Refrigerator Repair","Plumbing":"Plumber"};
$$(".svc").forEach(c=>c.querySelector(".btn").addEventListener("click",()=>{F.service.value=SMAP[c.querySelector("h3").textContent]||""}));
/* Booking journey: van drives along the road as you scroll */
const rt=$("#route"),stops=$$("#route .stops li");
function rtUpd(){const r=rt.getBoundingClientRect();const p=reduce?1:Math.min(Math.max((innerHeight*.85-r.top)/(innerHeight*.45+r.height),0),1);
rt.style.setProperty("--p",p.toFixed(3));stops.forEach((s,i)=>s.classList.toggle("on",p>=i/(stops.length-1)-.03))}
addEventListener("scroll",rtUpd,{passive:true});addEventListener("resize",rtUpd);rtUpd();
/* Technician profiles: add entries here and the section appears automatically.
   Example: {name:"Ramesh K.",skill:"AC technician",exp:"6 years",area:"Prayagraj"} */
const E=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const TECHS=[];
if(TECHS.length){$("#techs").innerHTML=TECHS.map(t=>`<article class="card"><b>👤</b><h3>${E(t.name)}</h3><p>${E(t.skill)} · ${E(t.exp)}</p><p>${E(t.area)}</p></article>`).join("");$("#team").hidden=false}
/* Partner application */
const PF=$("#pform"),P0=Date.now();
PF.addEventListener("submit",async e=>{e.preventDefault();
const b=PF.querySelector("[type=submit]"),m=$("#pmsg"),d=Object.fromEntries(new FormData(PF));d.t=Date.now()-P0;
b.disabled=true;m.className="";m.textContent="Sending...";
try{const r=await fetch("/api/partner",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});
if(r.status===404){open("https://wa.me/916230427455?text="+encodeURIComponent("Partner application\nName: "+d.name+"\nPhone: "+d.phone+"\nSkill: "+d.skill+"\nExperience: "+d.exp+"\nArea: "+(d.area||"-")),"_blank","noopener");m.className="ok";m.textContent="Opening WhatsApp so you can send your details."}
else{const j=await r.json();if(!r.ok||!j.ok)throw new Error();PF.reset();m.className="ok";m.textContent="Thank you! We have your application and will contact you."}}
catch(x){m.className="bad";m.textContent="Could not send right now. Please call 6230427455."}
b.disabled=false});
/* Booking tracking */
const TF=$("#tform");
TF.addEventListener("submit",async e=>{e.preventDefault();const m=$("#tmsg"),L=$("#tstat"),d=new FormData(TF);m.className="";m.textContent="Checking...";L.hidden=true;
try{const r=await fetch("/api/track?ref="+encodeURIComponent(d.get("ref"))+"&p="+encodeURIComponent(d.get("p")));const j=await r.json();
if(!r.ok||!j.ok){m.className="bad";m.textContent=j.error||"Could not check right now.";return}
const ST=["REQUESTED","CONFIRMED","ASSIGNED","ON_THE_WAY","COMPLETED"],LB={REQUESTED:"Requested",CONFIRMED:"Confirmed",ASSIGNED:"Assigned",ON_THE_WAY:"On the way",COMPLETED:"Completed"};
if(j.status==="CANCELLED"){m.className="bad";m.textContent="This booking was cancelled. Please call us if you need help.";return}
const at=ST.indexOf(j.status);L.replaceChildren();ST.forEach((s,i)=>{const li=document.createElement("li");li.textContent=LB[s];if(i<=at)li.className="on";L.appendChild(li)});L.hidden=false;
m.className="ok";m.textContent=j.service+" · "+j.date+" ("+j.slot+")"}
catch(x){m.className="bad";m.textContent="Could not check right now. Please call 6230427455."}});
$("#yr").textContent=new Date().getFullYear();

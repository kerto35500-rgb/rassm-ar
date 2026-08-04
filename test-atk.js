/* حصاد دوال مشهد البطاقات من quiz2.html وتشغيلها على DOM مصغّر */
const fs=require("fs");
const src=fs.readFileSync("public/quiz2.html","utf8");
function grab(name){
  const i=src.indexOf("function "+name+"(");
  if(i<0)throw new Error("not found: "+name);
  let d=0,j=src.indexOf("{",i);
  for(let k=j;k<src.length;k++){const c=src[k];if(c==="{")d++;else if(c==="}"){d--;if(!d)return src.slice(i,k+1);}}
  throw new Error("unbalanced "+name);
}
/* ── DOM مصغّر ── */
class El{
  constructor(tag){this.tagName=tag;this.children=[];this.style=new Proxy({},{
      get:(t,k)=>k==="setProperty"?((k2,v)=>{t[k2]=v}):t[k],set:(t,k,v)=>{t[k]=v;return true}});
    this.dataset={};this.classes=new Set();this._html="";this.onclick=null;this.parentElement=null;}
  get classList(){const s=this.classes;return{
    add:(...c)=>c.forEach(x=>s.add(x)),remove:(...c)=>c.forEach(x=>s.delete(x)),
    contains:c=>s.has(c),toggle:(c,v)=>{v===undefined?(s.has(c)?s.delete(c):s.add(c)):(v?s.add(c):s.delete(c))}};}
  set className(v){this.classes=new Set(String(v).split(/\s+/).filter(Boolean));}
  get className(){return [...this.classes].join(" ");}
  set innerHTML(v){this._html=v;if(v==="")this.children=[];}
  get innerHTML(){return this._html;}
  set textContent(v){this._text=v;} get textContent(){return this._text||"";}
  appendChild(c){c.parentElement=this;this.children.push(c);return c;}
  insertBefore(c,ref){c.parentElement=this;const i=this.children.indexOf(ref);
    i<0?this.children.push(c):this.children.splice(i,0,c);return c;}
  removeChild(c){const i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1);}
  remove(){this.parentElement&&this.parentElement.removeChild(this);}
  getBoundingClientRect(){return {left:100,top:100,width:100,height:150,right:200,bottom:250};}
  animate(){return {};}
  setProperty(){}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  get firstElementChild(){return this.children[0]||null;}
}
const IDS={};
["sAtk","atkTitle","cardRow","atkNote","tgModal","tgBox","tgCard","tgTitle","tgSub","tgList","tgBar","atkArc"]
  .forEach(id=>{IDS[id]=new El("div");});
IDS.tgBar.appendChild(new El("i"));
global.document={createElement:t=>new El(t),querySelector:()=>null,body:new El("body")};
global.requestAnimationFrame=()=>0;global.cancelAnimationFrame=()=>{};
global.setTimeout=(f,ms)=>{QUEUE.push([f,ms]);return QUEUE.length;};
const QUEUE=[];
function flush(){while(QUEUE.length){const [f]=QUEUE.shift();f();}}
const $=id=>IDS[id]||new El("div");
global.$=$;
let SENT=[];
global.socket={emit:(ev,d)=>SENT.push([ev,d])};
global.sTap=()=>{};global.tone=()=>{};global.RM=false;
global.esc=s=>String(s);global.avatar=()=>"<svg/>";
global.scene=()=>{};global.mountClock=()=>{};
global.OFF=0;
let atkT=null,atkP=null,atkSent=false;
let ST=null;
const PW_EM={freeze:"❄️",gloop:"🟢",bombs:"💣",nibble:"👾",shuffle:"🔀",double:"✨"};
const PW_NM={freeze:"تجميد",gloop:"وحل",bombs:"قنابل",nibble:"أكلة",shuffle:"خلط",double:"مضاعفة"};
const SELF_PW=new Set(["double"]);
let PW_CL;eval(src.slice(src.indexOf("const PW_CL="),src.indexOf("const CARD_GLYPH=")).replace("const PW_CL","PW_CL"));
const CARD_GLYPH="✦";
let spksReady=true; // نتفادى بناء الشرارات
function buildSparks(){}
let atkArcRaf=0;
eval(grab("atkArcRun"));
eval(grab("closeTg"));
eval(grab("rAtk"));
eval(grab("flipCard"));
eval(grab("openTargets"));
eval(grab("flyTo"));

/* ── الاختبارات ── */
let pass=0,fail=0;
const ok=(c,m)=>{c?(pass++,console.log("  ✅ "+m)):(fail++,console.log("  ❌ "+m));};
function reset(players,menu,uses,left){
  SENT=[];QUEUE.length=0;atkT=null;atkP=null;atkSent=false;
  IDS.cardRow.children=[];IDS.tgList.children=[];IDS.tgModal.classes.clear();
  ST={phase:"attack",phaseEndsAt:Date.now()+6000,phaseDur:6,powerMenu:menu,
    settings:{powerUses:uses,allowedPowers:menu},players};
  global.ST=ST;
  players.forEach(p=>{if(p.id==="me")p.powersLeft=left;});
}
global.ME="me";
const P=(id,n)=>({id,name:n,color:"#fff",score:10,connected:true,powersLeft:4});

console.log("\n① ثلاث بطاقات مقلوبة تُبنى ولا هدف يظهر مسبقاً");
reset([P("me","أنا"),P("b","سعد"),P("c","نورة")],["freeze","bombs","double"],4,4);
rAtk(true);
ok(IDS.cardRow.children.length===3,"عدد البطاقات = 3 ("+IDS.cardRow.children.length+")");
ok(IDS.cardRow.children.every(c=>c.classes.has("card")&&!c.classes.has("flip")),"كلها مقلوبة على ظهرها");
ok(!IDS.tgModal.classes.has("on"),"نافذة الأهداف مغلقة");
ok(SENT.length===0,"لم يُرسل شيء بعد");

console.log("\n② قلب بطاقة هجومية ⇒ تفتح نافذة الأسماء ولا تُرسل قبل الاختيار");
const c0=IDS.cardRow.children[0];
c0.onclick();
ok(c0.classes.has("flip"),"البطاقة انقلبت");
ok(IDS.cardRow.children.slice(1).every(c=>c.classes.has("spent")),"البطاقات الأخرى خبت");
ok(SENT.length===0,"لا إرسال قبل اختيار الهدف");
flush();
ok(IDS.tgModal.classes.has("on"),"النافذة فُتحت");
ok(IDS.tgList.children.length===2,"أسماء الخصوم = 2 ("+IDS.tgList.children.length+")");

console.log("\n③ اختيار خصم يُرسل هجوماً واحداً فقط");
IDS.tgList.children[1].onclick();
ok(SENT.length===1&&SENT[0][0]==="attack","أُرسل هجوم واحد");
ok(SENT[0][1].to==="c"&&SENT[0][1].power==="freeze","الهدف والقوة صحيحان: "+JSON.stringify(SENT[0][1]));
ok(!IDS.tgModal.classes.has("on"),"النافذة أُغلقت");
IDS.tgList.children[0].onclick();
ok(SENT.length===1,"نقرة ثانية لا تُرسل هجوماً مكرراً");

console.log("\n④ بطاقة «مضاعفة» تُرسل بلا هدف ولا نافذة");
reset([P("me","أنا"),P("b","سعد")],["double","bombs"],4,4);
rAtk(true);
IDS.cardRow.children[0].onclick();flush();
ok(SENT.length===1&&SENT[0][1].power==="double"&&!("to" in SENT[0][1]),
   "أُرسلت بلا هدف: "+JSON.stringify(SENT[0][1]));
ok(!IDS.tgModal.classes.has("on"),"لا نافذة أسماء للمضاعفة");

console.log("\n⑤ نفدت الاستخدامات ⇒ لا بطاقات إطلاقاً");
reset([P("me","أنا"),P("b","سعد")],["freeze","bombs"],4,0);
rAtk(true);
ok(IDS.cardRow.children.length===0,"لا بطاقات معروضة");
ok(/نفدت/.test(IDS.atkNote.innerHTML),"رسالة «نفدت بطاقاتك» ظاهرة");

console.log("\n⑥ لاعبان فقط ⇒ اسم واحد في النافذة");
reset([P("me","أنا"),P("b","سعد")],["bombs","gloop"],4,4);
rAtk(true);
IDS.cardRow.children[0].onclick();flush();
ok(IDS.tgList.children.length===1,"خصم واحد ("+IDS.tgList.children.length+")");
IDS.tgList.children[0].onclick();
ok(SENT.length===1&&SENT[0][1].to==="b","الهجوم وصل للخصم الوحيد");

console.log("\n⑦ كل قوة لها لون بطاقة");
["freeze","gloop","bombs","nibble","shuffle","double"].forEach(p=>
  ok(Array.isArray(PW_CL[p])&&PW_CL[p].length===2,"لون "+p));

console.log("\n══════════════════════════════════");
console.log("  ✅ نجح: "+pass+"    ❌ فشل: "+fail);
console.log("══════════════════════════════════\n");
process.exitCode=fail?1:0;

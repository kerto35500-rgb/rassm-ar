// مباراةٌ كاملة عبر منطق اللعبة نفسه، ثم نتحقّق أن الإحصاءات وصلت للجدول الجديد
process.env.QUIZ_TEST_FAST="1";
const { setupQuiz } = require("./quiz");
const gs = {};             // مخزنٌ وهميّ يسجّل ما يصل
const kv = {}, users = {};
let nextId = 1;
const store = {
  async getUser(n){ return users[n]||null; },
  async createUser(n,s,h,x){ const id=nextId++; users[n]={id,name:n,salt:s,hash:h,passHash:(x||{}).passHash,wins:0,games:0,totalScore:0}; return id; },
  async getKV(k){ return kv[k]||null; }, async saveKV(k,v){ kv[k]=v; },
  async bumpGameStats(uid,game,d){ const k=uid+"|"+game; const e=gs[k]||(gs[k]={games:0,wins:0,score:0,best:0,extra:{}});
    e.games+=d.games||0; e.wins+=d.wins||0; e.score+=d.score||0; if((d.best||0)>e.best)e.best=d.best;
    if(d.extra) for(const x in d.extra) e.extra[x]=(e.extra[x]||0)+d.extra[x]; }
};
class FS{constructor(n,i){this.nsp=n;this.id=i;this.rooms=new Set([i]);this.h={};this.rx=[];}
 on(e,f){(this.h[e]=this.h[e]||[]).push(f);return this;} fire(e,...a){(this.h[e]||[]).forEach(f=>f(...a));}
 emit(e,d){this.rx.push({e,d});} join(r){this.rooms.add(r);} leave(r){this.rooms.delete(r);}
 to(r){return{emit:(e,d)=>this.nsp._room(r,e,d,this.id)};}
 last(e){for(let i=this.rx.length-1;i>=0;i--)if(this.rx[i].e===e)return this.rx[i].d;return null;}}
class FN{constructor(){this.cf=[];this.s=new Map();}
 on(e,f){if(e==="connection")this.cf.push(f);} connect(i){const s=new FS(this,i);this.s.set(i,s);this.cf.forEach(f=>f(s));return s;}
 _room(r,e,d,ex){this.s.forEach(s=>{if(s.id!==ex&&s.rooms.has(r))s.emit(e,d);});}
 to(r){return{emit:(e,d)=>{this.s.forEach(s=>{if(s.rooms.has(r))s.emit(e,d);});}};}}
const nsp=new FN();
const Q=setupQuiz({of:()=>nsp},{store,hashPass:()=>"h",publicStats:u=>u,getAdmin:()=>null});
const ask=(s,e,d,ms=500)=>new Promise(res=>{let done=false;const t=setTimeout(()=>{if(!done){done=true;res(null)}},ms);
 s.fire(e,d,r=>{if(!done){done=true;clearTimeout(t);res(r)}})});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const A=nsp.connect("A"), B=nsp.connect("B");
  const ra=await ask(A,"register",{name:"بطل",pass:"كلمة سرّ طويلة"});
  console.log("تسجيل:", ra && ra.ok ? "✅" : "❌ "+(ra&&ra.error));
  console.log("معرّف على المقبس:", A.userId ? "✅ "+A.userId : "❌ غائب");
  const r=await ask(A,"createRoom",{name:"بطل"}); await ask(B,"joinRoom",{name:"ضيف",roomId:r.roomId});
  const room=Q.rooms.get(r.roomId);
  room.settings.length="short"; room.settings.challenges=false; room.settings.powers=false;
  room.settings.pyramidHeight=1; room.settings.pyramidTime=1;
  A.fire("startGame"); 
  const t0=Date.now();
  const iv=setInterval(()=>{ const st=A.last("state"); if(!st)return;
    if(st.phase==="vote"&&st.catOptions){A.fire("vote",st.catOptions[0]);B.fire("vote",st.catOptions[0]);}
    if(st.phase==="question"||st.phase==="pyramid"){A.fire("answer",0);B.fire("answer",1);} },60);
  while(Date.now()-t0<25000){ if(A.last("state")&&A.last("state").state==="ended") break; await sleep(150); }
  clearInterval(iv); await sleep(400);
  const keys=Object.keys(gs);
  console.log("صفوف الإحصاءات:", keys.length?keys.join(", "):"لا شيء");
  const mine=gs["1|quiz"];
  console.log("إحصاءة اللاعب المسجَّل:", mine?("✅ "+JSON.stringify(mine)):"❌ لم تُسجَّل");
  console.log("الضيف بلا إحصاءات:", keys.every(k=>k.startsWith("1|"))?"✅":"❌");
  process.exit(0);
})();

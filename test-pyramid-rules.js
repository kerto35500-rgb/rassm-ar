process.env.QUIZ_TEST_FAST="1";
// اختبار قواعد الهرم الجديدة — التشغيل: QUIZ_TEST_FAST=1 node test-pyramid-rules.js
const { setupQuiz } = require("./quiz");
let P=0,F=0; const ok=(c,l,x)=>{c?(P++,console.log("  ✅ "+l)):(F++,console.log("  ❌ "+l+(x!==undefined?"  → "+x:"")));};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class FS{constructor(n,i){this.nsp=n;this.id=i;this.rooms=new Set([i]);this.h={};this.rx=[];}
 on(e,f){(this.h[e]=this.h[e]||[]).push(f);return this;} fire(e,...a){(this.h[e]||[]).forEach(f=>f(...a));}
 emit(e,d){this.rx.push({e,d});} join(r){this.rooms.add(r);} leave(r){this.rooms.delete(r);}
 to(r){return{emit:(e,d)=>this.nsp._room(r,e,d,this.id)};}
 last(e){for(let i=this.rx.length-1;i>=0;i--)if(this.rx[i].e===e)return this.rx[i].d;return null;}
 all(e){return this.rx.filter(x=>x.e===e).map(x=>x.d);} clear(){this.rx=[];}}
class FN{constructor(){this.cf=[];this.s=new Map();}
 on(e,f){if(e==="connection")this.cf.push(f);} connect(i){const s=new FS(this,i);this.s.set(i,s);this.cf.forEach(f=>f(s));return s;}
 _room(r,e,d,ex){this.s.forEach(s=>{if(s.id!==ex&&s.rooms.has(r))s.emit(e,d);});}
 to(r){return{emit:(e,d)=>{let h=false;this.s.forEach(s=>{if(s.rooms.has(r)){s.emit(e,d);h=true;}});if(!h&&this.s.has(r))this.s.get(r).emit(e,d);}};}}
const mk=()=>{const nsp=new FN();const kv={},users={};
 const Q=setupQuiz({of:()=>nsp},{store:{async getUser(n){return users[n]||null;},
  async createUser(n,s,h){users[n]={name:n,salt:s,hash:h,wins:0,games:0,totalScore:0};},
  async getKV(k){return kv[k]||null;},async saveKV(k,v){kv[k]=v;}},
  hashPass:()=>"h",publicStats:u=>u,getAdmin:()=>null}); return {nsp,Q};};
const ask=(s,e,d,ms=400)=>new Promise(res=>{let done=false;const t=setTimeout(()=>{if(!done){done=true;res(null);}},ms);
 s.fire(e,d,r=>{if(!done){done=true;clearTimeout(t);res(r);}})});
async function makeRoom(n){
  const {nsp,Q}=mk(); const socks=[];
  const A=nsp.connect("P0"); const r=await ask(A,"createRoom",{name:"ل0"}); socks.push(A);
  for(let i=1;i<n;i++){const s=nsp.connect("P"+i); await ask(s,"joinRoom",{name:"ل"+i,roomId:r.roomId}); socks.push(s);}
  return {Q,room:Q.rooms.get(r.roomId),socks};
}
const phaseSeq=(s,from)=>s.all("state").slice(from).map(x=>x.phase).filter((p,i,a)=>p!==a[i-1]);

(async()=>{
console.log("\n═══ قواعد الهرم الجديدة ═══\n");

/* ── ٧ · صفحة قراءة قبل التوصيل والتصنيف ── */
{ const {room,socks:[A]}=await makeRoom(2);
  A.fire("devJump","link"); await sleep(60); A.fire("skipIntro"); await sleep(600);
  const st=A.all("state"); const rd=st.find(x=>x.phase==="read");
  ok(!!rd&&rd.question&&rd.question.titleOnly,"التوصيل: صفحة قراءةٍ بعنوان اللعبة قبل اللوحة", rd&&rd.question&&rd.question.text);
  await sleep(900);
  ok(A.last("state").phase==="link","ثم تبدأ لوحة التوصيل",A.last("state").phase);
  A.fire("devJump","sort"); await sleep(60); A.fire("skipIntro"); await sleep(600);
  const rd2=A.all("state").reverse().find(x=>x.phase==="read");
  ok(!!rd2&&/^صنّف/.test(rd2.question.text),"التصنيف: صفحة قراءةٍ «صنّف: … أم …؟»",rd2&&rd2.question.text);
}


/* أداة: ننتظر طورًا بعينه */
async function until(room,phases,ms=4000){ const t0=Date.now(); while(!phases.includes(room.phase)&&Date.now()-t0<ms) await sleep(40); return room.phase; }
/* أداة: نُنهي طور الفخاخ بأن يضرب كلُّ من بيده سلاحٌ أوّلَ خصمٍ */
async function playAttack(room,socks){
  if(room.phase!=="attack") return;
  for(const s of socks){ const m=s.last("powerMenu"); const me=room.players.find(p=>p.id===s.id);
    if(m&&m.tier&&!me.pendingAttack){ const tgt=room.players.find(p=>p.id!==s.id); s.fire("attack",{to:tgt.id,power:m.menu[0]}); await sleep(20); } }
  await until(room,["read","question","attackReveal"],3000); await until(room,["question"],3000);
}

/* ── ٩ · القفزات الافتتاحية حسب النقاط، ثم التصفير ── */
{ const {room,socks}=await makeRoom(5);
  room.settings.attackTime=1;
  socks[0].fire("devJump","pyramid"); await sleep(60);
  room.players.forEach((p,i)=>{ p.score=[500,300,300,100,0][i]; });   // أثناء الشرح، قبل بدء الهرم
  socks.forEach(s=>s.clear());
  socks[0].fire("skipIntro"); await until(room,["pyramidIntro"],3000);
  const first=socks[0].all("state").find(x=>x.phase==="pyramidIntro");
  ok(!!first&&first.players.every(p=>p.pyPos===0),"أوّل حالةِ هرم: الجميع في الأسفل",first&&JSON.stringify(first.players.map(p=>p.pyPos)));
  await sleep(250);
  const pos=Object.fromEntries(room.players.map(p=>[p.name,p.pyPos]));
  ok(pos["ل0"]===3&&pos["ل1"]===2&&pos["ل2"]===2&&pos["ل3"]===1&&pos["ل4"]===1,
     "القفزات: الأوّل ٣، المتعادلان في الثاني ٢، الباقون ١",JSON.stringify(pos));
  ok(room.players.every(p=>p.score===0),"النقاط صُفِّرت بعد القفزات");
}

/* ── ٥ · فخاخ الدرجات + ٨ · التسلسل + ٦ · الصعود بأربعة ── */
{ const {room,socks}=await makeRoom(4);
  room.settings.attackTime=1;
  socks[0].fire("devJump","pyramid"); await sleep(60);
  room.players.forEach((p,i)=>{ p.score=[900,600,300,0][i]; });   // → ٣،٢،١،١
  socks.forEach(s=>s.clear());
  socks[0].fire("skipIntro"); await until(room,["attack"],4000);
  const seq=phaseSeq(socks[0],0);
  ok(room.phase==="attack"&&seq.includes("pyramidIntro"),"بعد عرض الهرم تأتي مرحلة الفخاخ",seq.join("→"));
  const M=socks.map(s=>s.last("powerMenu"));
  /* المواضع ٣،٢،٢،١ = الدرجات ٤،٣،٣،٢ */
  ok(M[0]&&M[0].menu[0]==="freeze"&&M[0].tier===4,"الموضع ٣ = الدرجة ٤ → تجميد",M[0]&&M[0].menu);
  ok(M[1]&&M[1].menu[0]==="nibble"&&M[1].tier===3,"الموضع ٢ = الدرجة ٣ → أكلة الحروف",M[1]&&M[1].menu);
  ok(M[2]&&M[2].menu[0]==="nibble","المركز الثالث (موضع ٢) → أكلة الحروف أيضًا",M[2]&&M[2].menu);
  ok(M[3]&&M[3].menu[0]==="bombs"&&M[3].tier===2,"الموضع ١ = الدرجة ٢ → قنابل",M[3]&&M[3].menu);
  socks[0].fire("attack",{to:"P1",power:"freeze"});
  socks[1].fire("attack",{to:"P0",power:"nibble"});
  socks[2].fire("attack",{to:"P0",power:"gloop"});    // سلاحٌ ليس من درجته → يُرفض
  socks[3].fire("attack",{to:"P2",power:"bombs"});
  await sleep(150);
  ok(room.attacks.length===3,"ثلاث هجماتٍ صحيحة قُبلت والرابعة (سلاح غير درجته) رُفضت",room.attacks.length);
  socks[2].fire("attack",{to:"P0",power:"nibble"});
  await until(room,["question"],4000);
  const seq2=phaseSeq(socks[0],0);
  const iA=seq2.lastIndexOf("attack"), iR=seq2.indexOf("read",iA), iQ=seq2.indexOf("question",iR);
  ok(iA>=0&&iR>iA&&iQ>iR,"بعد الفخاخ: قراءة السؤال ثم الخيارات",seq2.join("→"));
  const eff=Object.fromEntries(room.players.map(p=>[p.name,p.effects.slice()]));
  ok(eff["ل0"].filter(x=>x==="nibble").length===2&&eff["ل1"].includes("freeze")&&eff["ل2"].includes("bombs"),
     "الفخاخ طُبّقت على أهدافها عند ظهور الخيارات",JSON.stringify(eff));
  ok(room.players.every(p=>p.powersLeft===room.settings.powerUses),"فخاخ الهرم لا تستهلك رصيد البطاقات");
  ok(socks[0].all("state").every(x=>x.phase!=="question"||!x.hurry),"لا تعليق استعجال في أسئلة الهرم");
  const c=room.currentQ.correct; const before=room.players.map(p=>p.pyPos);
  for(const s of socks){ s.fire("answer",c); await sleep(30); }
  await until(room,["pyramid"],3000);
  const d=room.players.map((p,i)=>p.pyPos-before[i]);
  ok(d.filter(x=>x===1).length===1&&d.every(x=>x===0||x===1),"٤ لاعبين: الأسرع وحده صعد درجة",JSON.stringify(d));
  ok(d[0]===1,"والأسرع هو أوّل من أجاب");
  ok(room.phase==="pyramid","ثم العودة إلى عرض الهرم",room.phase);
}

/* ── ٦ · مع ٦ لاعبين يصعد الأسرعان ── */
{ const {room,socks}=await makeRoom(6);
  room.settings.powers=false; room.settings.attackTime=1;
  socks[0].fire("devJump","pyramid"); await sleep(60); socks[0].fire("skipIntro");
  await until(room,["question"],5000);
  ok(room.phase==="question","وصلنا للخيارات بلا فخاخ (القوى مطفأة)",room.phase);
  const c=room.currentQ.correct; const before=room.players.map(p=>p.pyPos);
  for(const s of socks){ s.fire("answer",c); await sleep(25); }
  await until(room,["pyramid"],3000);
  const d=room.players.map((p,i)=>p.pyPos-before[i]);
  ok(d.filter(x=>x===1).length===2&&d[0]===1&&d[1]===1,"٦ لاعبين: الأسرعان صعدا درجةً واحدة",JSON.stringify(d));
}

/* ── ٥ · الدرجة الخامسة والسادسة تضربان الجميع تلقائيًّا ── */
{ const {room,socks}=await makeRoom(3);
  room.settings.attackTime=1;
  socks[0].fire("devJump","pyramid"); await sleep(60); socks[0].fire("skipIntro");
  await until(room,["attack","question"],4000); await playAttack(room,socks);
  ok(room.phase==="question","الجولة الأولى وصلت للخيارات",room.phase);
  room.players[0].pyPos=4; room.players[1].pyPos=5; room.players[2].pyPos=0;   /* الدرجات ٥ و٦ والأولى */
  const wrong=(room.currentQ.correct+1)%4;
  socks.forEach(s=>s.clear());
  for(const s of socks){ s.fire("answer",wrong); await sleep(20); }
  await until(room,["pyramid"],3000); await until(room,["attack"],5000);
  const hits=room.attacks.map(a=>a.fromName+"→"+a.toName+":"+a.power);
  ok(hits.includes("ل0→ل1:gloop")&&hits.includes("ل0→ل2:gloop"),"درجة ٥: وحلٌ على الجميع تلقائيًّا",hits.join(" "));
  ok(hits.includes("ل1→ل0:freeze")&&hits.includes("ل1→ل2:freeze"),"درجة ٦: تجميدٌ على الجميع تلقائيًّا");
  const m2=socks[2].last("powerMenu");
  ok(m2&&m2.menu[0]==="gloop"&&m2.tier===1,"القاعدة = الدرجة الأولى → وحل، ويختار هدفًا",m2&&m2.menu);
}
console.log("\n═══ حفلة النقاط ═══\n");
const {Q,room}=await makeRoom(3);
room.settings.powerChoices=3;
const p=room.players[0];
function sample(qc,got,N){ let n=0; room.qCount=qc; p.gotDouble=got;
  for(let i=0;i<N;i++){ const m=Q._menuFor(room,p); if(m.includes("double")) n++; } return n; }
const a=sample(2,false,500);
ok(a===0,"قبل السؤال الخامس: لا حفلة أبدًا (٠ من ٥٠٠)",a);
const b=sample(5,false,3000);
ok(b>0&&Math.abs(b/3000-0.20)<0.04,"من السؤال الخامس: ٢٠٪ ± ٤ ("+(b/30).toFixed(1)+"٪ من ٣٠٠٠)",b);
const c=sample(9,true,500);
ok(c===0,"من أخذها مرّةً لا تعود له (٠ من ٥٠٠)",c);
const d=sample(9,false,300); const sizes=new Set(); for(let i=0;i<50;i++) sizes.add(Q._menuFor(room,p).length);
ok([...sizes].every(x=>x===3),"القائمة تبقى ثلاث بطاقات حين تُقحَم الحفلة",[...sizes]);
console.log(`\n  ${P} ناجح / ${F} فاشل\n`); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1);});

// اختبار إحصاءات الألعاب: التجميع، الترحيل من القديم، والمتصدّرون.
const fs=require("fs"), os=require("os"), path=require("path");
let P=0,F=0; const ok=(c,m,x)=>{c?P++:F++;console.log((c?"  ✅ ":"  ❌ ")+m+(c?"":" → "+JSON.stringify(x)));};
const tmp=path.join(os.tmpdir(),"stats-"+Date.now()+".json");
const { createStore } = require("./store");
const { migrateGameStats } = require("./statsmigrate");

(async()=>{
  console.log("\n═══ إحصاءات الألعاب ═══\n");
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const store = new JsonStore(tmp);

  const a = await store.createUser("أحمد","","",{}), b = await store.createUser("سارة","","",{});

  // ① التجميع
  await store.bumpGameStats(a,"quiz",{games:1,wins:1,score:120});
  await store.bumpGameStats(a,"quiz",{games:1,wins:0,score:80});
  await store.bumpGameStats(a,"bomb",{games:1,wins:1,extra:{words:14}});
  let st = await store.getGameStats(a);
  const q = st.find(x=>x.game==="quiz");
  ok(q && q.games===2 && q.wins===1 && q.score===200,"الأسئلة تتجمّع عبر المباريات",q);
  const bm = st.find(x=>x.game==="bomb");
  ok(bm && bm.extra.words===14,"الحقول الخاصّة بلعبة تُحفظ في extra",bm);
  ok(st.length===2,"لعبتان للاعب الواحد",st.length);

  // ② أفضل نتيجة
  await store.bumpGameStats(a,"quiz",{best:300});
  await store.bumpGameStats(a,"quiz",{best:150});
  ok((await store.getGameStats(a)).find(x=>x.game==="quiz").best===300,"best يأخذ الأعلى لا الأخير");

  // ③ المتصدّرون لكل لعبة
  await store.bumpGameStats(b,"quiz",{games:5,wins:4,score:900});
  const top = await store.topByGame("quiz",10);
  ok(top[0] && top[0].name==="سارة" && top[0].wins===4,"المتصدّرون مرتّبون بالفوز",top);
  ok((await store.topByGame("bomb",10)).length===1,"كل لعبة متصدّروها");

  // ④ لاعبٌ بلا إحصاءات
  ok((await store.getGameStats(999)).length===0,"لاعبٌ بلا إحصاءات يعيد قائمةً فارغة");

  // ⑤ الترحيل من الصيغة القديمة
  const tmp2=path.join(os.tmpdir(),"stats2-"+Date.now()+".json");
  const s2=new JsonStore(tmp2);
  const u1=await s2.createUser("قديم","","",{});
  await s2.createUser("آخر","","",{});
  await s2.saveKV("quizStats",{ "قديم":{games:7,wins:3,points:410}, "مفقود":{games:9,wins:9,points:99} });
  await s2.saveKV("bombStats",{ "قديم":{games:4,wins:1,words:22} });
  const r=await migrateGameStats(s2,()=>{});
  ok(r.moved===2 && r.missing===1,"رُحّل الموجود وتُخطّي المفقود",r);
  const g=await s2.getGameStats(u1);
  const gq=g.find(x=>x.game==="quiz"), gb=g.find(x=>x.game==="bomb");
  ok(gq && gq.games===7 && gq.wins===3 && gq.score===410,"الأسئلة رُحّلت بأرقامها",gq);
  ok(gb && gb.extra.words===22,"كلمات القنبلة رُحّلت في extra",gb);
  const again=await migrateGameStats(s2,()=>{});
  ok(again.skipped===true,"الترحيل لا يتكرّر");
  const g2=await s2.getGameStats(u1);
  ok(g2.find(x=>x.game==="quiz").games===7,"ولا تتضاعف الأرقام");

  [tmp,tmp2].forEach(f=>{ try{fs.unlinkSync(f)}catch(e){} });
  console.log(`\n  ${P} ناجح / ${F} فاشل\n`); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1)});

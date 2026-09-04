// اختبار قواعد الكسب: الجوائز، منع الغشّ، السقف اليوميّ، ومنع التكرار.
const fs=require("fs"), os=require("os"), path=require("path");
const E=require("./economy");
let P=0,F=0; const ok=(c,m,x)=>{c?P++:F++;console.log((c?"  ✅ ":"  ❌ ")+m+(c?"":" → "+JSON.stringify(x)));};
const tmp=path.join(os.tmpdir(),"eco-"+Date.now()+".json");
const { createStore } = require("./store");

(async()=>{
  console.log("\n═══ الاقتصاد ═══\n");
  const JsonStore=Object.getPrototypeOf(await createStore()).constructor;
  const s=new JsonStore(tmp);
  const a=await s.createUser("أ","","",{}), b=await s.createUser("ب","","",{});
  const P1={id:"s1",userId:a,ip:"1.1.1.1"}, P2={id:"s2",userId:b,ip:"2.2.2.2"};

  // ① مباراة سليمة
  let r=await E.awardMatch(s,{game:"quiz",players:[P1,P2],winnerId:"s1",matchId:"m1"});
  const g=Object.fromEntries(r.granted.map(x=>[x.userId,x.amount]));
  ok(g[a]===E.REWARDS.quiz.win && g[b]===E.REWARDS.quiz.play,"الفائز يأخذ أكثر من المشارك",g);
  ok((await s.getWallet(a)).gold===60,"الرصيد وصل");

  // ② لا تتكرّر الجائزة لنفس المباراة
  r=await E.awardMatch(s,{game:"quiz",players:[P1,P2],winnerId:"s1",matchId:"m1"});
  ok(r.granted.every(x=>x.duplicate),"المباراة نفسها لا تُمنح مرّتين",r.granted);
  ok((await s.getWallet(a)).gold===60,"والرصيد لم يتضاعف");

  // ③ لاعبٌ واحد لا يُكافَأ
  r=await E.awardMatch(s,{game:"quiz",players:[P1],winnerId:"s1",matchId:"m2"});
  ok(r.granted.length===0 && /لاعبَين/.test(r.reason),"لاعبٌ وحده لا يكسب",r.reason);

  // ④ حسابٌ واحد بمقعدين لا يُكافَأ
  r=await E.awardMatch(s,{game:"quiz",players:[P1,{id:"s3",userId:a,ip:"9.9.9.9"}],winnerId:"s1",matchId:"m3"});
  ok(r.granted.length===0 && /حسابٍ واحد/.test(r.reason),"حسابان متطابقان لا يكسبان",r.reason);

  // ⑤ عنوانٌ واحد لثنائيٍّ لا يُكافَأ
  r=await E.awardMatch(s,{game:"quiz",players:[{id:"s1",userId:a,ip:"5.5.5.5"},{id:"s2",userId:b,ip:"5.5.5.5"}],winnerId:"s1",matchId:"m4"});
  ok(r.granted.length===0 && /العنوان نفسه/.test(r.reason),"لاعبان من الجهاز نفسه لا يكسبان",r.reason);

  // ⑥ ثلاثة من عنوانٍ واحد مسموح (بيتٌ واحد)
  const c=await s.createUser("ج","","",{});
  r=await E.awardMatch(s,{game:"bomb",players:[
      {id:"x1",userId:a,ip:"7.7.7.7"},{id:"x2",userId:b,ip:"7.7.7.7"},{id:"x3",userId:c,ip:"7.7.7.7"}],
      winnerId:"x1",matchId:"m5"});
  ok(r.granted.length===3,"ثلاثة من بيتٍ واحد يكسبون (لا نظلم الإخوة)",r.granted.length);

  // ⑦ البوتات والمتفرّجون لا يكسبون
  r=await E.awardMatch(s,{game:"quiz",players:[P1,P2,{id:"bot",userId:null,isBot:true},{id:"sp",userId:c,spectator:true}],
      winnerId:"s1",matchId:"m6"});
  ok(r.granted.length===2,"البوت والمتفرّج خارج التوزيع",r.granted.length);

  // ⑧ السقف اليوميّ
  const d=await s.createUser("د","","",{}), e2=await s.createUser("هـ","","",{});
  for(let i=0;i<12;i++)
    await E.awardMatch(s,{game:"quiz",players:[{id:"p1",userId:d,ip:"1.2.3.4"},{id:"p2",userId:e2,ip:"4.3.2.1"}],
      winnerId:"p1",matchId:"cap"+i});
  const w=await s.getWallet(d);
  ok(w.gold===E.DAILY_CAP.quiz,"السقف اليوميّ للعبة لا يُتجاوَز",w.gold);
  const rem=await E.remainingToday(s,d);
  ok(rem.perGame.quiz===0,"المتبقّي في هذه اللعبة صفر",rem.perGame.quiz);
  ok(rem.total>0,"لكن يبقى سقفٌ لألعابٍ أخرى",rem.total);

  // ⑨ السقف الكلّيّ
  for(const gme of ["bomb","salfa","draw","uno"])
    for(let i=0;i<12;i++)
      await E.awardMatch(s,{game:gme,players:[{id:"p1",userId:d,ip:"1.2.3.4"},{id:"p2",userId:e2,ip:"4.3.2.1"}],
        winnerId:"p1",matchId:gme+i});
  const w2=await s.getWallet(d);
  ok(w2.gold===E.DAILY_TOTAL,"السقف الكلّيّ اليوميّ يوقف الكسب",w2.gold);
  ok((await E.remainingToday(s,d)).total===0,"ولا يبقى شيء");

  // ⑩ الدفتر يشرح كل حركة
  const led=await s.ledgerOf(d,5);
  ok(led.every(x=>/^لعب:/.test(x.reason)),"كل حركةٍ لها سببٌ مقروء",led[0]&&led[0].reason);

  try{ fs.unlinkSync(tmp); }catch(e){}
  console.log(`\n  ${P} ناجح / ${F} فاشل\n`); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1)});

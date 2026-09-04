// اختبار المحفظة والدفتر: المنح والخصم، منع السالب، منع التكرار، والسقف اليوميّ.
const fs=require("fs"), os=require("os"), path=require("path");
let P=0,F=0; const ok=(c,m,x)=>{c?P++:F++;console.log((c?"  ✅ ":"  ❌ ")+m+(c?"":" → "+JSON.stringify(x)));};
const tmp=path.join(os.tmpdir(),"wallet-"+Date.now()+".json");
const { createStore } = require("./store");

(async()=>{
  console.log("\n═══ المحفظة والدفتر ═══\n");
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const s = new JsonStore(tmp);
  const u = await s.createUser("تاجر","","",{});

  // ① البداية صفر
  ok(JSON.stringify(await s.getWallet(u))==='{"gold":0,"gems":0}',"المحفظة تبدأ صفرًا");

  // ② المنح
  let r = await s.move(u,"gold",100,{reason:"win:quiz"});
  ok(r.ok && r.balance===100,"منح ١٠٠ ذهب",r);
  r = await s.move(u,"gold",50,{reason:"daily"});
  ok(r.balance===150,"يتراكم",r.balance);

  // ③ الخصم
  r = await s.move(u,"gold",-40,{reason:"buy:item"});
  ok(r.ok && r.balance===110,"الخصم يعمل",r.balance);

  // ④ منع السالب
  r = await s.move(u,"gold",-999,{reason:"buy:big"});
  ok(!r.ok && /لا يكفي/.test(r.error),"لا يُسمح برصيدٍ سالب",r);
  ok((await s.getWallet(u)).gold===110,"والرصيد لم يتغيّر");

  // ⑤ العملتان منفصلتان
  await s.move(u,"gems",5,{reason:"gift"});
  const w = await s.getWallet(u);
  ok(w.gold===110 && w.gems===5,"الذهب والجواهر مستقلّان",w);

  // ⑥ منع التكرار بمفتاح
  const idem="match-777";
  const a1 = await s.move(u,"gold",30,{reason:"win:bomb",idem});
  const a2 = await s.move(u,"gold",30,{reason:"win:bomb",idem});
  ok(a1.ok && a2.duplicate,"المنح نفسه لا يتكرّر بمفتاحٍ واحد",{a1:a1.ok,a2:a2.duplicate});
  ok((await s.getWallet(u)).gold===140,"ولم يُضَف مرّتين");

  // ⑦ الدفتر يحفظ الرصيد بعد كل حركة
  const led = await s.ledgerOf(u,50);
  ok(led.length===5,"عدد سطور الدفتر يساوي الحركات الناجحة",led.length);
  ok(led.every(x=>typeof x.balanceAfter==="number"),"كل سطرٍ يحمل الرصيد بعده");
  ok(led[0].reason==="win:bomb","الأحدث أوّلًا",led[0].reason);
  const failed = led.filter(x=>x.reason==="buy:big");
  ok(failed.length===0,"الحركة المرفوضة لا تُسجَّل");

  // ⑧ السقف اليوميّ
  const since = Date.now()-3600000;
  const earned = await s.earnedSince(u,since,"win:");
  ok(earned===130,"مجموع المكتسب بسببٍ بعينه (١٠٠+٣٠)",earned);
  const all = await s.earnedSince(u,since);
  ok(all===185,"ومجموع كل المكتسب (١٠٠+٥٠+٣٠+٥)",all);

  // ⑨ حركاتٌ غير صالحة
  ok(!(await s.move(u,"gold",0,{})).ok,"صفرٌ يُرفض");
  ok(!(await s.move(u,"riyal",10,{})).ok,"عملةٌ مجهولة تُرفض");
  ok(!(await s.move(0,"gold",10,{})).ok,"لاعبٌ بلا معرّف يُرفض");

  try{ fs.unlinkSync(tmp); }catch(e){}
  console.log(`\n  ${P} ناجح / ${F} فاشل\n`); process.exit(F?1:0);
})().catch(e=>{console.error(e);process.exit(1)});

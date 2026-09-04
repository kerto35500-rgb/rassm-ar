// اختبار المتجر: الكتالوج، الشراء الذرّي، منع التكرار، الرصيد، والتجهيز.
const fs=require("fs"), os=require("os"), path=require("path");
let P=0,F=0; const ok=(c,m,x)=>{c?P++:F++;console.log((c?"  ✅ ":"  ❌ ")+m+(c?"":" → "+JSON.stringify(x)));};
const tmp=path.join(os.tmpdir(),"shop-"+Date.now()+".json");
const { createStore } = require("./store");
const { allItems, unoItems, rarityOf } = require("./shopseed");

(async()=>{
  console.log("\n═══ المتجر ═══\n");
  const JsonStore = Object.getPrototypeOf(await createStore()).constructor;
  const s = new JsonStore(tmp);
  const u = await s.createUser("مشتري","","",{});
  const v = await s.createUser("جار","","",{});

  // ═══ البذر ═══
  console.log("── الكتالوج ──");
  const rows = allItems();
  ok(rows.length > 150, `الكتالوج يحمل ${rows.length} عنصرًا`, rows.length);
  ok(new Set(rows.map(r=>r.id)).size === rows.length, "لا معرّفَ مكرَّر");
  ok(rows.every(r=>/^[a-z]+:[a-z]+:.+$/.test(r.id)), "المعرّف بصيغة game:kind:key");
  ok(rows.every(r=>r.name && r.name.length>0), "لكل عنصرٍ اسم");
  ok(rows.every(r=>r.price>=0 && Number.isFinite(r.price)), "الأسعار أعدادٌ غير سالبة");
  ok(rows.every(r=>r.preview && r.preview.startsWith("/uno/")), "لكل عنصرٍ معاينة");
  const kinds = new Set(rows.map(r=>r.kind));
  ok(["boards","cards","avatars","frames"].every(k=>kinds.has(k)), "الأنواع الأربعة موجودة",[...kinds]);
  ok(rows.some(r=>r.price===0), "فيه عناصرُ مجّانيّة للبداية");
  ok(rarityOf(0)==="free" && rarityOf(700)==="common" && rarityOf(2600)==="legend","رتبةُ الندرة من السعر");

  await s.upsertItems(rows);
  ok((await s.listItems()).length === rows.length, "بُذر الكتالوج في المخزن");
  ok((await s.listItems({game:"uno",kind:"frames"})).length === unoItems().filter(r=>r.kind==="frames").length,
     "الترشيح بلعبةٍ ونوع");

  // البذر مرّةً ثانية لا يُضاعف
  await s.upsertItems(rows);
  ok((await s.listItems()).length === rows.length, "إعادة البذر لا تُضاعف");

  // ═══ الشراء ═══
  console.log("\n── الشراء ──");
  const item = (await s.listItems({game:"uno",kind:"frames"})).find(i=>i.price>0);
  ok(!!item, "وجدنا عنصرًا مدفوعًا", item&&item.id);

  let r = await s.buyItem(u, item);
  ok(!r.ok && /لا يكفي/.test(r.error), "شراءٌ بلا رصيدٍ يُرفَض", r);
  ok(!(await s.ownsItem(u,item.id)), "ولا يُملَك العنصر بعد الرفض");

  await s.move(u,"gold",5000,{reason:"اختبار"});
  r = await s.buyItem(u, item);
  ok(r.ok, "الشراء ينجح مع رصيدٍ كافٍ", r);
  ok(r.wallet.gold === 5000-item.price, "خُصم السعر بالضبط", r.wallet);
  ok(await s.ownsItem(u,item.id), "صار مملوكًا");

  r = await s.buyItem(u, item);
  ok(!r.ok && r.owned, "الشراء مرّتين مرفوض", r);
  ok((await s.getWallet(u)).gold === 5000-item.price, "ولم يُخصَم ثانيةً");

  const led = await s.ledgerOf(u,5);
  ok(led[0].reason === "شراء:"+item.id, "الدفتر يذكر ما اشتُري", led[0]);
  ok(led[0].delta === -item.price, "بمقدارٍ سالبٍ يساوي السعر", led[0].delta);
  ok((s.db.purchases||[]).length === 1, "أُنشئ إيصالُ شراء");

  // الجار لا يرث
  ok(!(await s.ownsItem(v,item.id)), "ملكيّةُ لاعبٍ لا تمسّ غيره");
  ok((await s.inventoryOf(u)).length === 1 && (await s.inventoryOf(v)).length === 0, "المخزون لكلٍّ على حدة");

  // المنح بلا دفع
  const gift = (await s.listItems({game:"uno",kind:"cards"})).find(i=>i.price>0);
  const g = await s.grantItem(v, gift.id, "gift");
  ok(g.ok && await s.ownsItem(v,gift.id), "المنح يُملّك بلا خصم");
  ok((await s.getWallet(v)).gold === 0, "ورصيد المُهدى إليه لم يتغيّر");
  ok(!(await s.grantItem(v, gift.id)).ok, "منحُ ما يُملَك لا يتكرّر");

  // ═══ التجهيز ═══
  console.log("\n── التجهيز ──");
  await s.setLoadout(u,"uno","frames",item.key);
  ok((await s.getLoadout(u,"uno")).frames === item.key, "التجهيز يُحفَظ");
  const other = (await s.listItems({game:"uno",kind:"frames"})).find(i=>i.key!==item.key);
  await s.setLoadout(u,"uno","frames",other.key);
  const lo = await s.getLoadout(u,"uno");
  ok(lo.frames === other.key, "التبديل يستبدل لا يُضيف");
  ok((s.db.loadout||[]).filter(x=>x.userId===u&&x.kind==="frames").length===1,"صفٌّ واحدٌ لكل نوع");
  await s.setLoadout(u,"uno","boards","classic");
  ok(Object.keys(await s.getLoadout(u,"uno")).length===2, "أنواعٌ مختلفة تتعايش");
  ok(Object.keys(await s.getLoadout(v,"uno")).length===0, "تجهيزُ لاعبٍ لا يمسّ غيره");

  // ═══ الإخفاء ═══
  console.log("\n── الإدارة ──");
  await s.setItemActive(item.id,false);
  ok(!(await s.listItems()).some(i=>i.id===item.id), "المخفيّ لا يظهر في العرض");
  ok((await s.listItems({all:true})).some(i=>i.id===item.id), "لكنه يظهر للإدارة");
  await s.upsertItems(rows);
  ok(!(await s.listItems()).some(i=>i.id===item.id), "وإعادة البذر لا تُعيد إظهاره");
  await s.setItemActive(item.id,true);
  ok((await s.listItems()).some(i=>i.id===item.id), "والإظهار يرجعه");

  try{fs.unlinkSync(tmp)}catch(e){}
  try{fs.rmSync(path.join(path.dirname(tmp),"blobs"),{recursive:true,force:true})}catch(e){}
  console.log(`\n═══ ${P} نجحت · ${F} فشلت ═══\n`);
  process.exit(F?1:0);
})().catch(e=>{console.error("💥",e);process.exit(1)});
